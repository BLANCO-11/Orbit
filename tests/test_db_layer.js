// End-to-end test of the async db.js layer. Runs against SQLite by default
// (temp file). To exercise Postgres, run with a live server:
//   DATABASE_URL=postgres://user:pass@localhost:5432/orbit_test node tests/test_db_layer.js
// (Point it at a THROWAWAY database — the test writes real rows.)

const assert = require("assert");
const os = require("os");
const path = require("path");
const fs = require("fs");

const USE_PG = !!process.env.DATABASE_URL && process.env.ORBIT_DB_DRIVER !== "sqlite";
let tmp;
if (!USE_PG) {
  tmp = path.join(os.tmpdir(), `orbit-dblayer-test-${process.pid}.db`);
  for (const s of ["", "-wal", "-shm"]) { try { fs.unlinkSync(tmp + s); } catch {} }
  process.env.ORBIT_DB_DRIVER = "sqlite";
  process.env.ORBIT_DB_PATH = tmp;
}
process.env.ORBIT_HOME = process.env.ORBIT_HOME || path.join(os.tmpdir(), `orbit-home-${process.pid}`);

const db = require("../agent-backend/db");

async function main() {
  await db.init();
  console.log(`db layer test — dialect=${db.dialect}`);

  // ── Sessions ──
  console.log("sessions CRUD + composer merge...");
  await db.saveSession({ id: "s1", title: "First", messages: [{ role: "user", content: "hi" }], harnessId: "picode", effort: "high" });
  let s = await db.getSession("s1");
  assert.strictEqual(s.title, "First");
  assert.strictEqual(s.messages[0].content, "hi");
  assert.strictEqual(s.harnessId, "picode", "composer field spread flat");
  assert.strictEqual(s.effort, "high");
  // Partial save must not clobber composer.
  await db.saveSession({ id: "s1", title: "First (edited)", messages: [] });
  s = await db.getSession("s1");
  assert.strictEqual(s.title, "First (edited)");
  assert.strictEqual(s.harnessId, "picode", "harnessId preserved across partial save (merge)");
  await db.saveSession({ id: "s2", title: "Second searchable widget" });
  const found = await db.searchSessions("widget");
  assert.ok(found.some((x) => x.id === "s2"), "search finds by title");
  const all = await db.getAllSessions();
  assert.ok(all.length >= 2, "getAllSessions returns rows");

  // ── run_state / interrupted ──
  console.log("run_state / interrupted...");
  await db.setSessionRunning("s1", { activePrompt: "go", mode: "edit" });
  let interrupted = await db.listInterruptedSessions();
  assert.ok(interrupted.some((x) => x.id === "s1"), "s1 is interrupted");
  await db.clearSessionRunning("s1");
  interrupted = await db.listInterruptedSessions();
  assert.ok(!interrupted.some((x) => x.id === "s1"), "s1 cleared");

  await db.deleteSession("s2");
  assert.strictEqual(await db.getSession("s2"), null, "deleted session gone");

  // ── Pairing + devices (atomic redeem) ──
  console.log("pairing + devices...");
  const { code } = await db.createPairingCode("Phone", "full");
  const device = await db.redeemPairingCode(code, "My Phone");
  assert.ok(device && device.token, "redeem returns a device with a token");
  const byToken = await db.getDeviceByToken(device.token);
  assert.strictEqual(byToken.id, device.id, "device resolvable by token");
  // A code can't be redeemed twice.
  assert.strictEqual(await db.redeemPairingCode(code, "x"), null, "second redeem returns null");
  const devices = await db.listDevices();
  assert.ok(devices.some((d) => d.id === device.id), "device listed");
  assert.strictEqual(devices.find((d) => d.id === device.id).llmConfig.hasApiKey, false, "apiKey redacted in list");

  // ── Scoped LLM tokens ──
  console.log("scoped llm tokens...");
  const llmTok = await db.mintDeviceLlmToken(device.id, { budget: 1000, sessionId: "s1" });
  assert.ok(llmTok, "minted llm token");
  const resolved = await db.getDeviceByLlmToken(llmTok);
  assert.strictEqual(resolved.id, device.id);
  assert.strictEqual(resolved.budget, 1000);
  await db.recordDeviceLlmUsage(device.id, 42);
  assert.strictEqual((await db.getDeviceByLlmToken(llmTok)).used, 42, "usage recorded");
  await db.revokeDevice(device.id);
  assert.strictEqual(await db.getDeviceByToken(device.token), null, "revoked device not resolvable");
  assert.strictEqual(await db.getDeviceByLlmToken(llmTok), null, "revoked device's llm token dead");

  // ── Profiles / channels / connections ──
  console.log("profiles / channels / connections...");
  const prof = await db.saveProfile({ name: "P1", mode: "edit", sandbox: "host" });
  assert.strictEqual((await db.getProfile(prof.id)).mode, "edit");
  assert.ok((await db.countProfiles()) >= 1);
  await db.deleteProfile(prof.id);

  const chan = await db.saveChannel({ name: "C1", type: "webhook" });
  assert.strictEqual((await db.getChannel(chan.id)).type, "webhook");
  await db.touchChannelTriggered(chan.id);
  assert.ok((await db.getChannel(chan.id)).lastTriggered, "channel triggered stamp set");
  await db.deleteChannel(chan.id);

  await db.saveConnection({ provider: "github", kind: "oauth", scopes: ["repo", "read"], accessTokenEnc: "enc", meta: { a: 1 } });
  const conn = await db.getConnection("github");
  assert.deepStrictEqual(conn.scopes, ["repo", "read"], "connection scopes round-trip");
  await db.deleteConnection("github");
  assert.strictEqual(await db.getConnection("github"), null);

  // ── Tenants / API keys / users / SSO ──
  console.log("tenants / api keys / users / sso...");
  const tenant = await db.createTenant("Acme");
  assert.ok(tenant.id);
  const apiKey = await db.createApiKey({ tenantId: tenant.id, label: "CI", role: "admin" });
  assert.ok(apiKey.key.startsWith("orb_live_"), "raw key returned once");
  const keyRow = await db.getApiKeyByToken(apiKey.key);
  assert.strictEqual(keyRow.role, "admin", "api key resolvable by token");
  await db.revokeApiKey(apiKey.id);
  assert.strictEqual(await db.getApiKeyByToken(apiKey.key), null, "revoked key dead");

  const user = await db.upsertUser({ email: "A@x.com", tenantId: tenant.id, role: "member" });
  assert.strictEqual(user.email, "a@x.com", "email lowercased");
  const local = await db.createLocalUser({ username: "bob", password: "pw12345", role: "admin" });
  assert.ok(local.id);
  assert.strictEqual(await db.verifyLocalLogin("bob", "wrong"), null, "bad password rejected");
  assert.ok(await db.verifyLocalLogin("bob", "pw12345"), "good password accepted");
  const saAcct = await db.ensureSuperadminAccount({ username: "root", password: "rootpw" });
  assert.ok(saAcct.created, "superadmin created");
  const saAcct2 = await db.ensureSuperadminAccount({ username: "root" });
  assert.strictEqual(saAcct2.created, false, "superadmin idempotent");

  const sso = await db.createSsoSession(user.id);
  const got = await db.getSsoSessionByToken(sso.token);
  assert.strictEqual(got.user.id, user.id, "sso session resolves to user");
  await db.revokeSsoSession(sso.token);
  assert.strictEqual(await db.getSsoSessionByToken(sso.token), null, "revoked sso session gone");

  await db.deleteTenant(tenant.id);
  assert.strictEqual(await db.getTenant(tenant.id), null, "tenant deleted");

  console.log("\nAll db layer tests passed!");
}

main()
  .then(() => { if (!USE_PG) for (const s of ["", "-wal", "-shm"]) { try { fs.unlinkSync(tmp + s); } catch {} } process.exit(0); })
  .catch((e) => { console.error("\nTest failed:", e && e.stack ? e.stack : e); process.exit(1); });
