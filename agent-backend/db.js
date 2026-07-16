const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

// ORBIT_DB_PATH lets deployments (e.g. Docker) point the SQLite file at a
// mounted volume for persistence; defaults to the in-repo file. Ensure the
// parent dir exists so a fresh volume path works on first boot.
const dbPath = process.env.ORBIT_DB_PATH || path.join(__dirname, "orbit.db");
try { fs.mkdirSync(path.dirname(dbPath), { recursive: true }); } catch {}
// Rebrand migration: carry the pre-rebrand database over so no data is lost.
const legacyDbPath = path.join(__dirname, "aegis.db");
if (!fs.existsSync(dbPath) && fs.existsSync(legacyDbPath)) {
  try {
    for (const suffix of ["", "-wal", "-shm"]) {
      if (fs.existsSync(legacyDbPath + suffix)) fs.renameSync(legacyDbPath + suffix, dbPath + suffix);
    }
    console.log("[DB] Migrated aegis.db → orbit.db (rebrand).");
  } catch (e) {
    console.error("[DB] rebrand migration failed:", e.message);
  }
}
const db = new DatabaseSync(dbPath);

// ── Schema Versioning ───────────────────────────────────────────────
const CURRENT_SCHEMA_VERSION = 14;
const BACKUP_INTERVAL = 10; // auto-backup every N saves
let saveCount = 0;

// Meta table for key-value configuration (schema version, etc.)
db.exec(`
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);

// ── Initialize tables ────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    messages TEXT NOT NULL,
    logs TEXT NOT NULL,
    execution_plan TEXT NOT NULL,
    metrics TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT '',
    subagent_tree TEXT NOT NULL DEFAULT '{}',
    timestamp INTEGER NOT NULL
  )
`);

// Self-healing check: Ensure all columns from later migrations exist on the sessions table.
// This repairs cases where a fresh DB boot bypasses Alter Table statements.
try {
  const columns = db.prepare("PRAGMA table_info(sessions)").all().map((c) => c.name);
  const columnSet = new Set(columns);
  if (!columnSet.has("schema_version")) {
    try { db.exec("ALTER TABLE sessions ADD COLUMN schema_version INTEGER DEFAULT 0"); } catch (e) {}
  }
  if (!columnSet.has("run_state")) {
    try { db.exec("ALTER TABLE sessions ADD COLUMN run_state TEXT NOT NULL DEFAULT '{}'"); } catch (e) {}
  }
  if (!columnSet.has("plan_steps")) {
    try { db.exec("ALTER TABLE sessions ADD COLUMN plan_steps TEXT NOT NULL DEFAULT '[]'"); } catch (e) {}
  }
  if (!columnSet.has("plans")) {
    try { db.exec("ALTER TABLE sessions ADD COLUMN plans TEXT NOT NULL DEFAULT '[]'"); } catch (e) {}
  }
  if (!columnSet.has("active_plan_id")) {
    try { db.exec("ALTER TABLE sessions ADD COLUMN active_plan_id TEXT NOT NULL DEFAULT ''"); } catch (e) {}
  }
  if (!columnSet.has("tenant_id")) {
    // Nullable per-tenant TAG (see schema v13); not enforced isolation.
    try { db.exec("ALTER TABLE sessions ADD COLUMN tenant_id TEXT"); } catch (e) {}
  }
} catch (e) {
  console.error("[DB] Self-healing check failed:", e.message);
}

// Read current schema version from meta table
let currentSchemaVersion = 0;
try {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get("schema_version");
  if (row) currentSchemaVersion = parseInt(row.value, 10);
} catch (e) {
  // meta table might be empty, that's fine
}

// ── Schema Migrations ───────────────────────────────────────────────

if (currentSchemaVersion < 2) {
  try {
    db.exec("ALTER TABLE sessions ADD COLUMN schema_version INTEGER DEFAULT 0");
  } catch (e) {
    // Column may already exist from a partial migration; ignore
  }
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
    "schema_version",
    String(CURRENT_SCHEMA_VERSION)
  );
  console.log(`[DB] Migrated sessions schema to version ${CURRENT_SCHEMA_VERSION}`);
}

if (currentSchemaVersion < 3) {
  try {
    db.exec("ALTER TABLE sessions ADD COLUMN mode TEXT NOT NULL DEFAULT ''");
  } catch (e) {
    // Column may already exist from a partial migration; ignore
  }
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
    "schema_version",
    String(CURRENT_SCHEMA_VERSION)
  );
  console.log(`[DB] Migrated sessions schema to version ${CURRENT_SCHEMA_VERSION}`);
}

