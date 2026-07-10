// agent-backend/routes/config.js
// GET /api/config, POST /api/config

const { Router } = require("express");
const { loadConfig, saveConfig } = require("../config");

function createConfigRouter(activeSessionsMap) {
  const router = Router();
  
  router.get("/", (req, res) => {
    res.json(loadConfig());
  });
  
  router.post("/", (req, res, next) => {
    try {
      const config = req.body;
      saveConfig(config);
      
      // Kill all active agent sessions to force config reload
      for (const [sessionId, session] of activeSessionsMap.entries()) {
        if (session.piProcess || session.harness) {
          console.log(`Killing active session ${sessionId} to apply new configuration...`);
          try {
            if (session.harness) {
              session.harness.disconnect().catch(() => {});
            } else if (session.piProcess) {
              session.piProcess.kill("SIGINT");
            }
          } catch (e) {
            console.error(`Failed to kill session ${sessionId}:`, e);
          }
        }
        activeSessionsMap.delete(sessionId);
      }
      
      res.json({ success: true, message: "Configuration saved successfully." });
    } catch (error) {
      next(error);
    }
  });
  
  return router;
}

module.exports = createConfigRouter;
