// agent-backend/routes/health.js
// GET /api/health — system health check

const { Router } = require("express");
const os = require("os");

function createHealthRouter({ db, mcpRegistry, getConfig, activeSessions }) {
  const router = Router();

  router.get("/", async (req, res) => {
    let dbStatus = "ok";
    try {
      await db.getAllSessions();
    } catch (e) {
      dbStatus = "error: " + e.message;
    }

    // MCP status is a rollup across all registered connectors: "connected" if
    // any connector is up, "disconnected" if some are registered but none are.
    let mcpStatus = "not_configured";
    let connectorCount = 0;
    if (mcpRegistry && typeof mcpRegistry.list === "function") {
      try {
        const connectors = mcpRegistry.list();
        connectorCount = connectors.length;
        if (connectorCount > 0) {
          mcpStatus = connectors.some(c => c.status === "connected") ? "connected" : "disconnected";
        }
      } catch {
        mcpStatus = "error";
      }
    }
    
    let ttsStatus = "not_configured";
    if (process.env.LOCAL_TTS_KEY) {
      try {
        const resp = await fetch("http://127.0.0.1:6767/v1/voices", {
          headers: { "Authorization": `Bearer ${process.env.LOCAL_TTS_KEY}` },
          signal: AbortSignal.timeout(3000),
        });
        ttsStatus = resp.ok ? "connected" : "error";
      } catch {
        ttsStatus = "unreachable";
      }
    }
    
    const isHealthy = dbStatus === "ok";
    
    res.status(isHealthy ? 200 : 503).json({
      status: isHealthy ? "healthy" : "degraded",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      checks: {
        database: dbStatus,
        mcp: mcpStatus,
        connectors: connectorCount,
        tts: ttsStatus,
        activeSessions: activeSessions ? activeSessions.size : 0,
      },
      memory: {
        rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + " MB",
        heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + " MB",
      },
      cpu: os.loadavg(),
    });
  });
  
  return router;
}

module.exports = createHealthRouter;
