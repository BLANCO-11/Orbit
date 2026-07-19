// agent-backend/db/adapter.js
// Async query-adapter with two interchangeable backends, selected at boot by env:
//   • sqlite  — Node's built-in node:sqlite (DatabaseSync), wrapped so its
//               synchronous calls satisfy the same async contract. Default; zero
//               extra deps; the local/dev + single-box story.
//   • postgres — the `pg` Pool. The Docker/networked/multi-writer default.
//
// db.js (and everything above it) talks ONLY to this contract, so the rest of
// the app is dialect-agnostic:
//     await q.run(sql, params)   -> { changes, rows, lastInsertRowid }
//     await q.get(sql, params)   -> first row (object) or null
//     await q.all(sql, params)   -> rows[] (array of objects)
//     await q.exec(sql)          -> DDL / multi-statement, no params
//     await q.tx(async (t) => …) -> transaction; `t` has run/get/all
//     q.dialect                  -> "sqlite" | "postgres"
//
// SQL is written with `?` placeholders (SQLite style); the pg adapter rewrites
// them to $1..$n. Genuinely dialect-specific SQL (PRAGMA vs information_schema,
// LIKE vs ILIKE, INSERT OR REPLACE) is branched in db.js on `q.dialect`.

// ── env → driver resolution ──────────────────────────────────────────
// Explicit ORBIT_DB_DRIVER wins; else a DATABASE_URL implies postgres; else
// sqlite. Keeps existing SQLite deploys unchanged (no env → sqlite).
function resolveDriver() {
  const explicit = String(process.env.ORBIT_DB_DRIVER || "").toLowerCase().trim();
  if (explicit === "postgres" || explicit === "postgresql" || explicit === "pg") return "postgres";
  if (explicit === "sqlite") return "sqlite";
  if (explicit) throw new Error(`ORBIT_DB_DRIVER: unknown driver "${explicit}" (use "sqlite" or "postgres")`);
  if (process.env.DATABASE_URL) return "postgres";
  return "sqlite";
}

// Rewrite `?` placeholders to Postgres $1..$n. Quoted string/identifier literals
// are skipped so a literal `?` inside a string isn't renumbered. db.js does not
// embed `?` inside string literals today, but this keeps the translation honest.
function toPgPlaceholders(sql) {
  let i = 0, out = "", quote = null;
  for (let c = 0; c < sql.length; c++) {
    const ch = sql[c];
    if (quote) {
      out += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; out += ch; continue; }
    if (ch === "?") { out += "$" + (++i); continue; }
    out += ch;
  }
  return out;
}

// ── SQLite adapter (node:sqlite, synchronous under an async facade) ───
function createSqliteAdapter() {
  const { DatabaseSync } = require("node:sqlite");
  const path = require("path");
  const fs = require("fs");

  const dbPath = process.env.ORBIT_DB_PATH || path.join(__dirname, "..", "orbit.db");
  try { fs.mkdirSync(path.dirname(dbPath), { recursive: true }); } catch {}
  // Rebrand migration: carry the pre-rebrand database over so no data is lost.
  const legacyDbPath = path.join(__dirname, "..", "aegis.db");
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
  try { db.exec("PRAGMA journal_mode = WAL"); } catch {}
  try { db.exec("PRAGMA foreign_keys = ON"); } catch {}

  const norm = (row) => (row === undefined ? null : row);

  const base = {
    dialect: "sqlite",
    async run(sql, params = []) {
      const info = db.prepare(sql).run(...params);
      return { changes: Number(info.changes || 0), rows: [], lastInsertRowid: info.lastInsertRowid };
    },
    async get(sql, params = []) {
      return norm(db.prepare(sql).get(...params));
    },
    async all(sql, params = []) {
      return db.prepare(sql).all(...params);
    },
    async exec(sql) {
      db.exec(sql);
    },
    async tx(fn) {
      // node:sqlite is synchronous + single-writer, so a plain BEGIN/COMMIT gives
      // the read-modify-write atomicity callers rely on. `fn` receives this same
      // adapter (all ops run on the one connection).
      db.exec("BEGIN");
      try {
        const result = await fn(base);
        db.exec("COMMIT");
        return result;
      } catch (e) {
        try { db.exec("ROLLBACK"); } catch {}
        throw e;
      }
    },
    async close() { try { db.close(); } catch {} },
  };
  return base;
}

// ── Postgres adapter (pg Pool) ───────────────────────────────────────
function createPgAdapter() {
  const pg = require("pg");
  const { Pool } = pg;
  // BIGINT (int8, OID 20) defaults to a STRING in node-postgres to avoid
  // precision loss. Every epoch-ms column is BIGINT here (INTEGER=int4 is too
  // small for Date.now()), and the app does numeric comparisons/arithmetic on
  // them — so parse int8 as a JS number. Safe: our values (~1.7e12) are far
  // below Number.MAX_SAFE_INTEGER (9e15). Matches node:sqlite, which returns
  // integers as numbers, so db.js stays dialect-agnostic on types.
  pg.types.setTypeParser(20, (v) => (v == null ? null : Number(v)));
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.ORBIT_PG_POOL_MAX || 10),
  });
  pool.on("error", (err) => console.error("[DB] pg pool error:", err.message));

  // Wrap a pg client/pool into the run/get/all contract.
  const wrap = (exec) => ({
    dialect: "postgres",
    async run(sql, params = []) {
      const r = await exec(toPgPlaceholders(sql), params);
      return { changes: r.rowCount || 0, rows: r.rows || [], lastInsertRowid: undefined };
    },
    async get(sql, params = []) {
      const r = await exec(toPgPlaceholders(sql), params);
      return (r.rows && r.rows.length) ? r.rows[0] : null;
    },
    async all(sql, params = []) {
      const r = await exec(toPgPlaceholders(sql), params);
      return r.rows || [];
    },
    async exec(sql) {
      await exec(sql); // DDL: no placeholder translation needed
    },
  });

  const poolQ = wrap((text, params) => pool.query(text, params));

  return {
    ...poolQ,
    async tx(fn) {
      const client = await pool.connect();
      const txQ = wrap((text, params) => client.query(text, params));
      try {
        await client.query("BEGIN");
        const result = await fn(txQ);
        await client.query("COMMIT");
        return result;
      } catch (e) {
        try { await client.query("ROLLBACK"); } catch {}
        throw e;
      } finally {
        client.release();
      }
    },
    async close() { try { await pool.end(); } catch {} },
  };
}

// ── Factory ──────────────────────────────────────────────────────────
function createAdapter() {
  const driver = resolveDriver();
  const adapter = driver === "postgres" ? createPgAdapter() : createSqliteAdapter();
  console.log(`[DB] Using ${driver} adapter.`);
  return adapter;
}

module.exports = { createAdapter, resolveDriver, toPgPlaceholders };
