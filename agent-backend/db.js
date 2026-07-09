const { DatabaseSync } = require("node:sqlite");
const path = require("path");

const dbPath = path.join(__dirname, "aegis.db");
const db = new DatabaseSync(dbPath);

// Initialize tables
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
}

function getSession(id) {
  const stmt = db.prepare("SELECT * FROM sessions WHERE id = ?");
  const row = stmt.get(id);
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    messages: JSON.parse(row.messages),
    logs: JSON.parse(row.logs),
    executionPlan: row.execution_plan,
    metrics: JSON.parse(row.metrics),
    timestamp: row.timestamp
  };
}

function getAllSessions() {
  const stmt = db.prepare("SELECT * FROM sessions ORDER BY timestamp DESC");
  const rows = stmt.all();
  return rows.map(row => ({
    id: row.id,
    title: row.title,
    messages: JSON.parse(row.messages),
    logs: JSON.parse(row.logs),
    executionPlan: row.execution_plan,
    metrics: JSON.parse(row.metrics),
    timestamp: row.timestamp
  }));
}

function deleteSession(id) {
  const stmt = db.prepare("DELETE FROM sessions WHERE id = ?");
  stmt.run(id);
}

module.exports = {
  saveSession,
  getSession,
  getAllSessions,
  deleteSession
};
