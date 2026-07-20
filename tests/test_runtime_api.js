// tests/test_runtime_api.js
// Offline unit coverage for the runtime run-API + isolation plan (Gaps 1–5).
// Everything here runs WITHOUT a live server, pi, LLM, Docker, or network — the
// live end-to-end path lives in tests/e2e/run-e2e.js. Exercises: the secrets
// store + resolver (tenant isolation, no-leak), the runs table + result-contract
// assembly/validation/snapshot + status derivation, and tenant-scoped connectors
// with ${secret:} composition.

const assert = require("assert");
const os = require("os");
const path = require("path");
const fs = require("fs");

// Isolate the DB + ORBIT_HOME to temp dirs BEFORE requiring the modules.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-runtime-test-"));
process.env.ORBIT_DB_DRIVER = "sqlite";
process.env.ORBIT_DB_PATH = path.join(TMP, "test.db");
process.env.ORBIT_HOME = path.join(TMP, "orbit-home");
// Deterministic encryption key so the crypto round-trip is stable across runs.
process.env.ORBIT_SECRET = "test-secret-key-for-runtime-api-suite";

const db = require("../agent-backend/db");
const { encrypt, decrypt } = require("../agent-backend/crypto-store");
const resolver = require("../agent-backend/secrets-resolver");
const rc = require("../agent-backend/run-contract");
const wp = require("../agent-backend/workspace-paths");

const A = "tenant-A", B = "tenant-B";

async function testSecretsStore() {
  console.log("secrets store + resolver...");
  await db.setSecret({ tenantId: A, name: "DEMO_TOKEN", valueEnc: encrypt("val-A") });
  await db.setSecret({ tenantId: A, name: "API_KEY", valueEnc: encrypt("keyA") });
  await db.setSecret({ tenantId: B, name: "DEMO_TOKEN", valueEnc: encrypt("val-B") });
  await db.setSecret({ tenantId: null, name: "LOCAL_ONE", valueEnc: encrypt("dev") });

  const listA = await db.listSecrets(A);
  assert.strictEqual(listA.length, 2, "A has 2 secrets");
  assert.ok(!("valueEnc" in listA[0]), "listing never exposes ciphertext");
  assert.ok(!JSON.stringify(listA).includes("val-A"), "listing never exposes value");
  assert.strictEqual((await db.listSecrets(B)).length, 1, "B isolated to 1");

  const secA = await resolver.getTenantSecrets(A);
  assert.strictEqual(secA.DEMO_TOKEN, "val-A");
  assert.strictEqual(secA.API_KEY, "keyA");
  const secB = await resolver.getTenantSecrets(B);
  assert.strictEqual(secB.DEMO_TOKEN, "val-B", "B's value is distinct");
  assert.ok(!("API_KEY" in secB), "B cannot see A's other secret");
  const secDev = await resolver.getTenantSecrets(null);
  assert.strictEqual(secDev.LOCAL_ONE, "dev");
  assert.ok(!("DEMO_TOKEN" in secDev), "dev bucket isolated from tenants");

  // upsert preserves createdAt, rotates value + bumps updatedAt
  const before = await db.getSecret(A, "DEMO_TOKEN");
  await new Promise((r) => setTimeout(r, 3));
  await db.setSecret({ tenantId: A, name: "DEMO_TOKEN", valueEnc: encrypt("rotated") });
  const after = await db.getSecret(A, "DEMO_TOKEN");
  assert.strictEqual(after.createdAt, before.createdAt, "createdAt preserved");
  assert.ok(after.updatedAt >= before.updatedAt, "updatedAt bumped");
  assert.strictEqual(decrypt(after.valueEnc), "rotated", "value rotated");

  // placeholder + deep resolution
  assert.strictEqual(resolver.resolvePlaceholders("Bearer ${secret:API_KEY}", secA), "Bearer keyA");
  assert.strictEqual(resolver.resolvePlaceholders("x=${secret:MISSING}", secA), "x=${secret:MISSING}", "unknown left intact");
  const deep = resolver.resolveDeep({ env: { A: "${secret:API_KEY}" }, args: ["--k", "${secret:MISSING}"] }, secA);
  assert.strictEqual(deep.env.A, "keyA");
  assert.strictEqual(deep.args[1], "${secret:MISSING}");

  // env injection respects reserved names
  const env = { HOME: "/root", ORBIT_LLM_KEY: "gk" };
  const { injected, skipped } = resolver.injectIntoEnv(env, { GOOD: "g", ORBIT_LLM_KEY: "hijack", HOME: "hijack" }, /^(ORBIT_|HOME$)/i);
  assert.strictEqual(env.GOOD, "g");
  assert.strictEqual(env.ORBIT_LLM_KEY, "gk", "reserved not overwritten");
  assert.strictEqual(env.HOME, "/root", "reserved not overwritten");
  assert.deepStrictEqual(injected, ["GOOD"]);
  assert.deepStrictEqual(skipped.sort(), ["HOME", "ORBIT_LLM_KEY"]);

  assert.strictEqual(await db.deleteSecret(A, "API_KEY"), true);
  assert.strictEqual(await db.deleteSecret(A, "API_KEY"), false, "delete missing → false");
  console.log("  ok");
}

