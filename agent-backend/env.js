// agent-backend/env.js
// Startup environment validation + Pi binary path discovery

const fs = require("fs");
const os = require("os");
const path = require("path");

// Nothing is hard-required at boot anymore: the app must start even with no LLM
// configured so the "No LLM configured — add a provider" UI can guide the user
// (Workstream F4). Missing config is surfaced as warnings + capability state.
const REQUIRED_VARS = [];
const RECOMMENDED_VARS = ["LOCAL_TTS_KEY", "LIGHTPANDA_WS"];

// Provider-agnostic LLM env resolution (Workstream F1). Neutral `LLM_*` names
// are primary; the historical `LITELLM_*` / `OPENAI_*` names are read as
// fallbacks so existing installs keep working. Any OpenAI-compatible endpoint
// (OpenAI, Groq, OpenRouter, Together, Ollama, vLLM, a LiteLLM proxy, …) works
// — Orbit only ever speaks `/v1` HTTP against baseURL + apiKey + model.
function resolveLlmEnv() {
  return {
    baseURL:
      process.env.LLM_BASE_URL ||
      process.env.LITELLM_BASE_URL ||
      process.env.OPENAI_BASE_URL ||
      "",
    apiKey:
      process.env.LLM_API_KEY ||
      process.env.LITELLM_KEY ||
      process.env.OPENAI_API_KEY ||
      "",
    model:
      process.env.LLM_MODEL ||
      process.env.LITELLM_MODEL ||
      process.env.OPENAI_MODEL ||
      "",
  };
}

function resolveFromPath(binName) {
  const pathEnv = process.env.PATH || "";
  const dirs = pathEnv.split(path.delimiter);
  for (const dir of dirs) {
    const full = path.join(dir, binName);
    try {
      if (fs.existsSync(full)) {
        return fs.realpathSync(full);
      }
    } catch (e) {}
  }
  return null;
}

function discoverPiBinaries() {
  const nodePath = process.env.PI_NODE_PATH || process.env.NODE_PATH;
  const piPath = process.env.PI_CLI_PATH;
  
  if (!nodePath || !piPath) {
    const homeDir = os.homedir();
    const candidates = [
      `${homeDir}/.local/share/pi-node/node-v22.22.3-linux-x64/bin/node`,
      `${homeDir}/.local/share/pi-node/node-v22.22.3-linux-x64/bin/pi`,
    ];

    let resolvedNode = nodePath || (fs.existsSync(candidates[0]) ? candidates[0] : null);
    if (!resolvedNode) {
      resolvedNode = resolveFromPath("node") || "node";
    }

    let resolvedPi = piPath || (fs.existsSync(candidates[1]) ? candidates[1] : null);
    if (!resolvedPi && fs.existsSync("/usr/local/bin/pi")) {
      resolvedPi = "/usr/local/bin/pi";
    }
    if (!resolvedPi) {
      resolvedPi = resolveFromPath("pi") || "pi";
    }

    return {
      nodePath: resolvedNode,
      piPath: resolvedPi,
    };
  }
  
  return { nodePath, piPath };
}

// Placeholder values shipped in .env.example. A non-empty placeholder passes a
// naive "is it set?" check but every LLM call still fails — so we detect and
// warn loudly rather than let it fail lazily and confusingly at first prompt.
const PLACEHOLDER_KEYS = new Set([
  "sk-your-key", "your-key", "your-api-key", "sk-...", "changeme",
  "your-llm-api-key", "replace-me", "xxx",
]);

function isPlaceholderKey(value) {
  if (!value) return false;
  return PLACEHOLDER_KEYS.has(String(value).trim().toLowerCase());
}

function validateEnv() {
  const missing = REQUIRED_VARS.filter(v => !process.env[v]);
  if (missing.length > 0) {
    console.error(`[FATAL] Missing required environment variables: ${missing.join(", ")}`);
    console.error("Set them in .env or your shell environment.");
    process.exit(1);
  }

  // LLM config is not fatal (it can also be set via the Settings UI), but warn
  // clearly when it's absent or still a placeholder so the failure isn't a
  // confusing lazy error at first prompt.
  const { apiKey } = resolveLlmEnv();
  if (!apiKey) {
    console.warn("[WARN] No LLM API key found in env (LLM_API_KEY / LITELLM_KEY / OPENAI_API_KEY).");
    console.warn("       Configure a provider in .env or Settings, or the UI will prompt you to add one.");
  } else if (isPlaceholderKey(apiKey)) {
    console.warn(`[WARN] LLM API key is still the placeholder value ("${apiKey}").`);
    console.warn("       LLM calls will fail until you set a real key in .env or Settings.");
  }

  const missingRecommended = RECOMMENDED_VARS.filter(v => !process.env[v]);
  if (missingRecommended.length > 0) {
    console.warn(`[WARN] Recommended environment variables not set: ${missingRecommended.join(", ")}`);
    console.warn("Some features may be unavailable.");
  }

  console.log("[Env] Validation passed. Required vars are set.");
}

// Boot-time harness probe: confirm the resolved `pi` binary actually exists, so
// a missing harness surfaces immediately with actionable guidance instead of
// failing lazily at the first session start. Returns true if pi looks runnable.
function probePiBinary(piPath) {
  let resolved = piPath;
  // A bare "pi" means discovery fell through to PATH without a hit — re-check.
  if (!resolved || resolved === "pi") {
    resolved = resolveFromPath("pi");
  }
  const ok = Boolean(resolved && fs.existsSync(resolved));
  if (ok) {
    console.log(`[Harness] pi CLI found at ${resolved}.`);
  } else {
    console.warn("[WARN] No local pi harness found on PATH (PI_CLI_PATH unset too).");
    console.warn("       Local agent sessions can't start until pi is installed — see setup.sh /");
    console.warn("       the README. You can still run headless or drive a paired remote harness.");
  }
  return ok;
}

module.exports = { validateEnv, discoverPiBinaries, probePiBinary, isPlaceholderKey, resolveLlmEnv };
