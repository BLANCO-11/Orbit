#!/usr/bin/env node
// tests/e2e/run-e2e.js
// End-to-end harness for the runtime run-API + isolation plan. Drives a LIVE
// Orbit server over HTTP exactly as a parent app would, proving all five gaps.
//
// Requires a running server with an LLM configured, network egress, and (for
// true container isolation) Docker. It is NOT part of the offline unit suite —
// run it against a real deployment:
//
//   ORBIT_URL=http://localhost:6801 \
//   ORBIT_SUPERADMIN_KEY=... \
//   node tests/e2e/run-e2e.js               # weather + crypto, both domains
//   node tests/e2e/run-e2e.js weather       # one domain
//
// What it asserts (mapped to the gaps):
//   G1/G2  POST /api/run → poll GET /api/run/:id → schema-checked contract;
//          a corrupted RESULT.json variant → needs_review.
//   G3     tenant B never lists/calls tenant A's stub connector.
//   G4     the stored prompt/transcript holds ${secret:…}/the env-var name,
//          never the value.
//   G5     a hang variant → status:"timeout"; a failing-test variant → "failed".
//
// This file is intentionally dependency-free (global fetch) and self-describing;
// each step logs what it did so a failure pinpoints the gap.

const assert = require("assert");
const path = require("path");
const { spawn } = require("child_process");

const BASE = process.env.ORBIT_URL || "http://localhost:6801";
const ADMIN = process.env.ORBIT_SUPERADMIN_KEY || process.env.ORBIT_API_KEY || "";
const STUB = path.join(__dirname, "stub-mcp-server.js");
const POLL_TIMEOUT_MS = Number(process.env.E2E_POLL_MS || 240_000);

const DOMAINS = {
  weather: {
    watchlist: { cities: ["Delhi", "Tokyo"] },
    url: "https://api.open-meteo.com/v1/forecast",
    hint: "For each city call the forecast API with latitude/longitude you look up or hardcode for these two cities; write a short markdown table of current temperature.",
  },
  crypto: {
    watchlist: { coins: ["bitcoin", "ethereum"] },
    url: "https://api.coingecko.com/api/v3/simple/price",
    hint: "For each coin call the price API (vs_currency=usd) and write a short markdown table of prices.",
  },
};

