// agent-backend/db.js
// Data layer. Runs on either SQLite (node:sqlite, default) or PostgreSQL (pg),
// selected at boot by env via ./db/adapter. EVERY exported function is async and
// returns a Promise — callers must await. Dialect-specific SQL is branched on
// `PG`; everything else uses `?` placeholders (the pg adapter rewrites to $n).
//
// Boot: server.js MUST `await db.init()` before serving. Each public function
// also awaits init() defensively (cached promise, cheap) so ordering can't bite.

const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const { createAdapter } = require("./db/adapter");

const q = createAdapter();
const PG = q.dialect === "postgres";

// ── Dialect helpers ─────────────────────────────────────────────────
// SQLite INTEGER is a dynamic 64-bit type; Postgres INTEGER is int4 (too small
// for epoch-ms). No table uses an INTEGER primary key, so blanket INTEGER→BIGINT
// is safe and keeps epoch columns wide enough on pg.
function ddl(sql) { return PG ? sql.replace(/\bINTEGER\b/g, "BIGINT") : sql; }

// Upsert into the meta table. ON CONFLICT DO UPDATE is supported by both
// dialects (SQLite ≥3.24, always true for node:sqlite).
async function setMeta(key, value) {
  await q.run(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, String(value)]
  );
}

async function tableColumns(table) {
  if (PG) {
    const rows = await q.all(
      "SELECT column_name AS name FROM information_schema.columns WHERE table_name = ?", [table]
    );
    return rows.map((r) => r.name);
  }
  const rows = await q.all(`PRAGMA table_info(${table})`); // table is an internal constant
  return rows.map((r) => r.name);
}

// Idempotent ADD COLUMN. Both dialects error if the column exists; each ALTER
// runs as its own autocommit statement, so a swallowed error can't poison later
// ones. Mirrors the original try/catch-per-ALTER migration style.
async function addColumn(table, coldef) {
  try { await q.exec(ddl(`ALTER TABLE ${table} ADD COLUMN ${coldef}`)); } catch (e) {}
}

// ── Schema version ──────────────────────────────────────────────────
const CURRENT_SCHEMA_VERSION = 19;
const BACKUP_INTERVAL = 10; // auto-backup every N saves
let saveCount = 0;

// ── One-time async init (schema + migrations) ───────────────────────
let initPromise = null;
function init() { if (!initPromise) initPromise = _doInit(); return initPromise; }