async function testResultValidator() {
  console.log("RESULT.json validator...");
  assert.ok(rc.validateResultJson({ ok: true, tests: { ran: true, passed: true } }).valid);
  assert.ok(!rc.validateResultJson({ tests: { ran: true, passed: true } }).valid, "missing ok");
  assert.ok(!rc.validateResultJson({ ok: true }).valid, "missing tests");
  assert.ok(!rc.validateResultJson({ ok: "yes", tests: { ran: true, passed: true } }).valid, "ok wrong type");
  assert.ok(!rc.validateResultJson({ ok: true, tests: { ran: 1, passed: true } }).valid, "tests.ran wrong type");
  assert.ok(!rc.validateResultJson("{ not json").valid, "bad json");
  assert.ok(!rc.validateResultJson("[]").valid, "array not object");
  console.log("  ok");
}

function seedArtifacts(sessionId, resultObj) {
  const dirs = wp.ensureSessionDirs(sessionId);
  // clean previous
  try { for (const f of fs.readdirSync(dirs.artifacts)) fs.rmSync(path.join(dirs.artifacts, f), { recursive: true, force: true }); } catch {}
  fs.writeFileSync(path.join(dirs.artifacts, "fetch.py"), 'import os\nprint(os.environ["DEMO_TOKEN"])\n');
  fs.writeFileSync(path.join(dirs.artifacts, "report.md"), "# Report\n");
  if (resultObj !== undefined) {
    fs.writeFileSync(path.join(dirs.artifacts, "RESULT.json"), typeof resultObj === "string" ? resultObj : JSON.stringify(resultObj));
  }
  return dirs;
}

async function testContractAndStatuses() {
  console.log("contract assembly + status derivation + snapshot...");
  const SID = "sess-contract";

  // succeeded
  seedArtifacts(SID, { ok: true, summary: "did it", primaryArtifact: "fetch.py", tests: { ran: true, passed: true, command: "python fetch.py --dry-run", output: "OK" } });
  let c = rc.assembleContract({ runId: "r1", sessionId: SID, seq: 1, lifecycle: "completed", finalMessage: "done", usage: { tokens: 100, cost: 0.01, toolCalls: 3 } });
  assert.strictEqual(c.status, "succeeded");
  assert.strictEqual(c.ok, true);
  assert.strictEqual(c.primaryArtifact.path, "/artifacts/fetch.py");
  assert.strictEqual(c.primaryArtifact.language, "python");
  assert.strictEqual(c.tests.passed, true);
  assert.strictEqual(c.artifacts.length, 3);
  assert.strictEqual(c.raw.resultJsonValid, true);
  assert.strictEqual(c.usage.tokens, 100);

  // snapshot survives a later artifact rewrite
  const snap = rc.snapshotArtifacts(SID, "r1");
  assert.ok(fs.existsSync(path.join(snap, "fetch.py")), "snapshot copied");

  // failed: tests ran but not passed
  seedArtifacts(SID, { ok: true, tests: { ran: true, passed: false, output: "AssertionError" } });
  c = rc.assembleContract({ runId: "r2", sessionId: SID, seq: 2, lifecycle: "completed", finalMessage: "", usage: {} });
  assert.strictEqual(c.status, "failed", "tests failed → failed");

  // failed: ok=false
  seedArtifacts(SID, { ok: false, tests: { ran: true, passed: true } });
  c = rc.assembleContract({ runId: "r3", sessionId: SID, seq: 3, lifecycle: "completed", finalMessage: "", usage: {} });
  assert.strictEqual(c.status, "failed", "ok=false → failed");

  // needs_review: corrupt RESULT.json
  seedArtifacts(SID, "{ not valid json ");
  c = rc.assembleContract({ runId: "r4", sessionId: SID, seq: 4, lifecycle: "completed", finalMessage: "", usage: {} });
  assert.strictEqual(c.status, "needs_review", "corrupt → needs_review");
  assert.strictEqual(c.raw.resultJsonValid, false);
  assert.ok(c.raw.resultJsonErrors.length > 0);

  // needs_review: RESULT.json absent
  seedArtifacts(SID, undefined);
  c = rc.assembleContract({ runId: "r5", sessionId: SID, seq: 5, lifecycle: "completed", finalMessage: "", usage: {} });
  assert.strictEqual(c.status, "needs_review", "missing → needs_review");

  // lifecycle overrides win regardless of a passing RESULT.json
  seedArtifacts(SID, { ok: true, tests: { ran: true, passed: true } });
  assert.strictEqual(rc.assembleContract({ runId: "r6", sessionId: SID, seq: 6, lifecycle: "timeout", finalMessage: "", usage: {}, error: "backstop" }).status, "timeout");
  assert.strictEqual(rc.assembleContract({ runId: "r7", sessionId: SID, seq: 7, lifecycle: "error", finalMessage: "", usage: {} }).status, "error");
  assert.strictEqual(rc.assembleContract({ runId: "r8", sessionId: SID, seq: 8, lifecycle: "cancelled", finalMessage: "", usage: {} }).status, "error");
  console.log("  ok");
}