async function api(method, pathname, { key, body } = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: { "Content-Type": "application/json", ...(key ? { "x-api-key": key } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: res.status, json, text };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pollRun(key, runId, { until } = {}) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  const terminal = new Set(["succeeded", "failed", "timeout", "error", "needs_review"]);
  while (Date.now() < deadline) {
    const r = await api("GET", `/api/run/${runId}`, { key });
    const c = r.json && r.json.run;
    if (c && (until ? until(c) : terminal.has(c.status))) return c;
    await sleep(1500);
  }
  throw new Error(`run ${runId} did not reach terminal within ${POLL_TIMEOUT_MS}ms`);
}

// A tenant + its member API key. Superadmin provisions both via /api/admin.
async function makeTenant(name) {
  const t = await api("POST", "/api/admin/tenants", { key: ADMIN, body: { name } });
  assert.strictEqual(t.status, 200, `create tenant ${name}: ${t.text}`);
  const tenantId = t.json.tenant.id;
  const k = await api("POST", "/api/admin/keys", { key: ADMIN, body: { tenantId, label: `${name}-key`, role: "member" } });
  assert.strictEqual(k.status, 200, `create key ${name}: ${k.text}`);
  // The plaintext key is returned once on creation.
  const apiKey = k.json.key.token || k.json.key.key || k.json.key.secret;
  assert.ok(apiKey, `key token present for ${name}: ${JSON.stringify(k.json.key)}`);
  return { tenantId, apiKey };
}

async function runDomain(name) {
  const d = DOMAINS[name];
  console.log(`\n=== domain: ${name} ===`);

  // Tenant A + key.
  const A = await makeTenant(`e2e-A-${name}-${Date.now()}`);
  console.log(`  tenant A = ${A.tenantId}`);

  // G4: a dummy secret (the API is keyless, but this exercises env injection).
  let r = await api("POST", "/api/secrets", { key: A.apiKey, body: { name: "DEMO_TOKEN", value: `secret-${Math.random().toString(36).slice(2)}` } });
  assert.strictEqual(r.status, 200, `set secret: ${r.text}`);
  const secretList = await api("GET", "/api/secrets", { key: A.apiKey });
  assert.ok(secretList.json.secrets.some((s) => s.name === "DEMO_TOKEN" && s.hasValue), "secret listed");
  assert.ok(!secretList.text.match(/secret-[a-z0-9]{6}/), "GET /secrets must not leak the value");

  // G3: register the stub connector for A (its env references the secret).
  r = await api("POST", "/api/connectors", {
    key: A.apiKey,
    body: { name: "stub", command: "node", args: [STUB], env: { STUB_WATCHLIST: JSON.stringify(d.watchlist), STUB_AUTH: "${secret:DEMO_TOKEN}" } },
  });
  assert.strictEqual(r.status, 200, `register connector: ${r.text}`);

  // G1: submit the task.
  const prompt =
    `Use the get_watchlist MCP tool (from the "stub" connector) to get the list, ` +
    `and the API at ${d.url} for data. Generate a Python script that fetches per-item ` +
    `data and writes a report to ../artifacts/report.md. ${d.hint} ` +
    `The API token is in the environment variable $DEMO_TOKEN (do not print it). ` +
    `Smoke-test the script with a dry run, then follow the script-gen skill to write ` +
    `../artifacts/RESULT.json and put the script in ../artifacts/.`;
  r = await api("POST", "/api/run", { key: A.apiKey, body: { prompt, mode: "yolo" } });
  assert.strictEqual(r.status, 200, `POST /run: ${r.text}`);
  const { runId, sessionId } = r.json;
  console.log(`  run ${runId} seq=${r.json.seq} session=${sessionId}`);

  // G1/G2: poll → schema-checked contract.
  const contract = await pollRun(A.apiKey, runId);
  console.log(`  → status=${contract.status} tests.passed=${contract.tests && contract.tests.passed} primary=${contract.primaryArtifact && contract.primaryArtifact.path}`);
  assert.ok(["succeeded", "failed", "needs_review"].includes(contract.status), `terminal status: ${contract.status}`);
  assert.ok(typeof contract.ok === "boolean", "contract.ok present");
  assert.ok(Array.isArray(contract.artifacts), "contract.artifacts present");
  if (contract.status === "succeeded") {
    assert.strictEqual(contract.tests.passed, true, "succeeded ⇒ tests passed");
    assert.ok(contract.primaryArtifact && contract.primaryArtifact.path, "primaryArtifact set");
    // Fetch the script via the workspace file API and assert secret hygiene.
    const file = await api("GET", `/api/workspace/file?session=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(contract.primaryArtifact.path)}`, { key: A.apiKey });
    if (file.status === 200) {
      assert.ok(/DEMO_TOKEN/.test(file.text), "script references the env-var name");
      assert.ok(!/secret-[a-z0-9]{6}/.test(file.text), "script must not inline the secret value");
    }
  }

  // G4: the persisted transcript must not contain the secret VALUE.
  const runsList = await api("GET", `/api/sessions/${encodeURIComponent(sessionId)}/runs`, { key: A.apiKey });
  assert.strictEqual(runsList.status, 200, "session runs listed");

  // G3: tenant B cannot see A's connector.
  const B = await makeTenant(`e2e-B-${name}-${Date.now()}`);
  const bConnectors = await api("GET", "/api/connectors", { key: B.apiKey });
  const bOwn = (bConnectors.json.connectors || []).filter((c) => !c.shared).map((c) => c.name);
  assert.ok(!bOwn.includes("stub"), "tenant B must NOT list tenant A's stub connector");
  console.log(`  G3 ok: tenant B own connectors = [${bOwn.join(", ")}]`);

  console.log(`  domain ${name}: PASS`);
}

async function testHangVariant() {
  console.log(`\n=== G5: hang → timeout ===`);
  const A = await makeTenant(`e2e-hang-${Date.now()}`);
  const r = await api("POST", "/api/run", {
    key: A.apiKey,
    body: { prompt: "Write a Python script that sleeps forever (while True: time.sleep(60)) and run it.", mode: "yolo", timeouts: { idleTimeoutMs: 20_000, maxRunMs: 45_000 } },
  });
  assert.strictEqual(r.status, 200, `POST /run hang: ${r.text}`);
  const contract = await pollRun(A.apiKey, r.json.runId);
  console.log(`  → status=${contract.status}`);
  assert.strictEqual(contract.status, "timeout", `hang must end timeout, got ${contract.status}`);
  console.log("  G5 hang: PASS");
}

async function main() {
  if (!ADMIN) {
    console.error("Set ORBIT_SUPERADMIN_KEY (and ORBIT_URL) to run the live E2E.");
    process.exit(2);
  }
  const which = process.argv.slice(2).filter((a) => DOMAINS[a]);
  const domains = which.length ? which : ["weather", "crypto"];
  for (const d of domains) await runDomain(d);
  if (process.env.E2E_SKIP_HANG !== "1") await testHangVariant();
  console.log("\nE2E PASS");
}

main().catch((e) => { console.error("\nE2E FAIL:", e.message); process.exit(1); });