async function _doInit() {
  await q.exec(ddl(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `));

  await q.exec(ddl(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      messages TEXT NOT NULL,
      logs TEXT NOT NULL,
      execution_plan TEXT NOT NULL,
      metrics TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT '',
      subagent_tree TEXT NOT NULL DEFAULT '{}',
      composer TEXT NOT NULL DEFAULT '{}',
      timestamp INTEGER NOT NULL
    )
  `));

  // Self-healing: ensure later-migration columns exist even on a fresh boot that
  // bypassed the ALTER statements.
  try {
    const columnSet = new Set(await tableColumns("sessions"));
    if (!columnSet.has("schema_version")) await addColumn("sessions", "schema_version INTEGER DEFAULT 0");
    if (!columnSet.has("run_state")) await addColumn("sessions", "run_state TEXT NOT NULL DEFAULT '{}'");
    if (!columnSet.has("plan_steps")) await addColumn("sessions", "plan_steps TEXT NOT NULL DEFAULT '[]'");
    if (!columnSet.has("plans")) await addColumn("sessions", "plans TEXT NOT NULL DEFAULT '[]'");
    if (!columnSet.has("active_plan_id")) await addColumn("sessions", "active_plan_id TEXT NOT NULL DEFAULT ''");
    if (!columnSet.has("tenant_id")) await addColumn("sessions", "tenant_id TEXT");
    if (!columnSet.has("composer")) await addColumn("sessions", "composer TEXT NOT NULL DEFAULT '{}'");
  } catch (e) {
    console.error("[DB] Self-healing check failed:", e.message);
  }

  // Read current schema version.
  let currentSchemaVersion = 0;
  try {
    const row = await q.get("SELECT value FROM meta WHERE key = ?", ["schema_version"]);
    if (row) currentSchemaVersion = parseInt(row.value, 10);
  } catch (e) { /* meta might be empty */ }

  // ── Migrations ──
  if (currentSchemaVersion < 2) {
    await addColumn("sessions", "schema_version INTEGER DEFAULT 0");
    await setMeta("schema_version", CURRENT_SCHEMA_VERSION);
    console.log(`[DB] Migrated sessions schema to version ${CURRENT_SCHEMA_VERSION}`);
  }
  if (currentSchemaVersion < 3) {
    await addColumn("sessions", "mode TEXT NOT NULL DEFAULT ''");
    await setMeta("schema_version", CURRENT_SCHEMA_VERSION);
    console.log(`[DB] Migrated sessions schema to version ${CURRENT_SCHEMA_VERSION}`);
  }
  if (currentSchemaVersion < 4) {
    await addColumn("sessions", "subagent_tree TEXT NOT NULL DEFAULT '{}'");
    await setMeta("schema_version", CURRENT_SCHEMA_VERSION);
    console.log(`[DB] Migrated sessions schema to version ${CURRENT_SCHEMA_VERSION}`);
  }
  if (currentSchemaVersion < 5) {
    await q.exec(ddl(`
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY, label TEXT NOT NULL, token_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL, last_seen INTEGER, revoked_at INTEGER,
        policy_overrides TEXT NOT NULL DEFAULT '{}'
      )
    `));
    await q.exec(ddl(`
      CREATE TABLE IF NOT EXISTS pairing_codes (
        code TEXT PRIMARY KEY, label TEXT NOT NULL, created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL, redeemed_at INTEGER
      )
    `));
    await setMeta("schema_version", CURRENT_SCHEMA_VERSION);
    console.log(`[DB] Migrated sessions schema to version ${CURRENT_SCHEMA_VERSION}`);
  }
  if (currentSchemaVersion < 6) {
    await addColumn("devices", "scope TEXT NOT NULL DEFAULT 'full'");
    await addColumn("pairing_codes", "scope TEXT NOT NULL DEFAULT 'full'");
    await setMeta("schema_version", CURRENT_SCHEMA_VERSION);
    console.log(`[DB] Migrated sessions schema to version ${CURRENT_SCHEMA_VERSION}`);
  }
  if (currentSchemaVersion < 7) {
    await q.exec(ddl(`
      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, config_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      )
    `));
    await setMeta("schema_version", CURRENT_SCHEMA_VERSION);
    console.log(`[DB] Migrated sessions schema to version ${CURRENT_SCHEMA_VERSION}`);
  }
  if (currentSchemaVersion < 8) {
    await q.exec(ddl(`
      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, config_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_triggered INTEGER
      )
    `));
    await setMeta("schema_version", CURRENT_SCHEMA_VERSION);
    console.log(`[DB] Migrated sessions schema to version ${CURRENT_SCHEMA_VERSION}`);
  }
  if (currentSchemaVersion < 9) {
    await addColumn("sessions", "run_state TEXT NOT NULL DEFAULT '{}'");
    await setMeta("schema_version", CURRENT_SCHEMA_VERSION);
    console.log(`[DB] Migrated sessions schema to version ${CURRENT_SCHEMA_VERSION}`);
  }
  if (currentSchemaVersion < 10) {
    await q.exec(ddl(`
      CREATE TABLE IF NOT EXISTS connections (
        provider TEXT PRIMARY KEY, kind TEXT NOT NULL, scopes TEXT NOT NULL DEFAULT '',
        access_token_enc TEXT NOT NULL DEFAULT '', refresh_token_enc TEXT NOT NULL DEFAULT '',
        expires_at INTEGER, meta TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      )
    `));
    await setMeta("schema_version", CURRENT_SCHEMA_VERSION);
    console.log(`[DB] Migrated sessions schema to version ${CURRENT_SCHEMA_VERSION}`);
  }
  if (currentSchemaVersion < 11) {
    await addColumn("sessions", "plan_steps TEXT NOT NULL DEFAULT '[]'");
    await setMeta("schema_version", CURRENT_SCHEMA_VERSION);
    console.log(`[DB] Migrated sessions schema to version ${CURRENT_SCHEMA_VERSION}`);
  }
  if (currentSchemaVersion < 12) {
    await addColumn("sessions", "plans TEXT NOT NULL DEFAULT '[]'");
    await addColumn("sessions", "active_plan_id TEXT NOT NULL DEFAULT ''");
    await setMeta("schema_version", CURRENT_SCHEMA_VERSION);
    console.log(`[DB] Migrated sessions schema to version ${CURRENT_SCHEMA_VERSION}`);
  }
  if (currentSchemaVersion < 13) {
    await addColumn("sessions", "tenant_id TEXT");
    await addColumn("devices", "tenant_id TEXT");
    await setMeta("schema_version", CURRENT_SCHEMA_VERSION);
    console.log(`[DB] Migrated sessions schema to version ${CURRENT_SCHEMA_VERSION}`);
  }
  if (currentSchemaVersion < 15) {
    await addColumn("devices", "llm_budget INTEGER");
    await addColumn("devices", "llm_used INTEGER NOT NULL DEFAULT 0");
    await addColumn("devices", "llm_config TEXT NOT NULL DEFAULT '{}'");
    await setMeta("schema_version", CURRENT_SCHEMA_VERSION);
    console.log(`[DB] Migrated sessions schema to version ${CURRENT_SCHEMA_VERSION}`);
  }
  if (currentSchemaVersion < 16) {
    await q.exec(ddl(`
      CREATE TABLE IF NOT EXISTS secrets (
        tenant_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL,
        value_enc TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        PRIMARY KEY (tenant_id, name)
      )
    `));
    await setMeta("schema_version", CURRENT_SCHEMA_VERSION);
    console.log(`[DB] Migrated sessions schema to version ${CURRENT_SCHEMA_VERSION}`);
  }
  if (currentSchemaVersion < 17) {
    await q.exec(ddl(`
      CREATE TABLE IF NOT EXISTS runs (
        run_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, seq INTEGER NOT NULL,
        tenant_id TEXT, status TEXT NOT NULL DEFAULT 'queued', prompt TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'api', mode TEXT NOT NULL DEFAULT '',
        contract_json TEXT NOT NULL DEFAULT '{}',
        started_at INTEGER NOT NULL, ended_at INTEGER
      )
    `));
    await q.exec("CREATE INDEX IF NOT EXISTS idx_runs_session ON runs(session_id)");
    await q.exec("CREATE INDEX IF NOT EXISTS idx_runs_tenant ON runs(tenant_id)");
    await setMeta("schema_version", CURRENT_SCHEMA_VERSION);
    console.log(`[DB] Migrated sessions schema to version ${CURRENT_SCHEMA_VERSION}`);
  }
  if (currentSchemaVersion < 18) {
    await q.exec(ddl(`
      CREATE TABLE IF NOT EXISTS connectors (
        tenant_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL,
        def_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        PRIMARY KEY (tenant_id, name)
      )
    `));
    await setMeta("schema_version", CURRENT_SCHEMA_VERSION);
    console.log(`[DB] Migrated sessions schema to version ${CURRENT_SCHEMA_VERSION}`);
  }
  if (currentSchemaVersion < 19) {
    await q.exec(ddl(`
      CREATE TABLE IF NOT EXISTS templates (
        tenant_id TEXT NOT NULL DEFAULT '', id TEXT NOT NULL,
        name TEXT NOT NULL, def_json TEXT NOT NULL DEFAULT '{}',
        source_url TEXT NOT NULL DEFAULT '', source_etag TEXT NOT NULL DEFAULT '',
        fetched_at INTEGER,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        PRIMARY KEY (tenant_id, id)
      )
    `));
    await setMeta("schema_version", CURRENT_SCHEMA_VERSION);
    console.log(`[DB] Migrated sessions schema to version ${CURRENT_SCHEMA_VERSION}`);
  }

  // ── Core tables (ensure ALL exist regardless of schema_version) ──
  await q.exec(ddl(`
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY, label TEXT NOT NULL, token_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL, last_seen INTEGER, revoked_at INTEGER,
      policy_overrides TEXT NOT NULL DEFAULT '{}', scope TEXT NOT NULL DEFAULT 'full',
      tenant_id TEXT, llm_budget INTEGER, llm_used INTEGER NOT NULL DEFAULT 0,
      llm_config TEXT NOT NULL DEFAULT '{}'
    )
  `));
  await q.exec(ddl(`
    CREATE TABLE IF NOT EXISTS device_llm_tokens (
      token_hash TEXT PRIMARY KEY, device_id TEXT NOT NULL, session_id TEXT,
      created_at INTEGER NOT NULL
    )
  `));
  await q.exec(ddl(`
    CREATE TABLE IF NOT EXISTS pairing_codes (
      code TEXT PRIMARY KEY, label TEXT NOT NULL, created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL, redeemed_at INTEGER, scope TEXT NOT NULL DEFAULT 'full'
    )
  `));
  await q.exec(ddl(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, config_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )
  `));
  await q.exec(ddl(`
    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, config_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_triggered INTEGER
    )
  `));
  await q.exec(ddl(`
    CREATE TABLE IF NOT EXISTS connections (
      provider TEXT PRIMARY KEY, kind TEXT NOT NULL, scopes TEXT NOT NULL DEFAULT '',
      access_token_enc TEXT NOT NULL DEFAULT '', refresh_token_enc TEXT NOT NULL DEFAULT '',
      expires_at INTEGER, meta TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )
  `));
  await q.exec(ddl(`
    CREATE TABLE IF NOT EXISTS secrets (
      tenant_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL,
      value_enc TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY (tenant_id, name)
    )
  `));
  await q.exec(ddl(`
    CREATE TABLE IF NOT EXISTS runs (
      run_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, seq INTEGER NOT NULL,
      tenant_id TEXT, status TEXT NOT NULL DEFAULT 'queued', prompt TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'api', mode TEXT NOT NULL DEFAULT '',
      contract_json TEXT NOT NULL DEFAULT '{}',
      started_at INTEGER NOT NULL, ended_at INTEGER
    )
  `));
  try { await q.exec("CREATE INDEX IF NOT EXISTS idx_runs_session ON runs(session_id)"); } catch {}
  try { await q.exec("CREATE INDEX IF NOT EXISTS idx_runs_tenant ON runs(tenant_id)"); } catch {}
  await q.exec(ddl(`
    CREATE TABLE IF NOT EXISTS connectors (
      tenant_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL,
      def_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY (tenant_id, name)
    )
  `));
  await q.exec(ddl(`
    CREATE TABLE IF NOT EXISTS templates (
      tenant_id TEXT NOT NULL DEFAULT '', id TEXT NOT NULL,
      name TEXT NOT NULL, def_json TEXT NOT NULL DEFAULT '{}',
      source_url TEXT NOT NULL DEFAULT '', source_etag TEXT NOT NULL DEFAULT '',
      fetched_at INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY (tenant_id, id)
    )
  `));

  // ── Access-control tables (tenants / API keys / SSO) ──
  await q.exec(ddl(`
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
      sso_enabled INTEGER NOT NULL DEFAULT 0, sso_config TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    )
  `));
  await q.exec(ddl(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY, tenant_id TEXT, label TEXT NOT NULL, key_hash TEXT NOT NULL,
      key_prefix TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', scope TEXT NOT NULL DEFAULT 'full',
      created_at INTEGER NOT NULL, last_used INTEGER, revoked_at INTEGER, created_by TEXT
    )
  `));
  await q.exec(ddl(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, tenant_id TEXT, email TEXT NOT NULL, sub TEXT, username TEXT,
      password_hash TEXT, role TEXT NOT NULL DEFAULT 'member', created_at INTEGER NOT NULL,
      last_login INTEGER
    )
  `));
  if (currentSchemaVersion < 14) {
    await addColumn("users", "username TEXT");
    await addColumn("users", "password_hash TEXT");
    await setMeta("schema_version", CURRENT_SCHEMA_VERSION);
    console.log(`[DB] Migrated sessions schema to version ${CURRENT_SCHEMA_VERSION}`);
  }
  try { await q.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username) WHERE username IS NOT NULL"); } catch (e) {}
  await q.exec(ddl(`
    CREATE TABLE IF NOT EXISTS sso_sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
    )
  `));
}

// ── Backup ──────────────────────────────────────────────────────────
const MAX_BACKUPS = 20;
const BACKUP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

async function performBackup() {
  try {
    const allRows = await q.all("SELECT * FROM sessions");
    const backupDir = path.join(__dirname, "backups");
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(backupDir, `sessions-backup-${timestamp}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(allRows, null, 2), "utf-8");
    console.log(`[DB Backup] Wrote ${allRows.length} sessions to ${backupPath}`);
    pruneBackups();
    return backupPath;
  } catch (err) {
    console.error("[DB Backup] Failed:", err.message);
    return null;
  }
}