if (currentSchemaVersion < 4) {
  try {
    db.exec("ALTER TABLE sessions ADD COLUMN subagent_tree TEXT NOT NULL DEFAULT '{}'");
  } catch (e) {
    // Column may already exist from a partial migration; ignore
  }
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
    "schema_version",
    String(CURRENT_SCHEMA_VERSION)
  );
  console.log(`[DB] Migrated sessions schema to version ${CURRENT_SCHEMA_VERSION}`);
}

if (currentSchemaVersion < 5) {
  // Device identity + pairing tables (see createDevice/createPairingCode below).
  db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_seen INTEGER,
      revoked_at INTEGER,
      policy_overrides TEXT NOT NULL DEFAULT '{}'
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS pairing_codes (
      code TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      redeemed_at INTEGER
    )
  `);
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
    "schema_version",
    String(CURRENT_SCHEMA_VERSION)
  );
  console.log(`[DB] Migrated sessions schema to version ${CURRENT_SCHEMA_VERSION}`);
}

if (currentSchemaVersion < 6) {
  // Per-device scope chosen at pairing time: 'full' | 'chat_voice' | 'read_only'.
  try { db.exec("ALTER TABLE devices ADD COLUMN scope TEXT NOT NULL DEFAULT 'full'"); } catch (e) {}
  try { db.exec("ALTER TABLE pairing_codes ADD COLUMN scope TEXT NOT NULL DEFAULT 'full'"); } catch (e) {}
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
    "schema_version",
    String(CURRENT_SCHEMA_VERSION)
  );
  console.log(`[DB] Migrated sessions schema to version ${CURRENT_SCHEMA_VERSION}`);
}

if (currentSchemaVersion < 7) {
  // Session profiles: named, reusable bundles of harness/mode/effort/prompt/
  // skills/tools (see routes/profiles.js).
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      config_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
    "schema_version",
    String(CURRENT_SCHEMA_VERSION)
  );
  console.log(`[DB] Migrated sessions schema to version ${CURRENT_SCHEMA_VERSION}`);
}

if (currentSchemaVersion < 8) {
  // Event channels: inbound triggers (webhook / schedule) that run a profile
  // headlessly (see routes/channels.js).
  db.exec(`
    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      config_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_triggered INTEGER
    )
  `);
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
    "schema_version",
    String(CURRENT_SCHEMA_VERSION)
  );
  console.log(`[DB] Migrated sessions schema to version ${CURRENT_SCHEMA_VERSION}`);
}

if (currentSchemaVersion < 9) {
  // Durable resume: run_state = { running, activePrompt, mode, startedAt }.
  // A session left `running` (harness died / server restarted mid-turn) is
  // detected as interrupted and can be resumed (see server.js resume handler).
  try { db.exec("ALTER TABLE sessions ADD COLUMN run_state TEXT NOT NULL DEFAULT '{}'"); } catch (e) {}
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
    "schema_version",
    String(CURRENT_SCHEMA_VERSION)
  );
  console.log(`[DB] Migrated sessions schema to version ${CURRENT_SCHEMA_VERSION}`);
}

if (currentSchemaVersion < 10) {
  // Service connections (OAuth / token). Tokens are ENCRYPTED-at-rest (see
  // crypto-store.js), not hashed — we replay them to the provider.
  db.exec(`
    CREATE TABLE IF NOT EXISTS connections (
      provider TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      scopes TEXT NOT NULL DEFAULT '',
      access_token_enc TEXT NOT NULL DEFAULT '',
      refresh_token_enc TEXT NOT NULL DEFAULT '',
      expires_at INTEGER,
      meta TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
    "schema_version",
    String(CURRENT_SCHEMA_VERSION)
  );
  console.log(`[DB] Migrated sessions schema to version ${CURRENT_SCHEMA_VERSION}`);
}

if (currentSchemaVersion < 11) {
  // Structured plan/checklist steps for the live Mission board (plans/plan.md file).
  try { db.exec("ALTER TABLE sessions ADD COLUMN plan_steps TEXT NOT NULL DEFAULT '[]'"); } catch (e) {}
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
    "schema_version",
    String(CURRENT_SCHEMA_VERSION)
  );
  console.log(`[DB] Migrated sessions schema to version ${CURRENT_SCHEMA_VERSION}`);
}

if (currentSchemaVersion < 12) {
  // Multiple named plans per session (Workstream F). `plans` holds the full
  // [{planId,title,type,steps}] array; `active_plan_id` picks the selected one.
  // plan_steps stays as the active plan's steps for back-compat.
  try { db.exec("ALTER TABLE sessions ADD COLUMN plans TEXT NOT NULL DEFAULT '[]'"); } catch (e) {}
  try { db.exec("ALTER TABLE sessions ADD COLUMN active_plan_id TEXT NOT NULL DEFAULT ''"); } catch (e) {}
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
    "schema_version",
    String(CURRENT_SCHEMA_VERSION)
  );
  console.log(`[DB] Migrated sessions schema to version ${CURRENT_SCHEMA_VERSION}`);
}

