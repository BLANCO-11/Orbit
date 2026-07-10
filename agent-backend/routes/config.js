// agent-backend/routes/config.js
// GET /api/config, POST /api/config

const { Router } = require("express");
const { loadConfig, saveConfig } = require("../config");

// Fields that only take effect when the harness process is (re)spawned, so a
// change to one of them requires cycling active sessions. Everything else —
// policy (paths/commands/modes), budgets, notifications — is read fresh from
// getConfig() on every tool call and every turn, so it hot-reloads with no
// restart. Killing every session on any save was the old, disruptive behavior.
const SPAWN_TIME_KEYS = {
  litellm: ["baseURL", "apiKey", "selectedNormalModel", "selectedReasoningModel", "taskMode"],
  systemPromptType: true,
};

function requiresRespawn(oldCfg, newCfg) {
  if ((oldCfg.systemPromptType || "") !== (newCfg.systemPromptType || "")) return true;
  const o = oldCfg.litellm || {};
  const n = newCfg.litellm || {};
  return SPAWN_TIME_KEYS.litellm.some((k) => o[k] !== n[k]);
}

function createConfigRouter(activeSessionsMap) {
  const router = Router();

  router.get("/", (req, res) => {
    res.json(loadConfig());
  });

  router.post("/", (req, res, next) => {
    try {
      const oldConfig = loadConfig();
      const config = req.body;
      saveConfig(config);

      // Only cycle sessions when a spawn-time field changed. Policy and budget
      // edits apply to the next tool call / turn with no interruption.
      let cycled = 0;
      if (requiresRespawn(oldConfig, config)) {
        for (const [sessionId, session] of activeSessionsMap.entries()) {
          if (session.piProcess || session.harness) {
            console.log(`Cycling session ${sessionId} to apply model/prompt change...`);
            try {
              if (session.harness) session.harness.disconnect().catch(() => {});
              else if (session.piProcess) session.piProcess.kill("SIGINT");
            } catch (e) {
              console.error(`Failed to cycle session ${sessionId}:`, e);
            }
          }
          activeSessionsMap.delete(sessionId);
          cycled++;
        }
      }

      res.json({
        success: true,
        message: cycled
          ? `Configuration saved. ${cycled} active session(s) restarted for the model/prompt change.`
          : "Configuration saved. Policy and budget changes apply on the next action.",
        sessionsCycled: cycled,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = createConfigRouter;