function pruneBackups() {
  const backupDir = path.join(__dirname, "backups");
  if (!fs.existsSync(backupDir)) return;
  let files = fs.readdirSync(backupDir)
    .filter((f) => f.startsWith("sessions-backup-") && f.endsWith(".json"))
    .map((f) => ({ name: f, path: path.join(backupDir, f), mtime: fs.statSync(path.join(backupDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  const now = Date.now();
  const agedOut = files.filter((f) => now - f.mtime > BACKUP_MAX_AGE_MS);
  const overCount = files.slice(MAX_BACKUPS);
  const toDelete = new Set([...agedOut, ...overCount]);
  for (const file of toDelete) {
    try { fs.unlinkSync(file.path); console.log(`[DB Backup] Pruned old backup: ${file.name}`); }
    catch (e) { console.error(`[DB Backup] Failed to prune ${file.name}:`, e.message); }
  }
}

function getBackups() {
  const backupDir = path.join(__dirname, "backups");
  if (!fs.existsSync(backupDir)) return [];
  return fs.readdirSync(backupDir)
    .filter((f) => f.startsWith("sessions-backup-") && f.endsWith(".json"))
    .sort().reverse();
}

// ── Row mapping ─────────────────────────────────────────────────────
function mapRow(row) {
  let composer = {};
  try { composer = JSON.parse(row.composer || "{}"); } catch {}
  return {
    ...composer,
    id: row.id,
    title: row.title,
    messages: JSON.parse(row.messages || "[]"),
    logs: JSON.parse(row.logs || "[]"),
    executionPlan: row.execution_plan,
    metrics: JSON.parse(row.metrics || "{}"),
    mode: row.mode || "",
    subagentTree: JSON.parse(row.subagent_tree || "{}"),
    planSteps: JSON.parse(row.plan_steps || "[]"),
    plans: JSON.parse(row.plans || "[]"),
    activePlanId: row.active_plan_id || "",
    runState: JSON.parse(row.run_state || "{}"),
    tenantId: row.tenant_id || null,
    timestamp: Number(row.timestamp),
    schemaVersion: row.schema_version || 0,
  };
}

async function setSessionRunning(id, info) {
  await init();
  await q.run("UPDATE sessions SET run_state = ? WHERE id = ?",
    [JSON.stringify({ running: true, ...info, startedAt: Date.now() }), id]);
}

async function clearSessionRunning(id) {
  await init();
  try { await q.run("UPDATE sessions SET run_state = '{}' WHERE id = ?", [id]); } catch {}
}

async function listInterruptedSessions() {
  await init();
  const rows = await q.all("SELECT * FROM sessions");
  return rows.map(mapRow).filter((s) => s.runState && s.runState.running);
}

// ── TTL: 30 days ────────────────────────────────────────────────────
async function enforceTTL() {
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - THIRTY_DAYS_MS;
  const deleted = await q.run("DELETE FROM sessions WHERE timestamp < ?", [cutoff]);
  if (deleted && deleted.changes > 0) console.log(`[DB TTL] Deleted ${deleted.changes} expired session(s).`);
}

// ── Sessions ────────────────────────────────────────────────────────
async function saveSession(session) {
  await init();
  await q.tx(async (t) => {
    // MERGE composer (don't clobber): overlay only fields present on the incoming
    // session so a partial save preserves the previously-saved agent/options.
    let composerObj = {};
    try {
      const existing = await t.get("SELECT composer FROM sessions WHERE id = ?", [session.id]);
      if (existing && existing.composer) composerObj = JSON.parse(existing.composer) || {};
    } catch {}
    for (const k of ["harnessId", "systemPromptType", "skills", "excludeTools", "profileId", "effort"]) {
      if (session[k] !== undefined) composerObj[k] = session[k];
    }
    const composerJson = JSON.stringify(composerObj);

    await t.run(`
      INSERT INTO sessions (id, title, messages, logs, execution_plan, metrics, mode, subagent_tree, plan_steps, plans, active_plan_id, tenant_id, composer, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title, messages = excluded.messages, logs = excluded.logs,
        execution_plan = excluded.execution_plan, metrics = excluded.metrics, mode = excluded.mode,
        subagent_tree = excluded.subagent_tree, plan_steps = excluded.plan_steps, plans = excluded.plans,
        active_plan_id = excluded.active_plan_id, tenant_id = excluded.tenant_id,
        composer = excluded.composer, timestamp = excluded.timestamp
    `, [
      session.id,
      session.title || "New Session",
      JSON.stringify(session.messages || []),
      JSON.stringify(session.logs || []),
      session.executionPlan || "",
      JSON.stringify(session.metrics || {}),
      session.mode || "",
      JSON.stringify(session.subagentTree || {}),
      JSON.stringify(session.planSteps || []),
      JSON.stringify(session.plans || []),
      session.activePlanId || "",
      session.tenantId || null,
      composerJson,
      session.timestamp || Date.now(),
    ]);
  });

  saveCount++;
  if (saveCount % BACKUP_INTERVAL === 0) await performBackup();
}

async function getSession(id) {
  await init();
  const row = await q.get("SELECT * FROM sessions WHERE id = ?", [id]);
  return row ? mapRow(row) : null;
}

async function getAllSessions() {
  await init();
  await enforceTTL();
  const rows = await q.all("SELECT * FROM sessions ORDER BY timestamp DESC");
  return rows.map(mapRow);
}

async function deleteSession(id) {
  await init();
  try {
    const row = await q.get("SELECT subagent_tree FROM sessions WHERE id = ?", [id]);
    if (row && row.subagent_tree) {
      let tree;
      try { tree = JSON.parse(row.subagent_tree); } catch {}
      if (tree && Array.isArray(tree.agents)) {
        for (const agent of tree.agents) {
          if (agent.childSessionId) await deleteSession(agent.childSessionId);
        }
      }
    }
  } catch (e) {
    console.error(`[DB] Failed to cascade delete child sessions for ${id}:`, e.message);
  }
  try {
    const workspacePaths = require("./workspace-paths");
    workspacePaths.removeSessionDirs(id);
  } catch (e) {
    console.error(`[DB] Failed to remove workspace dirs for ${id}:`, e.message);
  }
  await q.run("DELETE FROM sessions WHERE id = ?", [id]);
}

async function searchSessions(query) {
  await init();
  if (!query || typeof query !== "string") return [];
  const searchTerm = `%${query}%`;
  const like = PG ? "ILIKE" : "LIKE";
  const rows = await q.all(
    `SELECT * FROM sessions WHERE title ${like} ? OR messages ${like} ? ORDER BY timestamp DESC`,
    [searchTerm, searchTerm]
  );
  return rows.map(mapRow);
}

// ── Device Pairing (URL + OTP) ──────────────────────────────────────
const PAIRING_CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I ambiguity
const VALID_SCOPES = new Set(["full", "chat_voice", "read_only"]);
const normalizeScope = (s) => (VALID_SCOPES.has(s) ? s : "full");

function hashToken(token) { return crypto.createHash("sha256").update(token).digest("hex"); }

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}
function verifyPassword(password, stored) {
  if (!stored || typeof stored !== "string") return false;
  const [scheme, saltHex, hashHex] = stored.split(":");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  let actual;
  try { actual = crypto.scryptSync(String(password), Buffer.from(saltHex, "hex"), expected.length); }
  catch { return false; }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function generatePairingCode(length = 6) {
  let code = "";
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) code += PAIRING_CODE_ALPHABET[bytes[i] % PAIRING_CODE_ALPHABET.length];
  return code;
}

async function createPairingCode(label, scope) {
  await init();
  const code = generatePairingCode();
  const now = Date.now();
  const expiresAt = now + PAIRING_CODE_TTL_MS;
  await q.run(
    "INSERT INTO pairing_codes (code, label, created_at, expires_at, redeemed_at, scope) VALUES (?, ?, ?, ?, NULL, ?)",
    [code, label || "New device", now, expiresAt, normalizeScope(scope)]
  );
  return { code, expiresAt, scope: normalizeScope(scope) };
}

// Insert a device on the given query context (`t` = tx or the pool adapter).
async function _createDevice(t, label, scope) {
  const id = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString("hex");
  const deviceScope = normalizeScope(scope);
  await t.run(
    "INSERT INTO devices (id, label, token_hash, created_at, last_seen, revoked_at, policy_overrides, scope) VALUES (?, ?, ?, ?, NULL, NULL, '{}', ?)",
    [id, label || "New device", hashToken(token), Date.now(), deviceScope]
  );
  return { id, label: label || "New device", token, scope: deviceScope };
}

async function redeemPairingCode(code, deviceLabel) {
  await init();
  const now = Date.now();
  // Atomic single-use claim: the guarded UPDATE + device creation run in one
  // transaction so two harnesses racing the same code yield exactly one device.
  return await q.tx(async (t) => {
    const info = await t.run(
      "UPDATE pairing_codes SET redeemed_at = ? WHERE code = ? AND redeemed_at IS NULL AND expires_at > ?",
      [now, code, now]
    );
    if (info.changes === 0) return null; // invalid, expired, or already used
    const row = await t.get("SELECT * FROM pairing_codes WHERE code = ?", [code]);
    return await _createDevice(t, deviceLabel || (row && row.label), row && row.scope);
  });
}

async function createDevice(label, scope) {
  await init();
  return await _createDevice(q, label, scope);
}

async function getDeviceByToken(token) {
  await init();
  if (!token) return null;
  const row = await q.get("SELECT * FROM devices WHERE token_hash = ?", [hashToken(token)]);
  if (!row || row.revoked_at) return null;
  return mapDeviceRow(row);
}

async function touchDeviceLastSeen(id) {
  await init();
  await q.run("UPDATE devices SET last_seen = ? WHERE id = ?", [Date.now(), id]);
}

// Fetch a single device by id (incl. tenantId) — for tenant ownership checks.
async function getDevice(id) {
  await init();
  const row = await q.get("SELECT * FROM devices WHERE id = ?", [id]);
  return row ? mapDeviceRow(row) : null;
}

async function listDevices() {
  await init();
  const rows = await q.all("SELECT * FROM devices ORDER BY created_at DESC");
  return rows.map((row) => {
    const d = mapDeviceRow(row);
    const { apiKey, ...rest } = d.llmConfig || {};
    d.llmConfig = { ...rest, hasApiKey: Boolean(apiKey) };
    return d;
  });
}

async function renameDevice(id, label) {
  await init();
  await q.run("UPDATE devices SET label = ? WHERE id = ?", [label, id]);
}

async function revokeDevice(id) {
  await init();
  await q.run("UPDATE devices SET revoked_at = ? WHERE id = ?", [Date.now(), id]);
  try { await q.run("DELETE FROM device_llm_tokens WHERE device_id = ?", [id]); } catch {}
}

async function setDevicePolicyOverrides(id, overrides) {
  await init();
  const json = JSON.stringify(overrides && typeof overrides === "object" ? overrides : {});
  await q.run("UPDATE devices SET policy_overrides = ? WHERE id = ?", [json, id]);
}

// ── Scoped per-device LLM tokens ────────────────────────────────────
async function mintDeviceLlmToken(deviceId, { budget, sessionId } = {}) {
  await init();
  const row = await q.get("SELECT id, revoked_at FROM devices WHERE id = ?", [deviceId]);
  if (!row || row.revoked_at) return null;
  const now = Date.now();
  if (Number.isFinite(budget) && budget > 0) {
    await q.run("UPDATE devices SET llm_budget = ? WHERE id = ?", [Math.floor(budget), deviceId]);
  }
  if (sessionId) await q.run("DELETE FROM device_llm_tokens WHERE device_id = ? AND session_id = ?", [deviceId, sessionId]);
  await q.run("DELETE FROM device_llm_tokens WHERE device_id = ? AND created_at < ?", [deviceId, now - 24 * 60 * 60 * 1000]);
  const token = crypto.randomBytes(32).toString("hex");
  await q.run("INSERT INTO device_llm_tokens (token_hash, device_id, session_id, created_at) VALUES (?, ?, ?, ?)",
    [hashToken(token), deviceId, sessionId || null, now]);
  return token;
}

async function getDeviceByLlmToken(token) {
  await init();
  if (!token) return null;
  const tok = await q.get("SELECT device_id FROM device_llm_tokens WHERE token_hash = ?", [hashToken(token)]);
  if (!tok) return null;
  const row = await q.get("SELECT * FROM devices WHERE id = ?", [tok.device_id]);
  if (!row || row.revoked_at) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id || null,
    budget: row.llm_budget == null ? null : Number(row.llm_budget),
    used: Number(row.llm_used || 0),
  };
}

async function recordDeviceLlmUsage(deviceId, tokens) {
  await init();
  const n = Number(tokens) || 0;
  if (!deviceId || n <= 0) return;
  await q.run("UPDATE devices SET llm_used = llm_used + ? WHERE id = ?", [n, deviceId]);
}

async function setDeviceLlmConfig(id, cfg) {
  await init();
  let clean = {};
  if (cfg && typeof cfg === "object") {
    if (cfg.provider === "orbit") {
      clean = { provider: "orbit", model: cfg.model ? String(cfg.model) : "" };
    } else if (cfg.baseURL) {
      clean = { baseURL: String(cfg.baseURL), apiKey: cfg.apiKey ? String(cfg.apiKey) : "", model: cfg.model ? String(cfg.model) : "" };
    }
  }
  await q.run("UPDATE devices SET llm_config = ? WHERE id = ?", [JSON.stringify(clean), id]);
}

function mapDeviceRow(row) {
  let llmConfig = {};
  try { llmConfig = JSON.parse(row.llm_config || "{}"); } catch {}
  return {
    id: row.id,
    label: row.label,
    createdAt: row.created_at,
    lastSeen: row.last_seen,
    revoked: Boolean(row.revoked_at),
    scope: row.scope || "full",
    tenantId: row.tenant_id || null,
    policyOverrides: JSON.parse(row.policy_overrides || "{}"),
    llmConfig,
    llmBudget: row.llm_budget == null ? null : Number(row.llm_budget),
    llmUsed: Number(row.llm_used || 0),
  };
}

// ── Session profiles ────────────────────────────────────────────────
function mapProfileRow(row) {
  return { id: row.id, name: row.name, ...JSON.parse(row.config_json || "{}"), createdAt: row.created_at, updatedAt: row.updated_at };
}

async function listProfiles() {
  await init();
  return (await q.all("SELECT * FROM profiles ORDER BY created_at ASC")).map(mapProfileRow);
}

async function getProfile(id) {
  await init();
  const row = await q.get("SELECT * FROM profiles WHERE id = ?", [id]);
  return row ? mapProfileRow(row) : null;
}

async function saveProfile(profile) {
  await init();
  const id = profile.id || crypto.randomUUID();
  const now = Date.now();
  const { id: _i, name, createdAt, updatedAt, ...config } = profile;
  const existing = await q.get("SELECT created_at FROM profiles WHERE id = ?", [id]);
  await q.run(`
    INSERT INTO profiles (id, name, config_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, config_json = excluded.config_json, updated_at = excluded.updated_at
  `, [id, name || "Untitled profile", JSON.stringify(config), existing ? existing.created_at : now, now]);
  return getProfile(id);
}

async function deleteProfile(id) {
  await init();
  await q.run("DELETE FROM profiles WHERE id = ?", [id]);
}

async function countProfiles() {
  await init();
  return (await q.get("SELECT COUNT(*) AS n FROM profiles")).n;
}

// ── Event channels ──────────────────────────────────────────────────
function mapChannelRow(row) {
  return { id: row.id, name: row.name, ...JSON.parse(row.config_json || "{}"), lastTriggered: row.last_triggered, createdAt: row.created_at, updatedAt: row.updated_at };
}

async function listChannels() {
  await init();
  return (await q.all("SELECT * FROM channels ORDER BY created_at ASC")).map(mapChannelRow);
}

async function getChannel(id) {
  await init();
  const row = await q.get("SELECT * FROM channels WHERE id = ?", [id]);
  return row ? mapChannelRow(row) : null;
}

async function saveChannel(channel) {
  await init();
  const id = channel.id || crypto.randomUUID();
  const now = Date.now();
  const { id: _i, name, lastTriggered, createdAt, updatedAt, ...config } = channel;
  const existing = await q.get("SELECT created_at FROM channels WHERE id = ?", [id]);
  await q.run(`
    INSERT INTO channels (id, name, config_json, created_at, updated_at, last_triggered)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, config_json = excluded.config_json, updated_at = excluded.updated_at
  `, [id, name || "Untitled channel", JSON.stringify(config), existing ? existing.created_at : now, now, null]);
  return getChannel(id);
}

async function touchChannelTriggered(id) {
  await init();
  await q.run("UPDATE channels SET last_triggered = ? WHERE id = ?", [Date.now(), id]);
}

async function deleteChannel(id) {
  await init();
  await q.run("DELETE FROM channels WHERE id = ?", [id]);
}

// ── Service connections (OAuth / token) ─────────────────────────────
function mapConnectionRow(row) {
  return {
    provider: row.provider, kind: row.kind,
    scopes: row.scopes ? row.scopes.split(" ").filter(Boolean) : [],
    accessTokenEnc: row.access_token_enc, refreshTokenEnc: row.refresh_token_enc,
    expiresAt: row.expires_at, meta: JSON.parse(row.meta || "{}"),
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

async function listConnections() {
  await init();
  return (await q.all("SELECT * FROM connections ORDER BY created_at ASC")).map(mapConnectionRow);
}

async function getConnection(provider) {
  await init();
  const row = await q.get("SELECT * FROM connections WHERE provider = ?", [provider]);
  return row ? mapConnectionRow(row) : null;
}

async function saveConnection(c) {
  await init();
  const now = Date.now();
  const existing = await q.get("SELECT created_at FROM connections WHERE provider = ?", [c.provider]);
  await q.run(`
    INSERT INTO connections (provider, kind, scopes, access_token_enc, refresh_token_enc, expires_at, meta, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider) DO UPDATE SET
      kind = excluded.kind, scopes = excluded.scopes,
      access_token_enc = excluded.access_token_enc, refresh_token_enc = excluded.refresh_token_enc,
      expires_at = excluded.expires_at, meta = excluded.meta, updated_at = excluded.updated_at
  `, [
    c.provider, c.kind, (c.scopes || []).join(" "),
    c.accessTokenEnc || "", c.refreshTokenEnc || "", c.expiresAt || null,
    JSON.stringify(c.meta || {}), existing ? existing.created_at : now, now,
  ]);
  return getConnection(c.provider);
}

async function deleteConnection(provider) {
  await init();
  await q.run("DELETE FROM connections WHERE provider = ?", [provider]);
}

// ── Secrets (tenant-scoped, encrypted-at-rest) ──────────────────────
// The store holds ONLY ciphertext (value_enc); encrypt/decrypt is the caller's
// job (crypto-store), mirroring the connections table. tenant_id is normalized
// to '' for the "no tenant" bucket (dev/superadmin) so the composite PK stays
// NULL-free and lookups are exact in both dialects.
const secretTenant = (tenantId) => (tenantId == null ? "" : String(tenantId));

function mapSecretRow(row) {
  return {
    tenantId: row.tenant_id || null,
    name: row.name,
    valueEnc: row.value_enc,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function setSecret({ tenantId, name, valueEnc }) {
  await init();
  const now = Date.now();
  const tid = secretTenant(tenantId);
  const existing = await q.get("SELECT created_at FROM secrets WHERE tenant_id = ? AND name = ?", [tid, name]);
  await q.run(`
    INSERT INTO secrets (tenant_id, name, value_enc, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, name) DO UPDATE SET
      value_enc = excluded.value_enc, updated_at = excluded.updated_at
  `, [tid, name, valueEnc || "", existing ? existing.created_at : now, now]);
  return getSecret(tenantId, name);
}

async function getSecret(tenantId, name) {
  await init();
  const row = await q.get("SELECT * FROM secrets WHERE tenant_id = ? AND name = ?", [secretTenant(tenantId), name]);
  return row ? mapSecretRow(row) : null;
}

// All of a tenant's secrets INCLUDING ciphertext — for spawn-time resolution
// only. Callers decrypt (secrets-resolver); this is NEVER returned over the API.
async function getSecretsForTenant(tenantId) {
  await init();
  const rows = await q.all("SELECT * FROM secrets WHERE tenant_id = ? ORDER BY name ASC", [secretTenant(tenantId)]);
  return rows.map(mapSecretRow);
}

// Safe listing for the API: names + presence + timestamps, NEVER the ciphertext
// or value.
async function listSecrets(tenantId) {
  await init();
  const rows = await q.all(
    "SELECT name, value_enc, created_at, updated_at FROM secrets WHERE tenant_id = ? ORDER BY name ASC",
    [secretTenant(tenantId)]
  );
  return rows.map((r) => ({
    name: r.name,
    hasValue: !!(r.value_enc && r.value_enc.length),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

async function deleteSecret(tenantId, name) {
  await init();
  const r = await q.run("DELETE FROM secrets WHERE tenant_id = ? AND name = ?", [secretTenant(tenantId), name]);
  return !!(r && r.changes);
}

// ── Runs (many-per-session, versioned; the run-API's unit of work) ───
// A run is one execution against a session's durable context. Re-running the
// same/refined task on the same session produces a NEW versioned run (seq
// v1,v2,…), each with its own status + contract snapshot. contract_json holds
// the full result contract; the columns are for indexing/listing.
function mapRunRow(row) {
  let contract = {};
  try { contract = JSON.parse(row.contract_json || "{}"); } catch {}
  return {
    runId: row.run_id, sessionId: row.session_id, seq: Number(row.seq),
    tenantId: row.tenant_id || null, status: row.status,
    prompt: row.prompt || "", source: row.source || "api", mode: row.mode || "",
    contract, startedAt: row.started_at, endedAt: row.ended_at || null,
  };
}

// Next version number for a session (1-based). Runs are ordered v1, v2, ….
async function nextRunSeq(sessionId) {
  await init();
  const row = await q.get("SELECT MAX(seq) AS maxSeq FROM runs WHERE session_id = ?", [sessionId]);
  return (row && row.maxSeq ? Number(row.maxSeq) : 0) + 1;
}

async function createRun({ runId, sessionId, seq, tenantId, status, prompt, source, mode }) {
  await init();
  const now = Date.now();
  await q.run(`
    INSERT INTO runs (run_id, session_id, seq, tenant_id, status, prompt, source, mode, contract_json, started_at, ended_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, NULL)
  `, [runId, sessionId, seq, tenantId || null, status || "running", prompt || "", source || "api", mode || "", now]);
  return getRun(runId);
}

async function getRun(runId) {
  await init();
  const row = await q.get("SELECT * FROM runs WHERE run_id = ?", [runId]);
  return row ? mapRunRow(row) : null;
}

// Patch a run's terminal state. `contract` (object) is stored as JSON; `status`
// and `endedAt` are set when provided.
async function updateRun(runId, { status, contract, endedAt } = {}) {
  await init();
  const cur = await q.get("SELECT * FROM runs WHERE run_id = ?", [runId]);
  if (!cur) return null;
  const nextStatus = status !== undefined ? status : cur.status;
  const nextContract = contract !== undefined ? JSON.stringify(contract || {}) : cur.contract_json;
  const nextEnded = endedAt !== undefined ? endedAt : cur.ended_at;
  await q.run("UPDATE runs SET status = ?, contract_json = ?, ended_at = ? WHERE run_id = ?",
    [nextStatus, nextContract, nextEnded, runId]);
  return getRun(runId);
}

// Version history for a session: seq, status, timestamps, and a one-line summary
// (pulled from the stored contract). Newest first.
async function listSessionRuns(sessionId) {
  await init();
  const rows = await q.all("SELECT * FROM runs WHERE session_id = ? ORDER BY seq DESC", [sessionId]);
  return rows.map((r) => {
    const m = mapRunRow(r);
    return {
      runId: m.runId, seq: m.seq, status: m.status,
      summary: m.contract.summary || "", startedAt: m.startedAt, endedAt: m.endedAt,
    };
  });
}

async function deleteRunsForSession(sessionId) {
  await init();
  await q.run("DELETE FROM runs WHERE session_id = ?", [sessionId]);
}

// ── Connectors (tenant-scoped MCP servers; Gap 3) ───────────────────
// User-registered MCP tool servers, isolated to the tenant of the API key that
// registered them. Orbit's OWN servers (fleet/notify/search/…) stay in the
// global .pi/mcp.json (shared) and are NOT stored here. def_json holds the
// connector definition ({ command, args, env } | { url }); env may carry
// ${secret:NAME} references resolved at spawn. tenant_id '' = dev/local bucket.
const connectorTenant = (tenantId) => (tenantId == null ? "" : String(tenantId));

function mapConnectorRow(row) {
  let def = {};
  try { def = JSON.parse(row.def_json || "{}"); } catch {}
  return {
    tenantId: row.tenant_id || null, name: row.name, def,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

async function upsertConnector({ tenantId, name, def }) {
  await init();
  const now = Date.now();
  const tid = connectorTenant(tenantId);
  const existing = await q.get("SELECT created_at FROM connectors WHERE tenant_id = ? AND name = ?", [tid, name]);
  await q.run(`
    INSERT INTO connectors (tenant_id, name, def_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, name) DO UPDATE SET
      def_json = excluded.def_json, updated_at = excluded.updated_at
  `, [tid, name, JSON.stringify(def || {}), existing ? existing.created_at : now, now]);
  return getConnector(tenantId, name);
}

async function getConnector(tenantId, name) {
  await init();
  const row = await q.get("SELECT * FROM connectors WHERE tenant_id = ? AND name = ?", [connectorTenant(tenantId), name]);
  return row ? mapConnectorRow(row) : null;
}

async function listConnectorsForTenant(tenantId) {
  await init();
  const rows = await q.all("SELECT * FROM connectors WHERE tenant_id = ? ORDER BY name ASC", [connectorTenant(tenantId)]);
  return rows.map(mapConnectorRow);
}

async function deleteConnector(tenantId, name) {
  await init();
  const r = await q.run("DELETE FROM connectors WHERE tenant_id = ? AND name = ?", [connectorTenant(tenantId), name]);
  return !!(r && r.changes);
}

// ── Templates (tenant-scoped output-constraint layer) ───────────────
// Per-tenant "what the runtime may produce" documents: allowed languages,
// allowed/denied packages, structure rules + conventions (compiled into the
// system prompt) and an optional workspace scaffold. Distinct from profiles
// ("how the runtime runs"). def_json holds the template document; source_url is
// an optional tenant repo/URL the def can be synced from. tenant_id '' = dev bucket.
const templateTenant = (tenantId) => (tenantId == null ? "" : String(tenantId));

function mapTemplateRow(row) {
  let def = {};
  try { def = JSON.parse(row.def_json || "{}"); } catch {}
  return {
    tenantId: row.tenant_id || null, id: row.id, name: row.name, def,
    sourceUrl: row.source_url || "", sourceEtag: row.source_etag || "",
    fetchedAt: row.fetched_at || null,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

async function upsertTemplate({ tenantId, id, name, def, sourceUrl, sourceEtag, fetchedAt }) {
  await init();
  const now = Date.now();
  const tid = templateTenant(tenantId);
  const existing = await q.get("SELECT created_at FROM templates WHERE tenant_id = ? AND id = ?", [tid, id]);
  await q.run(`
    INSERT INTO templates (tenant_id, id, name, def_json, source_url, source_etag, fetched_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, id) DO UPDATE SET
      name = excluded.name, def_json = excluded.def_json,
      source_url = excluded.source_url, source_etag = excluded.source_etag,
      fetched_at = excluded.fetched_at, updated_at = excluded.updated_at
  `, [tid, id, name || id, JSON.stringify(def || {}), sourceUrl || "", sourceEtag || "",
      fetchedAt || null, existing ? existing.created_at : now, now]);
  return getTemplate(tenantId, id);
}

async function getTemplate(tenantId, id) {
  await init();
  const row = await q.get("SELECT * FROM templates WHERE tenant_id = ? AND id = ?", [templateTenant(tenantId), id]);
  return row ? mapTemplateRow(row) : null;
}

async function listTemplatesForTenant(tenantId) {
  await init();
  const rows = await q.all("SELECT * FROM templates WHERE tenant_id = ? ORDER BY name ASC", [templateTenant(tenantId)]);
  return rows.map(mapTemplateRow);
}

async function deleteTemplate(tenantId, id) {
  await init();
  const r = await q.run("DELETE FROM templates WHERE tenant_id = ? AND id = ?", [templateTenant(tenantId), id]);
  return !!(r && r.changes);
}

// ── Access control: tenants / API keys / SSO ────────────────────────
const VALID_ROLES = new Set(["superadmin", "admin", "member", "viewer"]);
const normalizeRole = (r) => (VALID_ROLES.has(r) ? r : "member");
const API_KEY_PREFIX = "orb_live_";

// ── Tenants ──
async function createTenant(name) {
  await init();
  const id = crypto.randomUUID();
  await q.run(
    "INSERT INTO tenants (id, name, status, sso_enabled, sso_config, created_at) VALUES (?, ?, 'active', 0, '{}', ?)",
    [id, String(name || "Tenant").slice(0, 120), Date.now()]
  );
  return getTenant(id);
}
async function listTenants() {
  await init();
  return (await q.all("SELECT * FROM tenants ORDER BY created_at DESC")).map(mapTenantRow);
}
async function getTenant(id) {
  await init();
  const row = await q.get("SELECT * FROM tenants WHERE id = ?", [id]);
  return row ? mapTenantRow(row) : null;
}
async function updateTenant(id, fields = {}) {
  await init();
  const t = await q.get("SELECT * FROM tenants WHERE id = ?", [id]);
  if (!t) return null;
  const name = fields.name !== undefined ? String(fields.name).slice(0, 120) : t.name;
  const status = fields.status !== undefined ? String(fields.status) : t.status;
  const ssoEnabled = fields.ssoEnabled !== undefined ? (fields.ssoEnabled ? 1 : 0) : t.sso_enabled;
  const ssoConfig = fields.ssoConfig !== undefined ? JSON.stringify(fields.ssoConfig || {}) : t.sso_config;
  await q.run("UPDATE tenants SET name = ?, status = ?, sso_enabled = ?, sso_config = ? WHERE id = ?",
    [name, status, ssoEnabled, ssoConfig, id]);
  return getTenant(id);
}
async function deleteTenant(id) {
  await init();
  await q.tx(async (t) => {
    await t.run("DELETE FROM tenants WHERE id = ?", [id]);
    await t.run("UPDATE api_keys SET revoked_at = ? WHERE tenant_id = ? AND revoked_at IS NULL", [Date.now(), id]);
    await t.run("DELETE FROM users WHERE tenant_id = ?", [id]);
  });
}
function mapTenantRow(row) {
  return {
    id: row.id, name: row.name, status: row.status || "active",
    ssoEnabled: !!row.sso_enabled, ssoConfig: JSON.parse(row.sso_config || "{}"), createdAt: row.created_at,
  };
}

// ── API keys ── (raw key returned once; only the hash is stored)
async function createApiKey({ tenantId = null, label, role, scope, createdBy = null } = {}) {
  await init();
  const id = crypto.randomUUID();
  const key = API_KEY_PREFIX + crypto.randomBytes(24).toString("hex");
  const prefix = key.slice(0, API_KEY_PREFIX.length + 6) + "…";
  const safeLabel = String(label || "API key").slice(0, 100);
  const r = normalizeRole(role);
  const s = normalizeScope(scope);
  await q.run(`
    INSERT INTO api_keys (id, tenant_id, label, key_hash, key_prefix, role, scope, created_at, last_used, revoked_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
  `, [id, tenantId, safeLabel, hashToken(key), prefix, r, s, Date.now(), createdBy]);
  return { id, tenantId, label: safeLabel, role: r, scope: s, keyPrefix: prefix, key };
}
async function getApiKeyByToken(token) {
  await init();
  if (!token) return null;
  const row = await q.get("SELECT * FROM api_keys WHERE key_hash = ?", [hashToken(token)]);
  if (!row || row.revoked_at) return null;
  return mapApiKeyRow(row);
}
async function getApiKey(id) {
  await init();
  const row = await q.get("SELECT * FROM api_keys WHERE id = ?", [id]);
  return row ? mapApiKeyRow(row) : null;
}
async function touchApiKeyUsed(id) {
  await init();
  try { await q.run("UPDATE api_keys SET last_used = ? WHERE id = ?", [Date.now(), id]); } catch {}
}
async function listApiKeys(tenantId) {
  await init();
  const rows = tenantId
    ? await q.all("SELECT * FROM api_keys WHERE tenant_id = ? ORDER BY created_at DESC", [tenantId])
    : await q.all("SELECT * FROM api_keys ORDER BY created_at DESC");
  return rows.map(mapApiKeyRow);
}
async function revokeApiKey(id) {
  await init();
  await q.run("UPDATE api_keys SET revoked_at = ? WHERE id = ?", [Date.now(), id]);
}
function mapApiKeyRow(row) {
  return {
    id: row.id, tenantId: row.tenant_id || null, label: row.label, keyPrefix: row.key_prefix,
    role: row.role || "member", scope: row.scope || "full", createdAt: row.created_at,
    lastUsed: row.last_used, revoked: !!row.revoked_at, createdBy: row.created_by || null,
  };
}

// ── SSO users ── (provisioned on first OIDC login)
async function upsertUser({ email, sub, tenantId = null, role } = {}) {
  await init();
  const normEmail = String(email || "").toLowerCase();
  const existing = await q.get("SELECT * FROM users WHERE email = ?", [normEmail]);
  if (existing) {
    const nextRole = role !== undefined ? normalizeRole(role) : existing.role;
    await q.run("UPDATE users SET sub = ?, tenant_id = ?, role = ?, last_login = ? WHERE id = ?",
      [sub || existing.sub, tenantId ?? existing.tenant_id, nextRole, Date.now(), existing.id]);
    return getUser(existing.id);
  }
  const id = crypto.randomUUID();
  await q.run("INSERT INTO users (id, tenant_id, email, sub, role, created_at, last_login) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [id, tenantId, normEmail, sub || null, normalizeRole(role), Date.now(), Date.now()]);
  return getUser(id);
}
async function getUser(id) {
  await init();
  const row = await q.get("SELECT * FROM users WHERE id = ?", [id]);
  return row ? mapUserRow(row) : null;
}
async function listUsers(tenantId) {
  await init();
  const rows = tenantId
    ? await q.all("SELECT * FROM users WHERE tenant_id = ? ORDER BY created_at DESC", [tenantId])
    : await q.all("SELECT * FROM users ORDER BY created_at DESC");
  return rows.map(mapUserRow);
}
async function setUserRole(id, role) {
  await init();
  await q.run("UPDATE users SET role = ? WHERE id = ?", [normalizeRole(role), id]);
}
async function countUsers() {
  await init();
  return (await q.get("SELECT COUNT(*) AS n FROM users")).n;
}
function mapUserRow(row) {
  return {
    id: row.id, tenantId: row.tenant_id || null, email: row.email, sub: row.sub || null,
    username: row.username || null, hasPassword: !!row.password_hash, role: row.role || "member",
    createdAt: row.created_at, lastLogin: row.last_login,
  };
}

// ── Local accounts (username + password) ──
async function getUserByUsername(username) {
  await init();
  if (!username) return null;
  const row = await q.get("SELECT * FROM users WHERE username = ?", [String(username)]);
  return row ? mapUserRow(row) : null;
}

async function createLocalUser({ username, password, role, tenantId = null } = {}) {
  await init();
  const id = crypto.randomUUID();
  const uname = String(username);
  await q.run(`
    INSERT INTO users (id, tenant_id, email, sub, username, password_hash, role, created_at, last_login)
    VALUES (?, ?, ?, NULL, ?, ?, ?, ?, NULL)
  `, [id, tenantId, `${uname}@local`, uname, hashPassword(password), normalizeRole(role), Date.now()]);
  return getUser(id);
}

async function setUserPassword(id, password) {
  await init();
  await q.run("UPDATE users SET password_hash = ? WHERE id = ?", [hashPassword(password), id]);
}

async function verifyLocalLogin(username, password) {
  await init();
  const row = await q.get("SELECT * FROM users WHERE username = ?", [String(username || "")]);
  if (!row || !row.password_hash) return null;
  if (!verifyPassword(password, row.password_hash)) return null;
  await q.run("UPDATE users SET last_login = ? WHERE id = ?", [Date.now(), row.id]);
  return mapUserRow(row);
}

async function ensureSuperadminAccount({ username, password } = {}) {
  await init();
  const uname = String(username || "admin");
  const existing = await q.get("SELECT * FROM users WHERE username = ?", [uname]);
  if (existing) {
    if (existing.role !== "superadmin") await q.run("UPDATE users SET role='superadmin' WHERE id=?", [existing.id]);
    if (password) await q.run("UPDATE users SET password_hash=? WHERE id=?", [hashPassword(password), existing.id]);
    return { id: existing.id, username: uname, created: false, passwordUpdated: !!password };
  }
  if (!password) throw new Error("ensureSuperadminAccount: a password is required to create the account");
  const id = crypto.randomUUID();
  await q.run(`
    INSERT INTO users (id, tenant_id, email, sub, username, password_hash, role, created_at, last_login)
    VALUES (?, NULL, ?, NULL, ?, ?, 'superadmin', ?, NULL)
  `, [id, `${uname}@local`, uname, hashPassword(password), Date.now()]);
  return { id, username: uname, created: true };
}

// ── SSO browser sessions ──
const SSO_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h
async function createSsoSession(userId, ttlMs = SSO_SESSION_TTL_MS) {
  await init();
  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  await q.run("INSERT INTO sso_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    [hashToken(token), userId, now, now + ttlMs]);
  return { token, expiresAt: now + ttlMs };
}
async function getSsoSessionByToken(token) {
  await init();
  if (!token) return null;
  const row = await q.get("SELECT * FROM sso_sessions WHERE token_hash = ?", [hashToken(token)]);
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    try { await q.run("DELETE FROM sso_sessions WHERE token_hash = ?", [row.token_hash]); } catch {}
    return null;
  }
  const user = await getUser(row.user_id);
  if (!user) return null;
  return { user, expiresAt: row.expires_at };
}
async function revokeSsoSession(token) {
  await init();
  if (!token) return;
  try { await q.run("DELETE FROM sso_sessions WHERE token_hash = ?", [hashToken(token)]); } catch {}
}

module.exports = {
  init,
  dialect: q.dialect,
  saveSession, getSession, getAllSessions, deleteSession, searchSessions,
  performBackup, getBackups,
  createPairingCode, redeemPairingCode, createDevice, getDeviceByToken,
  touchDeviceLastSeen, getDevice, listDevices, renameDevice, revokeDevice, setDevicePolicyOverrides,
  mintDeviceLlmToken, getDeviceByLlmToken, recordDeviceLlmUsage, setDeviceLlmConfig,
  listProfiles, getProfile, saveProfile, deleteProfile, countProfiles,
  listChannels, getChannel, saveChannel, touchChannelTriggered, deleteChannel,
  setSessionRunning, clearSessionRunning, listInterruptedSessions,
  listConnections, getConnection, saveConnection, deleteConnection,
  // Secrets (tenant-scoped, encrypted-at-rest)
  setSecret, getSecret, getSecretsForTenant, listSecrets, deleteSecret,
  // Runs (versioned executions + result contracts)
  nextRunSeq, createRun, getRun, updateRun, listSessionRuns, deleteRunsForSession,
  // Connectors (tenant-scoped MCP servers)
  upsertConnector, getConnector, listConnectorsForTenant, deleteConnector,
  // Templates (tenant-scoped output-constraint layer)
  upsertTemplate, getTemplate, listTemplatesForTenant, deleteTemplate,
  // Access control (tenants / API keys / SSO)
  createTenant, listTenants, getTenant, updateTenant, deleteTenant,
  createApiKey, getApiKey, getApiKeyByToken, touchApiKeyUsed, listApiKeys, revokeApiKey,
  upsertUser, getUser, listUsers, setUserRole, countUsers,
  getUserByUsername, createLocalUser, setUserPassword, verifyLocalLogin, ensureSuperadminAccount,
  createSsoSession, getSsoSessionByToken, revokeSsoSession,
};
