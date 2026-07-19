// DB adapter tests. The SQLite path runs for real (temp file); the Postgres
// path's SQL translation + driver resolution are unit-tested here (a live pg
// round-trip needs a server — see test_db_layer.js run with DATABASE_URL set).

const assert = require("assert");
const os = require("os");
const path = require("path");
const fs = require("fs");

const { resolveDriver, toPgPlaceholders } = require("../agent-backend/db/adapter");

function testPlaceholderTranslation() {
  console.log("toPgPlaceholders...");
  assert.strictEqual(toPgPlaceholders("SELECT * FROM t WHERE a = ? AND b = ?"),
    "SELECT * FROM t WHERE a = $1 AND b = $2");
  assert.strictEqual(toPgPlaceholders("INSERT INTO t (a,b,c) VALUES (?,?,?)"),
    "INSERT INTO t (a,b,c) VALUES ($1,$2,$3)");
  // A `?` inside a quoted literal must not be renumbered.
  assert.strictEqual(toPgPlaceholders("SELECT '?' , ? FROM t"),
    "SELECT '?' , $1 FROM t");
  console.log("  ok");
}

function testResolveDriver() {
  console.log("resolveDriver env logic...");
  const save = { d: process.env.ORBIT_DB_DRIVER, u: process.env.DATABASE_URL };
  try {
    delete process.env.ORBIT_DB_DRIVER; delete process.env.DATABASE_URL;
    assert.strictEqual(resolveDriver(), "sqlite", "no env → sqlite");
    process.env.DATABASE_URL = "postgres://x";
    assert.strictEqual(resolveDriver(), "postgres", "DATABASE_URL → postgres");
    process.env.ORBIT_DB_DRIVER = "sqlite";
    assert.strictEqual(resolveDriver(), "sqlite", "explicit sqlite wins over DATABASE_URL");
    process.env.ORBIT_DB_DRIVER = "pg";
    assert.strictEqual(resolveDriver(), "postgres", "'pg' alias → postgres");
    process.env.ORBIT_DB_DRIVER = "bogus";
    assert.throws(() => resolveDriver(), /unknown driver/, "bad driver throws");
  } finally {
    if (save.d === undefined) delete process.env.ORBIT_DB_DRIVER; else process.env.ORBIT_DB_DRIVER = save.d;
    if (save.u === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = save.u;
  }
  console.log("  ok");
}

async function testSqliteAdapterLive() {
  console.log("sqlite adapter (live, temp file)...");
  const tmp = path.join(os.tmpdir(), `orbit-adapter-test-${process.pid}.db`);
  for (const s of ["", "-wal", "-shm"]) { try { fs.unlinkSync(tmp + s); } catch {} }
  const prevDriver = process.env.ORBIT_DB_DRIVER, prevPath = process.env.ORBIT_DB_PATH;
  process.env.ORBIT_DB_DRIVER = "sqlite";
  process.env.ORBIT_DB_PATH = tmp;
  // Require fresh (module has no cached singleton — createAdapter builds anew).
  const { createAdapter } = require("../agent-backend/db/adapter");
  const q = createAdapter();
  try {
    assert.strictEqual(q.dialect, "sqlite");
    await q.exec("CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER)");
    let r = await q.run("INSERT INTO t (id, n) VALUES (?, ?)", ["a", 1]);
    assert.strictEqual(r.changes, 1, "insert reports 1 change");
    r = await q.run("INSERT INTO t (id, n) VALUES (?, ?)", ["b", 2]);
    const row = await q.get("SELECT * FROM t WHERE id = ?", ["a"]);
    assert.strictEqual(row.n, 1, "get returns the row");
    const missing = await q.get("SELECT * FROM t WHERE id = ?", ["zzz"]);
    assert.strictEqual(missing, null, "get returns null (not undefined) when absent");
    const all = await q.all("SELECT * FROM t ORDER BY id");
    assert.strictEqual(all.length, 2, "all returns both rows");

    // Transaction COMMIT.
    await q.tx(async (t) => { await t.run("INSERT INTO t (id, n) VALUES (?, ?)", ["c", 3]); });
    assert.ok(await q.get("SELECT * FROM t WHERE id = ?", ["c"]), "committed row present");

    // Transaction ROLLBACK on throw.
    await assert.rejects(q.tx(async (t) => {
      await t.run("INSERT INTO t (id, n) VALUES (?, ?)", ["d", 4]);
      throw new Error("boom");
    }), /boom/, "tx rethrows");
    assert.strictEqual(await q.get("SELECT * FROM t WHERE id = ?", ["d"]), null, "rolled-back row absent");

    await q.close();
  } finally {
    for (const s of ["", "-wal", "-shm"]) { try { fs.unlinkSync(tmp + s); } catch {} }
    if (prevDriver === undefined) delete process.env.ORBIT_DB_DRIVER; else process.env.ORBIT_DB_DRIVER = prevDriver;
    if (prevPath === undefined) delete process.env.ORBIT_DB_PATH; else process.env.ORBIT_DB_PATH = prevPath;
  }
  console.log("  ok");
}

(async () => {
  try {
    testPlaceholderTranslation();
    testResolveDriver();
    await testSqliteAdapterLive();
    console.log("\nAll DB adapter tests passed!");
  } catch (e) {
    console.error("\nTest failed:", e && e.stack ? e.stack : e);
    process.exit(1);
  }
})();
