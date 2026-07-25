// agent-backend/routes/config.js
// GET /api/config, POST /api/config

const { Router } = require("express");
const { loadConfig, saveConfig, getResolvedConfig, resolveLlm, stripResolved, loadUiConfig, saveUiConfig } = require("../config");
const env = require("../env-config");

// Fields that only take effect when the harness process is (re)spawned, so a
// change to one of them requires cycling active sessions. Everything else —
// policy (paths/commands/modes), budgets, notifications — is read fresh from
// getConfig() on every tool call and every turn, so it hot-reloads with no
// restart. Killing every session on any save was the old, disruptive behavior.
const SPAWN_TIME_LLM_KEYS = ["baseUrl", "apiKey", "fastModel", "reasoningModel"];

function requiresRespawn(oldCfg, newCfg) {
  if ((oldCfg.systemPromptType || "") !== (newCfg.systemPromptType || "")) return true;
  // Web-access extension toggle changes the --exclude-tools spawn arg.
  if (!!oldCfg.webAccess?.enabled !== !!newCfg.webAccess?.enabled) return true;
  const o = oldCfg.llm || {};
  const n = newCfg.llm || {};
  return SPAWN_TIME_LLM_KEYS.some((k) => o[k] !== n[k]);
}

function createConfigRouter(activeSessionsMap) {
  const router = Router();

  router.get("/", (req, res) => {
    // Resolved the SAME way the runtime resolves it. This route used to
    // re-implement the fallback and read only LITELLM_*/OPENAI_*, so setting
    // LLM_BASE_URL alone made the endpoint report an empty baseUrl while the
    // app itself worked fine.
    const config = getResolvedConfig();
    if (!config.tts) config.tts = {};
    if (!config.tts.url) config.tts.url = env.get("LOCAL_TTS_URL");
    if (!config.tts.apiKey) config.tts.apiKey = env.get("LOCAL_TTS_KEY");
    // Tell the UI which LLM fields came from the environment, so Settings can
    // show them as defaults (and render them read-only when locked) instead of
    // presenting an env value as if the user had typed it.
    config.llmEnv = {
      locked: config.llm.locked === true,
      fromEnv: {
        baseUrl: env.isSet("LLM_BASE_URL"),
        apiKey: env.isSet("LLM_API_KEY"),
        fastModel: env.isSet("LLM_FAST_MODEL"),
        reasoningModel: env.isSet("LLM_REASONING_MODEL"),
      },
    };
    res.json(config);
  });

  router.get("/ui", (req, res) => {
    res.json(loadUiConfig());
  });

  router.post("/ui", (req, res, next) => {
    try {
      saveUiConfig(req.body);
      res.json({ success: true, message: "UI configuration saved." });
    } catch (error) {
      next(error);
    }
  });

  router.post("/", (req, res, next) => {
    try {
      const oldConfig = getResolvedConfig();

      // Persist WITHOUT env-derived values (see config.stripResolved): the API
      // hands the client a resolved config, so saving it verbatim would freeze
      // today's env values into the file and stop the env from being a default.
      const toPersist = stripResolved(req.body);
      saveConfig(toPersist);

      // Compare RESOLVED against RESOLVED, so clearing a field back to its env
      // default is correctly seen as "no effective change" and doesn't cycle
      // every live session for nothing.
      const config = { ...toPersist, llm: resolveLlm(toPersist) };

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