if (currentSchemaVersion < 13) {
  // Multi-tenancy + RBAC + SSO (Admin console). `tenant_id` is added to
  // sessions/devices as a nullable TAG for per-tenant observability — NOT
  // enforced row-level isolation (a deliberate follow-up). The access-control
  // tables themselves are created unconditionally just below.
  try { db.exec("ALTER TABLE sessions ADD COLUMN tenant_id TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE devices ADD COLUMN tenant_id TEXT"); } catch (e) {}
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
    "schema_version",
    String(CURRENT_SCHEMA_VERSION)
  );
  console.log(`[DB] Migrated sessions schema to version ${CURRENT_SCHEMA_VERSION}`);
}

// ── Access-control tables (Admin console: tenants / API keys / SSO) ───
// Created unconditionally (idempotent) so they exist regardless of the DB's
// migration state. Secrets follow the `devices` model: the raw key/token is
// returned exactly once and stored ONLY as a sha256 hash (see hashToken).
db.exec(`
  CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    sso_enabled INTEGER NOT NULL DEFAULT 0,
    sso_config TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    label TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    scope TEXT NOT NULL DEFAULT 'full',
    created_at INTEGER NOT NULL,
    last_used INTEGER,
    revoked_at INTEGER,
    created_by TEXT
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    email TEXT NOT NULL,
    sub TEXT,
    username TEXT,
    password_hash TEXT,
    role TEXT NOT NULL DEFAULT 'member',
    created_at INTEGER NOT NULL,
    last_login INTEGER
  )
`);
// Local accounts (username + password) live in the same table as SSO users;
// SSO users have username/password_hash NULL. Add the columns for DBs created
// before v14, then a partial-unique index so usernames don't collide.
if (currentSchemaVersion < 14) {
  try { db.exec("ALTER TABLE users ADD COLUMN username TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE users ADD COLUMN password_hash TEXT"); } catch (e) {}
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
    "schema_version",
    String(CURRENT_SCHEMA_VERSION)
  );
  console.log(`[DB] Migrated sessions schema to version ${CURRENT_SCHEMA_VERSION}`);
}
try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username) WHERE username IS NOT NULL"); } catch (e) {}
db.exec(`
  CREATE TABLE IF NOT EXISTS sso_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )
`);



