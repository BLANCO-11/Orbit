// agent-backend/routes/sessions.js
// Session CRUD, search, export, import, backups

const { Router } = require("express");
const db = require("../db");

function createSessionsRouter() {
  const router = Router();
  
  // List all sessions
  router.get("/", async (req, res, next) => {
    try {
      const list = await db.getAllSessions();
      res.json({ success: true, sessions: list });
    } catch (err) { next(err); }
  });

  // Search sessions (must be before /:id)
  router.get("/search", async (req, res, next) => {
    try {
      const q = req.query.q;
      if (!q) return res.json({ success: true, sessions: await db.getAllSessions() });
      const results = await db.searchSessions(q);
      res.json({ success: true, sessions: results });
    } catch (err) { next(err); }
  });

  // Export all sessions
  router.get("/export/all", async (req, res, next) => {
    try {
      const all = await db.getAllSessions();
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", "attachment; filename=orbit-sessions-export.json");
      res.json(all);
    } catch (err) { next(err); }
  });

  // Import sessions
  router.post("/import", async (req, res, next) => {
    try {
      const sessions = req.body;
      if (!Array.isArray(sessions)) {
        return res.status(400).json({ success: false, message: "Expected an array of sessions." });
      }
      let imported = 0;
      for (const session of sessions) {
        if (session.id && session.title !== undefined) {
          await db.saveSession(session);
          imported++;
        }
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

  // Get single session
  router.get("/:id", async (req, res, next) => {
    try {
      const session = await db.getSession(req.params.id);
      if (!session) {
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
        incoming.metrics = existing.metrics;
        if (!incoming.subagentTree || Object.keys(incoming.subagentTree).length === 0) {
          incoming.subagentTree = existing.subagentTree;
        }
        if (!incoming.plans || incoming.plans.length === 0) {
          incoming.plans = existing.plans;
          incoming.planSteps = existing.planSteps;
          incoming.activePlanId = existing.activePlanId;
        }
      }
      await db.saveSession(incoming);
      res.json({ success: true });
    } catch (err) { next(err); }
  });

  // Rename session (PATCH)
  router.patch("/:id", async (req, res, next) => {
    try {
      const session = await db.getSession(req.params.id);
      if (!session) {
        return res.status(404).json({ success: false, message: "Session not found" });
      }
      if (req.body.title !== undefined) session.title = req.body.title;
      if (req.body.mode !== undefined) session.mode = req.body.mode;
      await db.saveSession(session);
      res.json({ success: true, session });
    } catch (err) { next(err); }
  });

  // Delete session
  router.delete("/:id", async (req, res, next) => {
    try {
      await db.deleteSession(req.params.id);
      res.json({ success: true });
    } catch (err) { next(err); }
  });
  
  return router;
}

module.exports = createSessionsRouter;
