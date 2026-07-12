// agent-backend/routes/fleet.js
// HTTP surface for orchestrated-lead fleet dispatch. Called by the
// `orbit-fleet` MCP tool server (mcp-server-fleet/index.js), which is what the
// lead agent actually invokes. Kept separate so the agent reaches it the same
// way it reaches any tool.

const express = require("express");

function createFleetRouter({ fleet }) {
  const router = express.Router();

  // Devices the lead can delegate to.
  router.get("/devices", (req, res, next) => {
    try {
      res.json({ success: true, devices: fleet.listDevices() });
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
