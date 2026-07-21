// agent-backend/routes/fleet.js
// HTTP surface for orchestrated-lead fleet dispatch. Called by the
// `orbit-fleet` MCP tool server (agent-backend/mcp/fleet-mcp.js), which is what the
// lead agent actually invokes. Kept separate so the agent reaches it the same
// way it reaches any tool.

const express = require("express");

function createFleetRouter({ fleet, db }) {
  const router = express.Router();

  // Devices the lead can delegate to — tenant-scoped. This is called by the
  // orbit-fleet MCP tool as the app key (superadmin), so we CANNOT rely on
  // req.auth.tenantId; scope to the LEAD SESSION's tenant instead (the MCP passes
  // ?sessionId=ORBIT_SESSION_ID). Superadmin with no session context sees all.
  router.get("/devices", async (req, res, next) => {
    try {
      let tenantId = (req.auth && req.auth.role === "superadmin") ? null : (req.auth && req.auth.tenantId) || null;
      const sid = req.query.sessionId;
      if (sid && db) {
        try { const s = await db.getSession(String(sid)); if (s) tenantId = s.tenantId || null; } catch {}
      }
      res.json({ success: true, devices: fleet.listDevices(tenantId) });
    } catch (err) { next(err); }
  });

  // Run a task on a device and return its final answer. Synchronous: resolves
  // only when the delegated run completes, so the tool result carries the
  // answer the lead needs to merge.
  router.post("/dispatch", async (req, res, next) => {
    try {
      const { device, prompt, mode, effort, leadSessionId } = req.body || {};
      const result = await fleet.dispatchToDevice({ device, prompt, mode, effort, leadSessionId });
      res.json({ success: true, ...result });
    } catch (err) {
      // Surface the reason to the tool (bad device, empty prompt) rather than a 500.
      res.status(400).json({ success: false, error: err.message });
    }
  });

  return router;
}

module.exports = createFleetRouter;
