// agent-backend/routes/connectors.js
// MCP connector registry API. Connectors are MCP tool servers the agent can
// use; they live in .pi/mcp.json and are managed here. A connector added here
// is picked up by the next spawned session.
//
// GET    /api/connectors        — list connectors with live status + tools
// POST   /api/connectors        — add/replace a connector { name, command?, args?, env?, url? }
// DELETE /api/connectors/:name  — remove a connector

const { Router } = require("express");

function createConnectorsRouter(registry) {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({ success: true, connectors: registry.list() });
  });

  router.post("/", async (req, res) => {
    const { name, command, args, env, url } = req.body || {};
    try {
      const connectors = await registry.add(name, { command, args, env, url });
      res.json({ success: true, connectors });
    } catch (e) {
      res.status(400).json({ success: false, error: e.message });
    }
  });

  router.delete("/:name", async (req, res) => {
    try {
      const connectors = await registry.remove(req.params.name);
      res.json({ success: true, connectors });
    } catch (e) {
      res.status(400).json({ success: false, error: e.message });
    }
  });

  return router;
}

module.exports = createConnectorsRouter;