// ── Backup ───────────────────────────────────────────────────────────
const MAX_BACKUPS = 20;
const BACKUP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function performBackup() {
  try {
    const allRows = db.prepare("SELECT * FROM sessions").all();
    const backupDir = path.join(__dirname, "backups");
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(backupDir, `sessions-backup-${timestamp}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(allRows, null, 2), "utf-8");
    console.log(`[DB Backup] Wrote ${allRows.length} sessions to ${backupPath}`);
    
    // Prune old backups after successful backup
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
    .filter(f => f.startsWith("sessions-backup-") && f.endsWith(".json"))
    .map(f => ({
      name: f,
      path: path.join(backupDir, f),
      mtime: fs.statSync(path.join(backupDir, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime); // newest first
  
  const now = Date.now();
  const agedOut = files.filter(f => now - f.mtime > BACKUP_MAX_AGE_MS);
  const overCount = files.slice(MAX_BACKUPS);
  
  const toDelete = new Set([...agedOut, ...overCount]);
  for (const file of toDelete) {
    try {
      fs.unlinkSync(file.path);
      console.log(`[DB Backup] Pruned old backup: ${file.name}`);
    } catch (e) {
      console.error(`[DB Backup] Failed to prune ${file.name}:`, e.message);
    }
  }
}

function getBackups() {
  const backupDir = path.join(__dirname, "backups");
  if (!fs.existsSync(backupDir)) return [];
  return fs.readdirSync(backupDir)
    .filter(f => f.startsWith("sessions-backup-") && f.endsWith(".json"))
    .sort()
    .reverse();
}

// ── Row mapping helper ──────────────────────────────────────────────
function mapRow(row) {
  return {
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
    timestamp: row.timestamp,
    schemaVersion: row.schema_version || 0,
  };
}

/** Mark a session as running (a turn is in flight). Used for interrupted-run detection. */
function setSessionRunning(id, info) {
  db.prepare("UPDATE sessions SET run_state = ? WHERE id = ?").run(
    JSON.stringify({ running: true, ...info, startedAt: Date.now() }), id
  );
}

/** Clear a session's running flag (turn finished cleanly). */
function clearSessionRunning(id) {
  try { db.prepare("UPDATE sessions SET run_state = '{}' WHERE id = ?").run(id); } catch {}
}

/** Sessions left in the running state (interrupted) — no live harness owns them after a restart. */
function listInterruptedSessions() {
  return db.prepare("SELECT * FROM sessions").all().map(mapRow).filter((s) => s.runState && s.runState.running);
}

// ── TTL: 30 days ───────────────────────────────────────────────────
function enforceTTL() {
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - THIRTY_DAYS_MS;
  const deleted = db.prepare("DELETE FROM sessions WHERE timestamp < ?").run(cutoff);
  if (deleted && deleted.changes > 0) {
    console.log(`[DB TTL] Deleted ${deleted.changes} expired session(s).`);
  }
}

// ── Public API ──────────────────────────────────────────────────────

function saveSession(session) {
  const stmt = db.prepare(`
    INSERT INTO sessions (id, title, messages, logs, execution_plan, metrics, mode, subagent_tree, plan_steps, plans, active_plan_id, tenant_id, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      messages = excluded.messages,
      logs = excluded.logs,
      execution_plan = excluded.execution_plan,
      metrics = excluded.metrics,
      mode = excluded.mode,
      subagent_tree = excluded.subagent_tree,
      plan_steps = excluded.plan_steps,
      plans = excluded.plans,
      active_plan_id = excluded.active_plan_id,
      tenant_id = excluded.tenant_id,
      timestamp = excluded.timestamp
  `);
  stmt.run(
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
    session.timestamp || Date.now()
  );

  // Auto-backup every BACKUP_INTERVAL saves
  saveCount++;
  if (saveCount % BACKUP_INTERVAL === 0) {
    performBackup();
  }
}

function getSession(id) {
  const stmt = db.prepare("SELECT * FROM sessions WHERE id = ?");
  const row = stmt.get(id);
  if (!row) return null;
  return mapRow(row);
}

function getAllSessions() {
  // Enforce TTL before returning results
  enforceTTL();

  const stmt = db.prepare("SELECT * FROM sessions ORDER BY timestamp DESC");
  const rows = stmt.all();
  return rows.map(mapRow);
}

function deleteSession(id) {
  try {
    const row = db.prepare("SELECT subagent_tree FROM sessions WHERE id = ?").get(id);
    if (row && row.subagent_tree) {
      let tree;
      try {
        tree = JSON.parse(row.subagent_tree);
      } catch {}
      if (tree && Array.isArray(tree.agents)) {
        for (const agent of tree.agents) {
          if (agent.childSessionId) {
            deleteSession(agent.childSessionId);
          }
        }
      }
    }
  } catch (e) {
    console.error(`[DB] Failed to cascade delete child sessions for ${id}:`, e.message);
  }
  
  // Clean up workspace directories
  try {
    const workspacePaths = require("./workspace-paths");
    workspacePaths.removeSessionDirs(id);
  } catch (e) {
    console.error(`[DB] Failed to remove workspace dirs for ${id}:`, e.message);
  }

  const stmt = db.prepare("DELETE FROM sessions WHERE id = ?");
  stmt.run(id);
}

function searchSessions(query) {
  if (!query || typeof query !== "string") return [];
  const searchTerm = `%${query}%`;
  const stmt = db.prepare(`
    SELECT * FROM sessions
    WHERE title LIKE ? OR messages LIKE ?
    ORDER BY timestamp DESC
  `);
  const rows = stmt.all(searchTerm, searchTerm);
  return rows.map(mapRow);
}

// ── Device Pairing (URL + OTP) ───────────────────────────────────────
// A pairing code is a short-lived, single-use OTP exchanged for a
// long-lived device token. Only the token's SHA-256 hash is ever stored —
// the raw token is returned once, at redemption time, and never again.

const PAIRING_CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I ambiguity
const VALID_SCOPES = new Set(["full", "chat_voice", "read_only"]);
const normalizeScope = (s) => (VALID_SCOPES.has(s) ? s : "full");

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Password hashing for local accounts: scrypt with a per-password random salt.
// Stored as "scrypt:<saltHex>:<hashHex>"; verified in constant time.
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
  for (let i = 0; i < length; i++) {
    code += PAIRING_CODE_ALPHABET[bytes[i] % PAIRING_CODE_ALPHABET.length];
  }
  return code;
}

/** Create a new pairing code for a device that's about to connect. */
function createPairingCode(label, scope) {
  const code = generatePairingCode();
  const now = Date.now();
  const expiresAt = now + PAIRING_CODE_TTL_MS;
  db.prepare(`
    INSERT INTO pairing_codes (code, label, created_at, expires_at, redeemed_at, scope)
    VALUES (?, ?, ?, ?, NULL, ?)
  `).run(code, label || "New device", now, expiresAt, normalizeScope(scope));
  return { code, expiresAt, scope: normalizeScope(scope) };
}

/**
 * Redeem a pairing code: validates it's unexpired and unused, marks it
 * redeemed, and creates a new device with a freshly generated token.
 * Returns { id, label, token } on success (raw token only ever returned
 * here), or null if the code is invalid/expired/already used.
 */
function redeemPairingCode(code, deviceLabel) {
  const now = Date.now();
  // Atomic single-use claim: the guarded UPDATE marks the code redeemed only
  // if it is still unredeemed and unexpired. Two harnesses racing the same
  // code means exactly one UPDATE reports changes === 1; the loser gets null
  // (→ code_expired), so a code can never be redeemed twice.
  const info = db
    .prepare(
      "UPDATE pairing_codes SET redeemed_at = ? WHERE code = ? AND redeemed_at IS NULL AND expires_at > ?"
    )
    .run(now, code, now);
  if (info.changes === 0) return null; // invalid, expired, or already used

  const row = db.prepare("SELECT * FROM pairing_codes WHERE code = ?").get(code);
  return createDevice(deviceLabel || (row && row.label), row && row.scope);
}

function createDevice(label, scope) {
  const id = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString("hex");
  const deviceScope = normalizeScope(scope);
  db.prepare(`
    INSERT INTO devices (id, label, token_hash, created_at, last_seen, revoked_at, policy_overrides, scope)
    VALUES (?, ?, ?, ?, NULL, NULL, '{}', ?)
  `).run(id, label || "New device", hashToken(token), Date.now(), deviceScope);
  return { id, label: label || "New device", token, scope: deviceScope };
}

/** Look up a device by its raw token (as presented over WS/HTTP). Returns null if unknown or revoked. */
function getDeviceByToken(token) {
  if (!token) return null;
  const row = db.prepare("SELECT * FROM devices WHERE token_hash = ?").get(hashToken(token));
  if (!row || row.revoked_at) return null;
  return mapDeviceRow(row);
}

function touchDeviceLastSeen(id) {
  db.prepare("UPDATE devices SET last_seen = ? WHERE id = ?").run(Date.now(), id);
}

function listDevices() {
  const rows = db.prepare("SELECT * FROM devices ORDER BY created_at DESC").all();
  return rows.map(mapDeviceRow);
}

function renameDevice(id, label) {
  db.prepare("UPDATE devices SET label = ? WHERE id = ?").run(label, id);
}

function revokeDevice(id) {
  db.prepare("UPDATE devices SET revoked_at = ? WHERE id = ?").run(Date.now(), id);
}

/** Set a device's per-capability policy overrides (a partial matrix; tighten-only, enforced in policy-engine). */
function setDevicePolicyOverrides(id, overrides) {
  const json = JSON.stringify(overrides && typeof overrides === "object" ? overrides : {});
  db.prepare("UPDATE devices SET policy_overrides = ? WHERE id = ?").run(json, id);
}

function mapDeviceRow(row) {
  return {
    id: row.id,
    label: row.label,
    createdAt: row.created_at,
    lastSeen: row.last_seen,
    revoked: Boolean(row.revoked_at),
    scope: row.scope || "full",
    tenantId: row.tenant_id || null,
    policyOverrides: JSON.parse(row.policy_overrides || "{}"),
  };
}

// ── Session profiles ────────────────────────────────────────────────

function mapProfileRow(row) {
  return {
    id: row.id,
    name: row.name,
    ...JSON.parse(row.config_json || "{}"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listProfiles() {
  return db.prepare("SELECT * FROM profiles ORDER BY created_at ASC").all().map(mapProfileRow);
}

function getProfile(id) {
  const row = db.prepare("SELECT * FROM profiles WHERE id = ?").get(id);
  return row ? mapProfileRow(row) : null;
}

/** Upsert a profile. `profile` = { id?, name, ...config }. Returns the stored profile. */
function saveProfile(profile) {
  const id = profile.id || crypto.randomUUID();
  const now = Date.now();
  const { id: _i, name, createdAt, updatedAt, ...config } = profile;
  const existing = db.prepare("SELECT created_at FROM profiles WHERE id = ?").get(id);
  db.prepare(`
    INSERT INTO profiles (id, name, config_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, config_json = excluded.config_json, updated_at = excluded.updated_at
  `).run(id, name || "Untitled profile", JSON.stringify(config), existing ? existing.created_at : now, now);
  return getProfile(id);
}

function deleteProfile(id) {
  db.prepare("DELETE FROM profiles WHERE id = ?").run(id);
}

function countProfiles() {
  return db.prepare("SELECT COUNT(*) AS n FROM profiles").get().n;
}

// ── Event channels ──────────────────────────────────────────────────

function mapChannelRow(row) {
  return {
    id: row.id,
    name: row.name,
    ...JSON.parse(row.config_json || "{}"),
    lastTriggered: row.last_triggered,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listChannels() {
  return db.prepare("SELECT * FROM channels ORDER BY created_at ASC").all().map(mapChannelRow);
}

function getChannel(id) {
  const row = db.prepare("SELECT * FROM channels WHERE id = ?").get(id);
  return row ? mapChannelRow(row) : null;
}

function saveChannel(channel) {
  const id = channel.id || crypto.randomUUID();
  const now = Date.now();
  const { id: _i, name, lastTriggered, createdAt, updatedAt, ...config } = channel;
  const existing = db.prepare("SELECT created_at FROM channels WHERE id = ?").get(id);
  db.prepare(`
    INSERT INTO channels (id, name, config_json, created_at, updated_at, last_triggered)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, config_json = excluded.config_json, updated_at = excluded.updated_at
  `).run(id, name || "Untitled channel", JSON.stringify(config), existing ? existing.created_at : now, now, null);
  return getChannel(id);
}

function touchChannelTriggered(id) {
  db.prepare("UPDATE channels SET last_triggered = ? WHERE id = ?").run(Date.now(), id);
}

function deleteChannel(id) {
  db.prepare("DELETE FROM channels WHERE id = ?").run(id);
}

// ── Service connections (OAuth / token) ─────────────────────────────
// Stores the *encrypted* token payloads; callers pass already-encrypted
// strings (server owns crypto-store) so db.js stays crypto-agnostic.

function mapConnectionRow(row) {
  return {
    provider: row.provider,
    kind: row.kind,
    scopes: row.scopes ? row.scopes.split(" ").filter(Boolean) : [],
    accessTokenEnc: row.access_token_enc,
    refreshTokenEnc: row.refresh_token_enc,
    expiresAt: row.expires_at,
    meta: JSON.parse(row.meta || "{}"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listConnections() {
  return db.prepare("SELECT * FROM connections ORDER BY created_at ASC").all().map(mapConnectionRow);
}

function getConnection(provider) {
  const row = db.prepare("SELECT * FROM connections WHERE provider = ?").get(provider);
  return row ? mapConnectionRow(row) : null;
}

/** Upsert a connection. Token fields must already be encrypted by the caller. */
function saveConnection(c) {
  const now = Date.now();
  const existing = db.prepare("SELECT created_at FROM connections WHERE provider = ?").get(c.provider);
  db.prepare(`
    INSERT INTO connections (provider, kind, scopes, access_token_enc, refresh_token_enc, expires_at, meta, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider) DO UPDATE SET
      kind = excluded.kind, scopes = excluded.scopes,
      access_token_enc = excluded.access_token_enc, refresh_token_enc = excluded.refresh_token_enc,
      expires_at = excluded.expires_at, meta = excluded.meta, updated_at = excluded.updated_at
  `).run(
    c.provider, c.kind, (c.scopes || []).join(" "),
    c.accessTokenEnc || "", c.refreshTokenEnc || "", c.expiresAt || null,
    JSON.stringify(c.meta || {}), existing ? existing.created_at : now, now
  );
  return getConnection(c.provider);
}

function deleteConnection(provider) {
  db.prepare("DELETE FROM connections WHERE provider = ?").run(provider);
}

// ── Access control: tenants / API keys / SSO users + sessions ────────
// RBAC that degrades gracefully: none of this is required for a single-user
// deploy (the env superadmin key or dev-mode covers that). It only comes alive
// once an operator creates tenants/keys or enables SSO. See middleware/auth.js.
const VALID_ROLES = new Set(["superadmin", "admin", "member", "viewer"]);
const normalizeRole = (r) => (VALID_ROLES.has(r) ? r : "member");
const API_KEY_PREFIX = "orb_live_";

// ── Tenants ──
function createTenant(name) {
  const id = crypto.randomUUID();
  db.prepare(
    "INSERT INTO tenants (id, name, status, sso_enabled, sso_config, created_at) VALUES (?, ?, 'active', 0, '{}', ?)"
  ).run(id, String(name || "Tenant").slice(0, 120), Date.now());
  return getTenant(id);
}
function listTenants() {
  return db.prepare("SELECT * FROM tenants ORDER BY created_at DESC").all().map(mapTenantRow);
}
function getTenant(id) {
  const row = db.prepare("SELECT * FROM tenants WHERE id = ?").get(id);
  return row ? mapTenantRow(row) : null;
}
function updateTenant(id, fields = {}) {
  const t = db.prepare("SELECT * FROM tenants WHERE id = ?").get(id);
  if (!t) return null;
  const name = fields.name !== undefined ? String(fields.name).slice(0, 120) : t.name;
  const status = fields.status !== undefined ? String(fields.status) : t.status;
  const ssoEnabled = fields.ssoEnabled !== undefined ? (fields.ssoEnabled ? 1 : 0) : t.sso_enabled;
  const ssoConfig = fields.ssoConfig !== undefined ? JSON.stringify(fields.ssoConfig || {}) : t.sso_config;
  db.prepare("UPDATE tenants SET name = ?, status = ?, sso_enabled = ?, sso_config = ? WHERE id = ?")
    .run(name, status, ssoEnabled, ssoConfig, id);
  return getTenant(id);
}
function deleteTenant(id) {
  db.prepare("DELETE FROM tenants WHERE id = ?").run(id);
  // Stop the tenant's credentials from authenticating once it's gone.
  db.prepare("UPDATE api_keys SET revoked_at = ? WHERE tenant_id = ? AND revoked_at IS NULL").run(Date.now(), id);
  db.prepare("DELETE FROM users WHERE tenant_id = ?").run(id);
}
function mapTenantRow(row) {
  return {
    id: row.id,
    name: row.name,
    status: row.status || "active",
    ssoEnabled: !!row.sso_enabled,
    ssoConfig: JSON.parse(row.sso_config || "{}"),
    createdAt: row.created_at,
  };
}

// ── API keys ── (raw key returned once; only the hash is stored)
function createApiKey({ tenantId = null, label, role, scope, createdBy = null } = {}) {
  const id = crypto.randomUUID();
  const key = API_KEY_PREFIX + crypto.randomBytes(24).toString("hex");
  const prefix = key.slice(0, API_KEY_PREFIX.length + 6) + "…";
  const safeLabel = String(label || "API key").slice(0, 100);
  const r = normalizeRole(role);
  const s = normalizeScope(scope);
  db.prepare(`
    INSERT INTO api_keys (id, tenant_id, label, key_hash, key_prefix, role, scope, created_at, last_used, revoked_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
  `).run(id, tenantId, safeLabel, hashToken(key), prefix, r, s, Date.now(), createdBy);
  // `key` (raw) is only ever present in this return value.
  return { id, tenantId, label: safeLabel, role: r, scope: s, keyPrefix: prefix, key };
}
function getApiKeyByToken(token) {
  if (!token) return null;
  const row = db.prepare("SELECT * FROM api_keys WHERE key_hash = ?").get(hashToken(token));
  if (!row || row.revoked_at) return null;
  return mapApiKeyRow(row);
}
function getApiKey(id) {
  const row = db.prepare("SELECT * FROM api_keys WHERE id = ?").get(id);
  return row ? mapApiKeyRow(row) : null;
}
function touchApiKeyUsed(id) {
  try { db.prepare("UPDATE api_keys SET last_used = ? WHERE id = ?").run(Date.now(), id); } catch {}
}
function listApiKeys(tenantId) {
  const rows = tenantId
    ? db.prepare("SELECT * FROM api_keys WHERE tenant_id = ? ORDER BY created_at DESC").all(tenantId)
    : db.prepare("SELECT * FROM api_keys ORDER BY created_at DESC").all();
  return rows.map(mapApiKeyRow);
}
function revokeApiKey(id) {
  db.prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ?").run(Date.now(), id);
}
function mapApiKeyRow(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id || null,
    label: row.label,
    keyPrefix: row.key_prefix,
    role: row.role || "member",
    scope: row.scope || "full",
    createdAt: row.created_at,
    lastUsed: row.last_used,
    revoked: !!row.revoked_at,
    createdBy: row.created_by || null,
  };
}

// ── SSO users ── (provisioned on first OIDC login)
function upsertUser({ email, sub, tenantId = null, role } = {}) {
  const normEmail = String(email || "").toLowerCase();
  const existing = db.prepare("SELECT * FROM users WHERE email = ?").get(normEmail);
  if (existing) {
    const nextRole = role !== undefined ? normalizeRole(role) : existing.role;
    db.prepare("UPDATE users SET sub = ?, tenant_id = ?, role = ?, last_login = ? WHERE id = ?")
      .run(sub || existing.sub, tenantId ?? existing.tenant_id, nextRole, Date.now(), existing.id);
    return getUser(existing.id);
  }
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO users (id, tenant_id, email, sub, role, created_at, last_login) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, tenantId, normEmail, sub || null, normalizeRole(role), Date.now(), Date.now());
  return getUser(id);
}
function getUser(id) {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  return row ? mapUserRow(row) : null;
}
function listUsers(tenantId) {
  const rows = tenantId
    ? db.prepare("SELECT * FROM users WHERE tenant_id = ? ORDER BY created_at DESC").all(tenantId)
    : db.prepare("SELECT * FROM users ORDER BY created_at DESC").all();
  return rows.map(mapUserRow);
}
function setUserRole(id, role) {
  db.prepare("UPDATE users SET role = ? WHERE id = ?").run(normalizeRole(role), id);
}
function countUsers() {
  return db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
}
function mapUserRow(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id || null,
    email: row.email,
    sub: row.sub || null,
    username: row.username || null,
    hasPassword: !!row.password_hash,
    role: row.role || "member",
    createdAt: row.created_at,
    lastLogin: row.last_login,
  };
}

// ── Local accounts (username + password) ──
function getUserByUsername(username) {
  if (!username) return null;
  const row = db.prepare("SELECT * FROM users WHERE username = ?").get(String(username));
  return row ? mapUserRow(row) : null;
}

/** Create a local (password) account. Returns the mapped user (no hash). */
function createLocalUser({ username, password, role, tenantId = null } = {}) {
  const id = crypto.randomUUID();
  const uname = String(username);
  db.prepare(`
    INSERT INTO users (id, tenant_id, email, sub, username, password_hash, role, created_at, last_login)
    VALUES (?, ?, ?, NULL, ?, ?, ?, ?, NULL)
  `).run(id, tenantId, `${uname}@local`, uname, hashPassword(password), normalizeRole(role), Date.now());
  return getUser(id);
}

function setUserPassword(id, password) {
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(password), id);
}

/** Verify a username+password; on success bumps last_login and returns the user. */
function verifyLocalLogin(username, password) {
  const row = db.prepare("SELECT * FROM users WHERE username = ?").get(String(username || ""));
  if (!row || !row.password_hash) return null;
  if (!verifyPassword(password, row.password_hash)) return null;
  db.prepare("UPDATE users SET last_login = ? WHERE id = ?").run(Date.now(), row.id);
  return mapUserRow(row);
}

/**
 * Idempotently ensure the local superadmin account exists (called at boot).
 * Creates it (password required) if absent; otherwise keeps role=superadmin and
 * refreshes the password only when one is explicitly provided (env-managed).
 */
function ensureSuperadminAccount({ username, password } = {}) {
  const uname = String(username || "admin");
  const existing = db.prepare("SELECT * FROM users WHERE username = ?").get(uname);
  if (existing) {
    if (existing.role !== "superadmin") db.prepare("UPDATE users SET role='superadmin' WHERE id=?").run(existing.id);
    if (password) db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(hashPassword(password), existing.id);
    return { id: existing.id, username: uname, created: false, passwordUpdated: !!password };
  }
  if (!password) throw new Error("ensureSuperadminAccount: a password is required to create the account");
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO users (id, tenant_id, email, sub, username, password_hash, role, created_at, last_login)
    VALUES (?, NULL, ?, NULL, ?, ?, 'superadmin', ?, NULL)
  `).run(id, `${uname}@local`, uname, hashPassword(password), Date.now());
  return { id, username: uname, created: true };
}

// ── SSO browser sessions ── (issued after OIDC callback; presented as x-api-key)
const SSO_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h
function createSsoSession(userId, ttlMs = SSO_SESSION_TTL_MS) {
  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  db.prepare("INSERT INTO sso_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .run(hashToken(token), userId, now, now + ttlMs);
  return { token, expiresAt: now + ttlMs };
}
function getSsoSessionByToken(token) {
  if (!token) return null;
  const row = db.prepare("SELECT * FROM sso_sessions WHERE token_hash = ?").get(hashToken(token));
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    try { db.prepare("DELETE FROM sso_sessions WHERE token_hash = ?").run(row.token_hash); } catch {}
    return null;
  }
  const user = getUser(row.user_id);
  if (!user) return null;
  return { user, expiresAt: row.expires_at };
}
function revokeSsoSession(token) {
  if (!token) return;
  try { db.prepare("DELETE FROM sso_sessions WHERE token_hash = ?").run(hashToken(token)); } catch {}
}

module.exports = {
  saveSession,
  getSession,
  getAllSessions,
  deleteSession,
  searchSessions,
  performBackup,
  getBackups,
  createPairingCode,
  redeemPairingCode,
  createDevice,
  getDeviceByToken,
  touchDeviceLastSeen,
  listDevices,
  renameDevice,
  revokeDevice,
  setDevicePolicyOverrides,
  listProfiles,
  getProfile,
  saveProfile,
  deleteProfile,
  countProfiles,
  listChannels,
  getChannel,
  saveChannel,
  touchChannelTriggered,
  deleteChannel,
  setSessionRunning,
  clearSessionRunning,
  listInterruptedSessions,
  listConnections,
  getConnection,
  saveConnection,
  deleteConnection,
  // Access control (tenants / API keys / SSO)
  createTenant,
  listTenants,
  getTenant,
  updateTenant,
  deleteTenant,
  createApiKey,
  getApiKey,
  getApiKeyByToken,
  touchApiKeyUsed,
  listApiKeys,
  revokeApiKey,
  upsertUser,
  getUser,
  listUsers,
  setUserRole,
  countUsers,
  getUserByUsername,
  createLocalUser,
  setUserPassword,
  verifyLocalLogin,
  ensureSuperadminAccount,
  createSsoSession,
  getSsoSessionByToken,
  revokeSsoSession,
};
