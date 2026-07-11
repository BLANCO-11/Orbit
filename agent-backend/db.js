const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const dbPath = path.join(__dirname, "aegis.db");
const db = new DatabaseSync(dbPath);

// ── Schema Versioning ───────────────────────────────────────────────
const CURRENT_SCHEMA_VERSION = 9;
const BACKUP_INTERVAL = 10; // auto-backup every N saves
let saveCount = 0;

// Meta table for key-value configuration (schema version, etc.)
db.exec(`
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);

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
    runState: JSON.parse(row.run_state || "{}"),
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
    INSERT INTO sessions (id, title, messages, logs, execution_plan, metrics, mode, subagent_tree, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      messages = excluded.messages,
      logs = excluded.logs,
      execution_plan = excluded.execution_plan,
      metrics = excluded.metrics,
      mode = excluded.mode,
      subagent_tree = excluded.subagent_tree,
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
  const row = db.prepare("SELECT * FROM pairing_codes WHERE code = ?").get(code);
  if (!row) return null;
  if (row.redeemed_at) return null;
  if (Date.now() > row.expires_at) return null;

  db.prepare("UPDATE pairing_codes SET redeemed_at = ? WHERE code = ?").run(Date.now(), code);
  return createDevice(deviceLabel || row.label, row.scope);
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
};
