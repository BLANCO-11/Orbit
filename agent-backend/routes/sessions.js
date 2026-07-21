// agent-backend/routes/sessions.js
// Session CRUD, search, export, import, backups

const { Router } = require("express");
const db = require("../db");

function createSessionsRouter() {
  const router = Router();

  // ── Isolation (tenant + per-user) ──
  // Sessions belong to the TENANT of the credential that created them, and to
  // the USER within that tenant (SSO userId) when there is one. Visibility:
  //   • superadmin           → all sessions
  //   • tenant admin         → all of its tenant's sessions
  //   • API key / device     → its tenant's sessions (no per-user identity)
  //   • member/viewer (SSO)  → only its OWN sessions
  // Guards return 404 (not 403) so cross-tenant/other-user ids look unknown.
  const isSuper = (req) => req.auth && req.auth.role === "superadmin";
  const isAdmin = (req) => req.auth && req.auth.role === "admin";
  const tenantOf = (req) => (req.auth && req.auth.tenantId) || null;
  const ownerOf = (req) => (req.auth && req.auth.userId) || null; // only SSO users carry a user id
  // The scope to hand db.getSessionsScoped: tenant always; ownerId only when the
  // caller is a per-user identity that isn't a tenant-wide admin.
  const scopeOf = (req) => {
    if (isSuper(req)) return null; // sentinel: unscoped
    const scope = { tenantId: tenantOf(req) };
    if (!isAdmin(req) && ownerOf(req)) scope.ownerId = ownerOf(req);
    return scope;
  };
  const canSee = (req, s) => {
    if (!s) return false;
    if (isSuper(req)) return true;
    if ((s.tenantId || null) !== tenantOf(req)) return false;
    if (isAdmin(req)) return true;
    const owner = ownerOf(req);
    if (!owner) return true; // API key/device: tenant-scoped, no per-user split
    return (s.userId || null) === owner;
  };

  // List sessions (scoped)
  router.get("/", async (req, res, next) => {
    try {
      const scope = scopeOf(req);
      const list = scope ? await db.getSessionsScoped(scope) : await db.getAllSessions();
      res.json({ success: true, sessions: list });
    } catch (err) { next(err); }
  });

  // Search sessions (scoped; must be before /:id)
  router.get("/search", async (req, res, next) => {
    try {
      const q = req.query.q;
      const scope = scopeOf(req);
      if (!q) {
        return res.json({ success: true, sessions: scope ? await db.getSessionsScoped(scope) : await db.getAllSessions() });
      }
      const results = scope ? await db.searchSessionsScoped(q, scope) : await db.searchSessions(q);
      res.json({ success: true, sessions: results });
    } catch (err) { next(err); }
  });

  // Export sessions (scoped — never dump other tenants'/users' sessions)
  router.get("/export/all", async (req, res, next) => {
    try {
      const scope = scopeOf(req);
      const all = scope ? await db.getSessionsScoped(scope) : await db.getAllSessions();
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", "attachment; filename=orbit-sessions-export.json");
      res.json(all);
    } catch (err) { next(err); }
  });

  // Import sessions — each is (re)stamped with the caller's tenant + owner, and
  // a session whose id already exists under someone else is skipped (no
  // cross-tenant overwrite).
  router.post("/import", async (req, res, next) => {
    try {
      const sessions = req.body;
      if (!Array.isArray(sessions)) {
        return res.status(400).json({ success: false, message: "Expected an array of sessions." });
      }
      let imported = 0;
      for (const session of sessions) {
        if (!(session.id && session.title !== undefined)) continue;
        const existing = await db.getSession(session.id);
        if (existing && !canSee(req, existing)) continue; // can't clobber another owner's session
        if (!isSuper(req)) { session.tenantId = tenantOf(req); session.userId = ownerOf(req); }
        await db.saveSession(session);
        imported++;
      }
      res.json({ success: true, imported });
    } catch (err) { next(err); }
  });

  // List backups
  router.get("/backups", (req, res, next) => {
    try {
      const backups = db.getBackups();
      res.json({ success: true, backups });
    } catch (err) { next(err); }
  });

  // Get single session (owner/tenant-guarded)
  router.get("/:id", async (req, res, next) => {
    try {
      const session = await db.getSession(req.params.id);
      if (!canSee(req, session)) {
        return res.status(404).json({ success: false, message: "Session not found" });
      }
      res.json({ success: true, session });
    } catch (err) { next(err); }
  });

  // Create or update session
  router.post("/", async (req, res, next) => {
    try {
      const incoming = req.body || {};
      // `metrics` and `subagentTree` are OWNED by the backend: metricsManager
      // and subagentTracker persist the authoritative values on turn-end and on
      // a 30s timer (see server.js). The dashboard re-POSTs the whole session on
      // every message edit but only carries a zeroed metrics seed — honoring it
      // here wiped the real counts, which is the "metrics reset on reload /
      // session switch" bug. For an existing session, keep the persisted
      // metrics/tree; a brand-new session (no row yet) keeps whatever it sends.
      const existing = incoming.id ? await db.getSession(incoming.id) : null;
      if (existing) {
        // Updating an existing session — must be visible to the caller, and its
        // ownership is preserved (never re-homed by a client re-POST).
        if (!canSee(req, existing)) return res.status(404).json({ success: false, message: "Session not found" });
        incoming.tenantId = existing.tenantId;
        incoming.userId = existing.userId;
        incoming.metrics = existing.metrics;
        if (!incoming.subagentTree || Object.keys(incoming.subagentTree).length === 0) {
          incoming.subagentTree = existing.subagentTree;
        }
        if (!incoming.plans || incoming.plans.length === 0) {
          incoming.plans = existing.plans;
          incoming.planSteps = existing.planSteps;
          incoming.activePlanId = existing.activePlanId;
        }
      } else if (!isSuper(req)) {
        // New session — stamp the creating tenant + user as owner.
        incoming.tenantId = tenantOf(req);
        incoming.userId = ownerOf(req);
      }
      await db.saveSession(incoming);
      res.json({ success: true });
    } catch (err) { next(err); }
  });

  // Rename session (PATCH) — owner/tenant-guarded
  router.patch("/:id", async (req, res, next) => {
    try {
      const session = await db.getSession(req.params.id);
      if (!canSee(req, session)) {
        return res.status(404).json({ success: false, message: "Session not found" });
      }
      if (req.body.title !== undefined) session.title = req.body.title;
      if (req.body.mode !== undefined) session.mode = req.body.mode;
      await db.saveSession(session);
      res.json({ success: true, session });
    } catch (err) { next(err); }
  });

  // Delete session — owner/tenant-guarded
  router.delete("/:id", async (req, res, next) => {
    try {
      const session = await db.getSession(req.params.id);
      if (!canSee(req, session)) {
        return res.status(404).json({ success: false, message: "Session not found" });
      }
      await db.deleteSession(req.params.id);
      res.json({ success: true });
    } catch (err) { next(err); }
  });
  
  return router;
}

module.exports = createSessionsRouter;
