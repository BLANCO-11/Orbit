#!/usr/bin/env node
// One-time SQLite → PostgreSQL data migration.
//
// Usage:
//   DATABASE_URL=postgres://orbit:orbit@localhost:5432/orbit \
//   ORBIT_SQLITE_PATH=agent-backend/orbit.db \
//   node agent-backend/scripts/migrate-sqlite-to-pg.js
//
// - Idempotent & resumable: every insert is ON CONFLICT DO NOTHING, so re-running
//   only fills gaps and never duplicates or clobbers.
// - Schema-safe: it first runs the app's own async init against Postgres (via
//   ../db, which selects the pg driver because DATABASE_URL is set), so the target
//   has the exact current schema before any rows are copied.
// - Data is stored as JSON-in-TEXT, so rows copy verbatim — no transformation.
//
// Point DATABASE_URL at the TARGET Postgres and ORBIT_SQLITE_PATH at the SOURCE
// file. The source is opened read-only and never modified.

const path = require("path");
const fs = require("fs");

// Tables to copy, in FK-friendly order (all PKs are provided/UUID; no FKs are
// enforced, but keep a sensible order anyway). meta first so schema_version rides
// along (though init() already set it on the target).
const TABLES = [
  "meta",
  "sessions",
  "devices",
  "device_llm_tokens",
  "pairing_codes",
  "profiles",
  "channels",
  "connections",
  "tenants",
  "api_keys",
  "users",
  "sso_sessions",
];

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("ERROR: DATABASE_URL (the target Postgres) must be set.");
    process.exit(1);
  }
  const sqlitePath = process.env.ORBIT_SQLITE_PATH || process.env.ORBIT_DB_PATH
    || path.join(__dirname, "..", "orbit.db");
  if (!fs.existsSync(sqlitePath)) {
    console.error(`ERROR: source SQLite DB not found at ${sqlitePath} (set ORBIT_SQLITE_PATH).`);
    process.exit(1);
  }

  console.log(`[migrate] source (sqlite): ${sqlitePath}`);
  console.log(`[migrate] target (pg):     ${dbUrl.replace(/:\/\/[^@]*@/, "://***@")}`);

  // 1. Create the schema on the target by running the app's init against pg.
  //    Requiring ../db with DATABASE_URL set builds the pg adapter.
  if (!process.env.ORBIT_DB_DRIVER) process.env.ORBIT_DB_DRIVER = "postgres";
  const db = require("../db");
  await db.init();
  console.log("[migrate] target schema ready (db.init on postgres).");

  // 2. Open the SQLite source read-only.
  const { DatabaseSync } = require("node:sqlite");
  const src = new DatabaseSync(sqlitePath, { readOnly: true });

  // 3. A dedicated pg pool for bulk inserts (separate from db.js's pool).
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: dbUrl });

  const sqliteTables = new Set(
    src.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)
  );

  let grandTotal = 0;
  try {
    for (const table of TABLES) {
      if (!sqliteTables.has(table)) { console.log(`[migrate] ${table}: (absent in source, skipped)`); continue; }
      const rows = src.prepare(`SELECT * FROM ${table}`).all();
      if (!rows.length) { console.log(`[migrate] ${table}: 0 rows`); continue; }

      const cols = Object.keys(rows[0]);
      const colList = cols.map((c) => `"${c}"`).join(", ");
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
      const sql = `INSERT INTO ${table} (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;

      const client = await pool.connect();
      let inserted = 0;
      try {
        await client.query("BEGIN");
        for (const row of rows) {
          const values = cols.map((c) => row[c]);
          const r = await client.query(sql, values);
          inserted += r.rowCount || 0;
        }
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw new Error(`table "${table}": ${e.message}`);
      } finally {
        client.release();
      }
      grandTotal += inserted;
      console.log(`[migrate] ${table}: ${rows.length} read → ${inserted} inserted (${rows.length - inserted} already present)`);
    }
  } finally {
    src.close();
    await pool.end();
  }

  console.log(`[migrate] Done. ${grandTotal} row(s) inserted into Postgres.`);
  process.exit(0);
}

main().catch((e) => {
  console.error("[migrate] FAILED:", e && e.stack ? e.stack : e);
  process.exit(1);
});
