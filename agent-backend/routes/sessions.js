// agent-backend/routes/sessions.js
// Session CRUD, search, export, import, backups

const { Router } = require("express");
const db = require("../db");

function createSessionsRouter() {
  const router = Router();
  
  // List all sessions
  router.get("/", (req, res, next) => {
    try {
      const list = db.getAllSessions();
      res.json({ success: true, sessions: list });
    } catch (err) { next(err); }
  });
  
  // Search sessions (must be before /:id)
  router.get("/search", (req, res, next) => {
    try {
      const q = req.query.q;
      if (!q) return res.json({ success: true, sessions: db.getAllSessions() });
      const results = db.searchSessions(q);
      res.json({ success: true, sessions: results });
    } catch (err) { next(err); }
  });
  
  // Export all sessions
  router.get("/export/all", (req, res, next) => {
    try {
      const all = db.getAllSessions();
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", "attachment; filename=orbit-sessions-export.json");
      res.json(all);
    } catch (err) { next(err); }
  });
  
  // Import sessions
  router.post("/import", (req, res, next) => {
    try {
      const sessions = req.body;
      if (!Array.isArray(sessions)) {
        return res.status(400).json({ success: false, message: "Expected an array of sessions." });
      }
      let imported = 0;
      for (const session of sessions) {
        if (session.id && session.title !== undefined) {
          db.saveSession(session);
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
  router.get("/:id", (req, res, next) => {
    try {
      const session = db.getSession(req.params.id);
      if (!session) {
        return res.status(404).json({ success: false, message: "Session not found" });
      }
      res.json({ success: true, session });
    } catch (err) { next(err); }
  });
  
  // Create or update session
  router.post("/", (req, res, next) => {
    try {
      db.saveSession(req.body);
      res.json({ success: true });
    } catch (err) { next(err); }
  });
  
  // Rename session (PATCH)
  router.patch("/:id", (req, res, next) => {
    try {
      const session = db.getSession(req.params.id);
      if (!session) {
        return res.status(404).json({ success: false, message: "Session not found" });
      }
      if (req.body.title !== undefined) session.title = req.body.title;
      if (req.body.mode !== undefined) session.mode = req.body.mode;
      db.saveSession(session);
      res.json({ success: true, session });
    } catch (err) { next(err); }
  });
  
  // Delete session
  router.delete("/:id", (req, res, next) => {
    try {
      db.deleteSession(req.params.id);
      res.json({ success: true });
    } catch (err) { next(err); }
  });
  
  return router;
}

module.exports = createSessionsRouter;