async function testRunsTable() {
  console.log("runs table + versioning...");
  const SID = "sess-runs";
  assert.strictEqual(await db.nextRunSeq(SID), 1, "first seq is 1");
  await db.createRun({ runId: "run_a", sessionId: SID, seq: 1, tenantId: A, status: "running", prompt: "p1", source: "api", mode: "yolo" });
  let r = await db.getRun("run_a");
  assert.strictEqual(r.status, "running");
  assert.strictEqual(r.seq, 1);
  assert.strictEqual(r.tenantId, A);

  await db.updateRun("run_a", { status: "succeeded", contract: { status: "succeeded", summary: "ok" }, endedAt: Date.now() });
  r = await db.getRun("run_a");
  assert.strictEqual(r.status, "succeeded");
  assert.strictEqual(r.contract.summary, "ok");
  assert.ok(r.endedAt);

  assert.strictEqual(await db.nextRunSeq(SID), 2, "next seq is 2");
  await db.createRun({ runId: "run_b", sessionId: SID, seq: 2, tenantId: A, status: "running", prompt: "p2" });
  const hist = await db.listSessionRuns(SID);
  assert.strictEqual(hist.length, 2);
  assert.strictEqual(hist[0].seq, 2, "history newest-first");
  assert.strictEqual(hist[1].summary, "ok", "summary pulled from contract");
  console.log("  ok");
}

async function testConnectorIsolation() {
  console.log("tenant connectors + ${secret} composition...");
  await db.setSecret({ tenantId: A, name: "DS_TOKEN", valueEnc: encrypt("A-tok") });
  await db.upsertConnector({ tenantId: A, name: "stub", def: { command: "node", args: ["stub.js"], env: { AUTH: "${secret:DS_TOKEN}", STATIC: "x" } } });
  await db.upsertConnector({ tenantId: B, name: "onlyB", def: { url: "https://b.example" } });

  const aList = await db.listConnectorsForTenant(A);
  const bList = await db.listConnectorsForTenant(B);
  assert.deepStrictEqual(aList.map((c) => c.name), ["stub"]);
  assert.deepStrictEqual(bList.map((c) => c.name), ["onlyB"]);
  assert.ok(!bList.some((c) => c.name === "stub"), "B cannot see A's connector");

  // compose A: resolve ${secret:} using A's secrets only
  const secA = await resolver.getTenantSecrets(A);
  const composed = resolver.resolveDeep(aList[0].def.env, secA);
  assert.strictEqual(composed.AUTH, "A-tok", "secret resolved in connector env");
  assert.strictEqual(composed.STATIC, "x");

  // B has no DS_TOKEN → the placeholder stays literal (no cross-tenant leak)
  const secB = await resolver.getTenantSecrets(B);
  assert.strictEqual(resolver.resolveDeep({ k: "${secret:DS_TOKEN}" }, secB).k, "${secret:DS_TOKEN}");

  assert.strictEqual(await db.deleteConnector(A, "stub"), true);
  assert.strictEqual(await db.deleteConnector(A, "stub"), false);
  console.log("  ok");
}

(async () => {
  try {
    await db.init();
    await testSecretsStore();
    await testResultValidator();
    await testContractAndStatuses();
    await testRunsTable();
    await testConnectorIsolation();
    console.log("\nAll runtime-API unit tests passed.");
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
    process.exit(0);
  } catch (e) {
    console.error("\nFAIL:", e.stack || e.message);
    process.exit(1);
  }
})();
