// agent-backend/services/llm-probe.js
// Live connection test for the configured OpenAI-compatible LLM endpoint
// (Workstream F3). Orbit only ever speaks `/v1` HTTP, so a `models.list()` call
// is a faithful reachability + auth check. The last result is cached so the
// synchronous capabilities manifest can report `llm.connected` without blocking.

const { OpenAI } = require("openai");

// ok: true (reachable) | false (configured but failed) | null (never tested)
let lastResult = { ok: null, at: null, error: null, models: [], configured: false };

async function probeLlm(getConfig) {
  let baseURL = "";
  let apiKey = "";
  try {
    const cfg = (getConfig && getConfig()) || {};
    baseURL = cfg?.litellm?.baseURL || "";
    apiKey = cfg?.litellm?.apiKey || "";
  } catch {}

  const configured = !!(baseURL && apiKey);
  if (!configured) {
    lastResult = { ok: false, at: Date.now(), error: "not_configured", models: [], configured: false };
    return lastResult;
  }

  try {
    const openai = new OpenAI({ baseURL, apiKey });
    const res = await openai.models.list();
    const models = (res.data || []).map((m) => m.id).filter(Boolean);
    lastResult = { ok: true, at: Date.now(), error: null, models, configured: true };
  } catch (e) {
    lastResult = {
      ok: false,
      at: Date.now(),
      error: (e && e.message) || "request_failed",
      models: [],
      configured: true,
    };
  }
  return lastResult;
}

function getLastLlmProbe() {
  return lastResult;
}

module.exports = { probeLlm, getLastLlmProbe };
