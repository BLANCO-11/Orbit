// agent-backend/routes/connectors.js
// MCP connector registry API — now tenant-scoped (Gap 3). A connector the caller
// registers is isolated to the tenant of its API key: only that tenant's
// sessions get it composed into their per-session .pi/mcp.json at spawn.
//
// Orbit's OWN servers (fleet/notify/search/transcript/lightpanda) and any
// OAuth-wired provider connectors live in the global .pi/mcp.json and are SHARED
// across tenants — surfaced here read-only (shared:true), managed elsewhere.
//
// GET    /api/connectors        — shared (read-only) + this tenant's connectors
// POST   /api/connectors        — add/replace a tenant connector { name, command?, args?, env?, url? }
// DELETE /api/connectors/:name  — remove one of this tenant's connectors
//
// `env` values may contain ${secret:NAME} references; they are stored verbatim
// (never resolved here) and resolved server-side at spawn into the sandbox.

const { Router } = require("express");
const { requireRole } = require("../middleware/auth");

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

function createConnectorsRouter({ db, registry }) {
  const router = Router();

  const tenantOf = (req) => (req.auth && req.auth.tenantId) || null;

  router.get("/", async (req, res) => {
    // Shared Orbit/OAuth servers from the global registry (read-only here).
    const shared = (registry.list() || []).map((c) => ({ ...c, shared: true, scope: "shared" }));
    // This tenant's own connectors (DB-backed). Status/tools aren't probed here;
    // they come alive in the session sandbox.
    const own = (await db.listConnectorsForTenant(tenantOf(req))).map((c) => ({
      name: c.name,
      transport: c.def.url ? "remote" : "stdio",
      target: c.def.url || `${c.def.command || ""} ${(c.def.args || []).join(" ")}`.trim(),
      status: "registered",
      tools: [],
      error: null,
      shared: false,
      scope: "tenant",
    }));
    res.json({ success: true, connectors: [...shared, ...own] });
  });

  router.post("/", requireRole("admin", "member"), async (req, res) => {
    const { name, command, args, env, url } = req.body || {};
    if (!NAME_RE.test(String(name || ""))) {
      return res.status(400).json({ success: false, error: "connector name must be [a-z0-9_-], max 64 chars" });
    }
    if (!command && !url) {
      return res.status(400).json({ success: false, error: "connector needs a command (stdio) or url (remote)" });
    }
    const def = url
      ? { url: String(url), transport: "http", lifecycle: "eager" }
      : { command: String(command), args: Array.isArray(args) ? args : [], env: env && typeof env === "object" ? env : {}, transport: "stdio", lifecycle: "eager" };
    try {
      await db.upsertConnector({ tenantId: tenantOf(req), name, def });
    } catch (e) {
      return res.status(400).json({ success: false, error: e.message });
    }
    const own = await db.listConnectorsForTenant(tenantOf(req));
    res.json({ success: true, connectors: own.map((c) => ({ name: c.name, def: c.def })) });
  });

  router.delete("/:name", requireRole("admin", "member"), async (req, res) => {
    const removed = await db.deleteConnector(tenantOf(req), req.params.name);
    if (!removed) return res.status(404).json({ success: false, error: "no such connector" });
    res.json({ success: true });
  });

  return router;
}

module.exports = createConnectorsRouter;
