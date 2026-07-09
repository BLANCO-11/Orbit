const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const fs = require("fs");

const dbPath = path.join(__dirname, "aegis.db");
const db = new DatabaseSync(dbPath);

// ── Schema Versioning ───────────────────────────────────────────────
const CURRENT_SCHEMA_VERSION = 2;
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
  // Add schema_version column to sessions table (default 0 for existing rows)
  try {
    db.exec("ALTER TABLE sessions ADD COLUMN schema_version INTEGER DEFAULT 0");
  } catch (e) {
    // Column may already exist from a partial migration; ignore
  }
  // Persist the new schema version
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
    timestamp INTEGER NOT NULL
  )
`);

// ── Backup ───────────────────────────────────────────────────────────
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
    return backupPath;
  } catch (err) {
    console.error("[DB Backup] Failed:", err.message);
    return null;
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
    timestamp: row.timestamp,
    schemaVersion: row.schema_version || 0,
  };
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
    INSERT INTO sessions (id, title, messages, logs, execution_plan, metrics, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      messages = excluded.messages,
      logs = excluded.logs,
      execution_plan = excluded.execution_plan,
      metrics = excluded.metrics,
      timestamp = excluded.timestamp
  `);
  stmt.run(
    session.id,
    session.title || "New Session",
    JSON.stringify(session.messages || []),
    JSON.stringify(session.logs || []),
    session.executionPlan || "",
    JSON.stringify(session.metrics || {}),
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

module.exports = {
  saveSession,
  getSession,
  getAllSessions,
  deleteSession,
  searchSessions,
  performBackup,
  getBackups,
};
