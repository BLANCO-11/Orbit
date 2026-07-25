// agent-backend/config.js
// Load/save security-config.json

const fs = require("fs");
const path = require("path");
const env = require("./env-config");

const CONFIG_PATH = path.join(__dirname, "security-config.json");
const EXAMPLE_PATH = path.join(__dirname, "security-config.example.json");

// security-config.json is gitignored (it holds the user's API key). On a fresh
// clone it won't exist — seed it from the committed example so `git clone && run`
// works instead of crashing. LLM creds can also come from env (.env), which
// override the file at spawn time.
function ensureConfig() {
  if (!fs.existsSync(CONFIG_PATH) && fs.existsSync(EXAMPLE_PATH)) {
    fs.copyFileSync(EXAMPLE_PATH, CONFIG_PATH);
    console.log("[Config] Seeded security-config.json from security-config.example.json — edit it or set LLM creds in .env.");
  }
}

function loadConfig() {
  ensureConfig();
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

// ── LLM resolution: env is the default, a saved preference wins ──────
//
// Precedence, per the product decision: the four LLM_* env vars are the app's
// onboarding DEFAULTS. A non-empty value saved from Settings sits above them.
// Clearing a Settings field therefore means "go back to the env default" —
// which is both the sensible reading and what the code already did.
//
// LLM_CONFIG_LOCKED=true inverts this for locked-down deployments: env wins and
// the UI renders the fields read-only. Off by default, so it is inert unless set.
//
// NOTE: no hardcoded baseUrl fallback. A non-empty placeholder (the old
// "http://127.0.0.1:5000/v1") is truthy, so the `if (!baseUrl)` guard would
// never reach the env value — that was exactly the "Docker ignores LLM_BASE_URL
// and dials 127.0.0.1:5000" bug. Empty stays empty so the "no LLM configured"
// state is honest.
function resolveLlm(config) {
  const e = env.llm();
  const saved = (config && config.llm) || {};
  const pick = (savedValue, envValue) =>
    e.locked ? (envValue || savedValue || "") : (savedValue || envValue || "");

  const fastModel = pick(saved.fastModel, e.fastModel);
  return {
    ...saved,
    baseUrl: pick(saved.baseUrl, e.baseUrl),
    apiKey: pick(saved.apiKey, e.apiKey),
    fastModel,
    // The deep effort tier and plan generation read this. Falls back to the
    // fast model rather than to a provider literal — a hardcoded guess 401s on
    // any gateway that doesn't happen to serve it.
    reasoningModel: pick(saved.reasoningModel, e.reasoningModel) || fastModel,
    locked: e.locked,
  };
}

/**
 * The config every runtime caller should use: the file on disk with `llm`
 * resolved against the environment. Read fresh each call so a saved change
 * hot-reloads on the next tool call / turn without a restart.
 */
function getResolvedConfig() {
  const config = loadConfig();
  config.llm = resolveLlm(config);
  return config;
}

/**
 * Remove resolution artefacts before writing to disk.
 *
 * The API hands the client a RESOLVED config, so a plain save round-trip would
 * persist env-derived values as if the user had typed them — after which
 * changing the env would no longer change anything, because the file now has a
 * non-empty value that wins. An env default must stay a default.
 *
 * So: drop any llm field whose value is exactly the env value, plus the
 * read-only markers. A user who deliberately typed the same string as the env
 * gets identical behaviour either way.
 */
function stripResolved(config) {
  const out = { ...(config || {}) };
  delete out.llmEnv;

  const e = env.llm();
  const llm = { ...(out.llm || {}) };
  delete llm.locked;
  const envValue = {
    baseUrl: e.baseUrl,
    apiKey: e.apiKey,
    fastModel: e.fastModel,
    reasoningModel: e.reasoningModel,
  };
  for (const [key, value] of Object.entries(envValue)) {
    if (value && llm[key] === value) llm[key] = "";
  }
  out.llm = llm;
  return out;
}

const UI_CONFIG_PATH = path.join(__dirname, "ui-config.json");
const UI_EXAMPLE_PATH = path.join(__dirname, "ui-config.example.json");

function ensureUiConfig() {
  if (!fs.existsSync(UI_CONFIG_PATH) && fs.existsSync(UI_EXAMPLE_PATH)) {
    fs.copyFileSync(UI_EXAMPLE_PATH, UI_CONFIG_PATH);
  } else if (!fs.existsSync(UI_CONFIG_PATH)) {
    const defaultUi = {
      viewMode: "advanced",
      components: {
        rail: { console: true, agents: true, fleet: true, connectors: true, library: true, policies: true },
        tabs: { agent: true, preview: true, console: true, workspace: true, trace: true, logs: true },
        views: { console: true, fleet: true, connectors: true, policies: true, library: true, mission: true }
      }
    };
    fs.writeFileSync(UI_CONFIG_PATH, JSON.stringify(defaultUi, null, 2), "utf-8");
  }
}

function loadUiConfig() {
  ensureUiConfig();
  try {
    return JSON.parse(fs.readFileSync(UI_CONFIG_PATH, "utf-8"));
  } catch {
    return {
      viewMode: "advanced",
      components: {
        rail: { console: true, agents: true, fleet: true, connectors: true, library: true, policies: true },
        tabs: { agent: true, preview: true, console: true, workspace: true, trace: true, logs: true },
        views: { console: true, fleet: true, connectors: true, policies: true, library: true, mission: true }
      }
    };
  }
}

function saveUiConfig(config) {
  fs.writeFileSync(UI_CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

module.exports = {
  loadConfig, saveConfig, CONFIG_PATH,
  resolveLlm, getResolvedConfig, stripResolved,
  loadUiConfig, saveUiConfig, UI_CONFIG_PATH,
};
