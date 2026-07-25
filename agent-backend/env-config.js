// agent-backend/env-config.js
//
// The single source of truth for environment configuration.
//
// Every env var the app reads is declared once in CANONICAL below, with its
// type, default and description. Readers go through `env.get(name)` (or one of
// the typed helpers) rather than touching `process.env` directly, so:
//
//   • there is exactly ONE fallback chain per setting (there used to be four,
//     and one of them was already wrong);
//   • `.env.example` and the Settings "comes from environment" hints can be
//     generated from `describe()` instead of drifting;
//   • the boot tripwire and the tenant-secret reserved-name set are derived
//     from the same table, so a new var is covered automatically.
//
// NAMES CARRY NO BRAND. Prefixes are functional (LLM_, GATEWAY_, AGENT_, AUTH_,
// DB_, SANDBOX_, HARNESS_, RUN_, APP_) so a product rename never touches an
// operator's .env, CI config or secret manager. See docs/rebranding.md.

// ── Types ───────────────────────────────────────────────────────────
// str  — trimmed string, "" when unset
// int  — Number, `default` when unset or unparseable
// bool — "1"/"true"/"yes"/"on" (case-insensitive) → true
// path — like str, but "~" is expanded to the home directory

const os = require("os");
const path = require("path");

/**
 * name → { type, default, group, desc, secret? }
 *
 * `secret: true` means the value must never be logged or returned by an API.
 * `group` orders the generated .env.example.
 */
const CANONICAL = {
  // ── Core ──────────────────────────────────────────────────────────
  PORT:              { type: "int",  default: 6800, group: "core", desc: "Backend port (bare-metal only; Docker forces it)." },
  HOST:              { type: "str",  default: "127.0.0.1", group: "core", desc: "Bind host. Set 0.0.0.0 only behind a proxy on another host — then AUTH_SUPERADMIN_KEY is mandatory." },
  DASHBOARD_ORIGIN:  { type: "str",  default: "http://localhost:6801", group: "core", desc: "Dashboard origin (CORS + OIDC redirect base)." },
  APP_PUBLIC_ORIGIN: { type: "str",  default: "", group: "core", desc: "Public origin harnesses/agents reach this app at. Pins pairing/harness URLs so a proxy mis-setting X-Forwarded-Proto can't break the harness WebSocket." },
  APP_HOME:          { type: "path", default: "", group: "core", desc: "Where per-session workspaces live. Default: ~/.tether" },
  APP_URL:           { type: "str",  default: "", group: "core", desc: "Base URL used by the E2E harness (tests only)." },

  // ── LLM (upstream: app → provider) ────────────────────────────────
  // These four are the onboarding defaults. Anything saved in Settings wins;
  // an empty Settings field falls back to these.
  LLM_BASE_URL:        { type: "str", default: "", group: "llm", desc: "Upstream OpenAI-compatible endpoint (OpenAI, Groq, OpenRouter, Together, Ollama, vLLM, a proxy, …). Leave blank if you have none yet — the UI will prompt." },
  LLM_API_KEY:         { type: "str", default: "", group: "llm", secret: true, desc: "Upstream API key. Held server-side; spawned agents never see it." },
  LLM_FAST_MODEL:      { type: "str", default: "", group: "llm", desc: "Default model for the fast/balanced effort tiers." },
  LLM_REASONING_MODEL: { type: "str", default: "", group: "llm", desc: "Default model for the deep effort tier and plan generation. Falls back to LLM_FAST_MODEL." },
  LLM_CONFIG_LOCKED:   { type: "bool", default: false, group: "llm", desc: "Invert precedence: env wins over Settings, and the LLM fields render read-only. For locked-down deployments." },
  LLM_PLAN_MAX_TOKENS: { type: "int", default: 600, group: "llm", desc: "Output cap for the optional pre-plan call." },
  LLM_PLAN_TIMEOUT_MS: { type: "int", default: 20000, group: "llm", desc: "Client timeout for the optional pre-plan call." },

  // ── Internal LLM gateway (app → spawned agent) ────────────────────
  // A PRIVATE PROCESS CONTRACT, not user config. The app publishes GATEWAY_KEY
  // and GATEWAY_URL onto its own process.env at boot; the harness threads
  // GATEWAY_BASE_URL / GATEWAY_API_KEY / GATEWAY_MODEL into the child. Setting
  // these by hand is almost never right.
  GATEWAY_KEY:      { type: "str", default: "", group: "gateway", secret: true, desc: "App-local credential agents use against the internal /llm/v1 gateway. Auto-generated per boot; pin only if you need it stable." },
  GATEWAY_URL:      { type: "str", default: "", group: "gateway", desc: "Internal gateway URL. Defaults to http://127.0.0.1:<PORT>/llm/v1." },
  GATEWAY_BASE_URL: { type: "str", default: "", group: "gateway", desc: "Set by the app on a spawned agent. Not operator config." },
  GATEWAY_API_KEY:  { type: "str", default: "", group: "gateway", secret: true, desc: "Set by the app on a spawned agent. Not operator config." },
  GATEWAY_MODEL:    { type: "str", default: "", group: "gateway", desc: "Set by the app on a spawned agent. Not operator config." },

  // ── Agent / adapter runtime contract ──────────────────────────────
  AGENT_SESSION_ID:   { type: "str", default: "", group: "agent", desc: "Injected into built-in MCP servers so session-blind tools can identify the lead session." },
  AGENT_API_URL:      { type: "str", default: "http://127.0.0.1:6800", group: "agent", desc: "Backend base URL an MCP server or adapter calls back on." },
  AGENT_API_KEY:      { type: "str", default: "", group: "agent", secret: true, desc: "Credential an MCP server or adapter presents on that callback." },
  AGENT_MODE:         { type: "str", default: "", group: "agent", desc: "Policy mode (chat|plan|edit|yolo) for a spawned agent." },
  AGENT_CMD:          { type: "str", default: "", group: "agent", desc: "Override the agent binary the remote adapter launches." },
  AGENT_ARGS:         { type: "str", default: "", group: "agent", desc: "Extra args for that binary." },
  AGENT_CONNECT_KIND: { type: "str", default: "", group: "agent", desc: "Which agent kind the remote adapter connects as." },
  AGENT_ADAPTER_HOME: { type: "path", default: "", group: "agent", desc: "State directory for the remote adapter." },

  // ── Access control ────────────────────────────────────────────────
  AUTH_SUPERADMIN_KEY:      { type: "str", default: "", group: "auth", secret: true, desc: "Superadmin BEARER credential. UNSET MEANS AUTH IS BYPASSED (local dev-mode: every caller is superadmin). Set it before exposing the server beyond loopback." },
  AUTH_SUPERADMIN_USERNAME: { type: "str", default: "admin", group: "auth", desc: "Username for the seeded browser sign-in account." },
  AUTH_SUPERADMIN_PASSWORD: { type: "str", default: "", group: "auth", secret: true, desc: "Password for that account. If unset, a random one is generated and printed once at first boot." },

  // ── Database ──────────────────────────────────────────────────────
  DATABASE_URL:    { type: "str", default: "", group: "db", secret: true, desc: "Postgres connection string. Present → the postgres driver is selected." },
  DB_DRIVER:       { type: "str", default: "", group: "db", desc: "Force a driver (sqlite|postgres) regardless of DATABASE_URL." },
  DB_PATH:         { type: "path", default: "", group: "db", desc: "SQLite file location. Default: agent-backend/tether.db" },
  DB_PG_POOL_MAX:  { type: "int", default: 10, group: "db", desc: "Postgres pool size." },

  // ── Execution sandbox ─────────────────────────────────────────────
  SANDBOX_DEFAULT:           { type: "str",  default: "host", group: "sandbox", desc: "Where a session runs when nothing specifies one: host | container | remote." },
  SANDBOX_IMAGE:             { type: "str",  default: "nikolaik/python-nodejs:python3.12-nodejs22-slim", group: "sandbox", desc: "Container sandbox image (ships python + node)." },
  SANDBOX_PULL:              { type: "str",  default: "missing", group: "sandbox", desc: "missing (default) | never (air-gapped) | always." },
  SANDBOX_NETWORK:           { type: "str",  default: "host", group: "sandbox", desc: "Container network. Non-host isolates net and publishes host.docker.internal." },
  SANDBOX_HARNESS_CONFIG_RO: { type: "bool", default: false, group: "sandbox", desc: "Mount the host harness config dir (~/.pi) read-only to protect its auth." },
  SANDBOX_HOST_GATEWAY:      { type: "str",  default: "host.docker.internal", group: "sandbox", desc: "Host gateway name used from inside containers." },

  // ── Harness binaries ──────────────────────────────────────────────
  HARNESS_PI_PATH:       { type: "path", default: "", group: "harness", desc: "Path to the `pi` binary. Auto-discovered on PATH if unset." },
  HARNESS_NODE_PATH:     { type: "path", default: "", group: "harness", desc: "Path to the node binary that runs pi. Deliberately NOT Node's own NODE_PATH, which means something else entirely." },
  HARNESS_OPENCODE_PATH: { type: "path", default: "", group: "harness", desc: "Path to the `opencode` binary for the optional OpenCode harness." },

  // ── Run API ───────────────────────────────────────────────────────
  RUN_SANDBOX:         { type: "str", default: "", group: "run", desc: "Sandbox for /api/run when the request/profile doesn't set one. Defaults to container, downgrading to host without Docker." },
  RUN_IDLE_MS:         { type: "int", default: 180000, group: "run", desc: "Abort a run after this long with no harness events (hang detection)." },
  RUN_MAX_MS:          { type: "int", default: 1200000, group: "run", desc: "Absolute backstop per run." },
  RUN_ASK_TIMEOUT_MS:  { type: "int", default: 600000, group: "run", desc: "How long a run parks at awaiting_input before returning a no-answer sentinel." },
  RUN_TESTER_URL:      { type: "str", default: "", group: "run", desc: "External build+test facility /grade endpoint. Unset → the end_build handoff is inert." },
  RUN_TESTER_KEY:      { type: "str", default: "", group: "run", secret: true, desc: "Bearer token sent to that facility." },

  // ── Secrets at rest ───────────────────────────────────────────────
  APP_SECRET:      { type: "str",  default: "", group: "secrets", secret: true, desc: "AES-256-GCM key material for stored secrets and OAuth tokens. STRONGLY recommended in Docker: unset means a random key file, and a container recreate without a persistent volume mints a new key and orphans every encrypted value." },
  APP_SECRET_FILE: { type: "path", default: "", group: "secrets", desc: "Where the auto-generated key is persisted when APP_SECRET is unset. Default: $APP_HOME/.tether-secret" },

  // ── Enterprise SSO ────────────────────────────────────────────────
  OIDC_ISSUER_URL:      { type: "str", default: "", group: "sso", desc: "OIDC issuer. Works with Entra, Okta, Google, Auth0, Keycloak, …" },
  OIDC_CLIENT_ID:       { type: "str", default: "", group: "sso", desc: "OIDC client id." },
  OIDC_CLIENT_SECRET:   { type: "str", default: "", group: "sso", secret: true, desc: "OIDC client secret." },
  OIDC_REDIRECT_URI:    { type: "str", default: "", group: "sso", desc: "Default <DASHBOARD_ORIGIN>/api/auth/sso/callback." },
  OIDC_SCOPES:          { type: "str", default: "openid email profile", group: "sso", desc: "Requested scopes." },
  OIDC_ADMIN_EMAILS:    { type: "str", default: "", group: "sso", desc: "Comma-separated; these sign in as tenant-admins." },
  OIDC_ALLOWED_DOMAINS: { type: "str", default: "", group: "sso", desc: "Comma-separated; restrict sign-in to these email domains." },

  // ── Optional services ─────────────────────────────────────────────
  LIGHTPANDA_WS:           { type: "str", default: "ws://127.0.0.1:9222", group: "services", desc: "Lightpanda browser CDP endpoint." },
  LOCAL_TTS_URL:           { type: "str", default: "", group: "services", desc: "TTS endpoint. The voice UI only appears when this is set." },
  LOCAL_TTS_KEY:           { type: "str", default: "", group: "services", secret: true, desc: "TTS key." },
  LOCAL_TTS_MODEL:         { type: "str", default: "pocket-tts", group: "services", desc: "TTS model." },
  EXA_API_KEY:             { type: "str", default: "", group: "services", secret: true, desc: "Backend for pi's native web_search." },
  PERPLEXITY_API_KEY:      { type: "str", default: "", group: "services", secret: true, desc: "Backend for pi's native web_search." },
  GEMINI_API_KEY:          { type: "str", default: "", group: "services", secret: true, desc: "Backend for pi's native web_search." },
  TELEGRAM_DISABLE:        { type: "bool", default: false, group: "services", desc: "Disable the Telegram poller entirely." },
  APP_DEVICE_LLM_BUDGET:   { type: "int", default: 0, group: "services", desc: "Per-device LLM spend cap. 0 = unlimited." },
  APP_OS:                  { type: "str", default: "", group: "services", desc: "Reported OS label for a paired device." },
};

// ── Legacy → canonical ───────────────────────────────────────────────
// A hard cut: legacy names are NOT read. They exist here only so the boot
// tripwire can name the replacement, and so scripts/migrate-env.js can rewrite
// a .env file. Never add a fallback read here — the whole point is that a
// stale .env fails loudly instead of half-working.
//
// The security case for failing closed: an unset AUTH_SUPERADMIN_KEY is not an
// error, it is documented dev-mode with auth bypassed. A .env still saying
// ORBIT_SUPERADMIN_KEY would therefore boot a deployment wide open, silently.
//
// ⚠ THIS MAP IS THE ONE PLACE OLD BRAND NAMES ARE ALLOWED TO SURVIVE, and the
// documented exception to the rebrand drift gate (docs/rebranding.md). It is a
// historical record, not live configuration — a rename sweep must SKIP this
// block, and a find-and-replace that "fixes" these keys silently turns the
// tripwire into a no-op (every entry would map a name to itself).
//
// It is also temporary. Once operators have migrated, delete the ORBIT_*/AEGIS_*
// rows: the previous rebrand left AEGIS_API_KEY alive for a full cycle precisely
// because nobody owned removing it.
const LEGACY = {
  // LLM
  LLM_MODEL: "LLM_FAST_MODEL",
  LITELLM_BASE_URL: "LLM_BASE_URL",
  LITELLM_KEY: "LLM_API_KEY",
  LITELLM_MODEL: "LLM_FAST_MODEL",
  OPENAI_BASE_URL: "LLM_BASE_URL",
  OPENAI_API_KEY: "LLM_API_KEY",
  OPENAI_MODEL: "LLM_FAST_MODEL",
  OPENAI_API_BASE: "LLM_BASE_URL",
  ORBIT_PLAN_MODEL: "LLM_REASONING_MODEL",
  ORBIT_PLAN_MAX_TOKENS: "LLM_PLAN_MAX_TOKENS",
  ORBIT_PLAN_TIMEOUT_MS: "LLM_PLAN_TIMEOUT_MS",
  // Gateway
  ORBIT_GATEWAY_KEY: "GATEWAY_KEY",
  ORBIT_GATEWAY_URL: "GATEWAY_URL",
  ORBIT_LLM_BASE_URL: "GATEWAY_BASE_URL",
  ORBIT_LLM_KEY: "GATEWAY_API_KEY",
  ORBIT_LLM_MODEL: "GATEWAY_MODEL",
  // Agent
  ORBIT_SESSION_ID: "AGENT_SESSION_ID",
  ORBIT_API: "AGENT_API_URL",
  ORBIT_API_KEY: "AGENT_API_KEY",
  AEGIS_API_KEY: "AGENT_API_KEY",
  ORBIT_MODE: "AGENT_MODE",
  AEGIS_MODE: "AGENT_MODE",
  ORBIT_AGENT_CMD: "AGENT_CMD",
  ORBIT_AGENT_ARGS: "AGENT_ARGS",
  ORBIT_CONNECT_AGENT: "AGENT_CONNECT_KIND",
  ORBIT_ADAPTER_HOME: "AGENT_ADAPTER_HOME",
  // Auth
  ORBIT_SUPERADMIN_KEY: "AUTH_SUPERADMIN_KEY",
  ORBIT_SUPERADMIN_USERNAME: "AUTH_SUPERADMIN_USERNAME",
  ORBIT_SUPERADMIN_PASSWORD: "AUTH_SUPERADMIN_PASSWORD",
  // DB
  ORBIT_DB_DRIVER: "DB_DRIVER",
  ORBIT_DB_PATH: "DB_PATH",
  ORBIT_SQLITE_PATH: "DB_PATH",
  ORBIT_PG_POOL_MAX: "DB_PG_POOL_MAX",
  // Sandbox
  ORBIT_DEFAULT_SANDBOX: "SANDBOX_DEFAULT",
  ORBIT_SANDBOX_IMAGE: "SANDBOX_IMAGE",
  ORBIT_SANDBOX_NETWORK: "SANDBOX_NETWORK",
  ORBIT_SANDBOX_PULL: "SANDBOX_PULL",
  ORBIT_SANDBOX_PI_CONFIG_RO: "SANDBOX_HARNESS_CONFIG_RO",
  ORBIT_HOST_GATEWAY: "SANDBOX_HOST_GATEWAY",
  // Harness
  PI_CLI_PATH: "HARNESS_PI_PATH",
  PI_NODE_PATH: "HARNESS_NODE_PATH",
  OPENCODE_PATH: "HARNESS_OPENCODE_PATH",
  // Run
  ORBIT_RUN_SANDBOX: "RUN_SANDBOX",
  ORBIT_RUN_MAX_MS: "RUN_MAX_MS",
  ORBIT_RUN_IDLE_MS: "RUN_IDLE_MS",
  ORBIT_ASK_TIMEOUT_MS: "RUN_ASK_TIMEOUT_MS",
  ORBIT_TESTER_URL: "RUN_TESTER_URL",
  ORBIT_TESTER_KEY: "RUN_TESTER_KEY",
  // App
  ORBIT_HOME: "APP_HOME",
  ORBIT_SECRET: "APP_SECRET",
  ORBIT_SECRET_FILE: "APP_SECRET_FILE",
  ORBIT_PUBLIC_ORIGIN: "APP_PUBLIC_ORIGIN",
  ORBIT_URL: "APP_URL",
  ORBIT_OS: "APP_OS",
  ORBIT_DEVICE_LLM_BUDGET: "APP_DEVICE_LLM_BUDGET",
};

// Self-check: an entry mapping a name to itself means a rename sweep ran over
// this block and neutered the tripwire. Fail at require-time, loudly.
for (const [old, replacement] of Object.entries(LEGACY)) {
  if (old === replacement) {
    throw new Error(
      `[env-config] LEGACY['${old}'] maps to itself — a find-and-replace has corrupted the legacy map. ` +
      `This block is a historical record and must be excluded from rename sweeps (see docs/rebranding.md).`,
    );
  }
}

const TRUTHY = new Set(["1", "true", "yes", "on"]);

function coerce(raw, spec) {
  if (raw === undefined || raw === null) return spec.default;
  const s = String(raw).trim();
  if (s === "") return spec.default;
  switch (spec.type) {
    case "int": {
      const n = Number(s);
      return Number.isFinite(n) ? n : spec.default;
    }
    case "bool":
      return TRUTHY.has(s.toLowerCase());
    case "path":
      return s.startsWith("~") ? path.join(os.homedir(), s.slice(1)) : s;
    default:
      return s;
  }
}

/**
 * Read a canonical env var, typed and defaulted. Unknown names throw — that is
 * deliberate: a typo'd env name should fail at boot, not silently read as "".
 */
function get(name) {
  const spec = CANONICAL[name];
  if (!spec) throw new Error(`[env] '${name}' is not a declared environment variable (see agent-backend/env-config.js).`);
  return coerce(process.env[name], spec);
}

/** True if the operator actually set this var (as opposed to us defaulting it). */
function isSet(name) {
  const v = process.env[name];
  return v !== undefined && String(v).trim() !== "";
}

/** Publish a resolved value back onto process.env so child processes inherit it. */
function set(name, value) {
  if (!CANONICAL[name]) throw new Error(`[env] cannot set undeclared variable '${name}'.`);
  process.env[name] = String(value);
  return value;
}

/**
 * The four LLM settings that seed the app's onboarding defaults.
 * `reasoningModel` falls back to `fastModel` so a single-model deployment works
 * without configuring the deep tier separately.
 */
function llm() {
  const fastModel = get("LLM_FAST_MODEL");
  return {
    baseUrl: get("LLM_BASE_URL"),
    apiKey: get("LLM_API_KEY"),
    fastModel,
    reasoningModel: get("LLM_REASONING_MODEL") || fastModel,
    locked: get("LLM_CONFIG_LOCKED"),
  };
}

/**
 * Names a tenant-supplied secret must never be able to occupy when it is
 * injected into a sandbox env — otherwise a secret named GATEWAY_API_KEY could
 * hijack the child's credentials.
 *
 * Derived from CANONICAL, so a new declared var is protected automatically.
 * This replaces a brand-prefix regex: one prefix (`ORBIT_`) was a tidy fence,
 * nine functional prefixes are not — and a prefix fence also blocks legitimate
 * tenant secrets that merely start with the same letters.
 */
const EXTRA_RESERVED = ["PATH", "HOME", "PWD", "SHELL", "USER", "LOGNAME", "TMPDIR", "LD_PRELOAD", "LD_LIBRARY_PATH", "NODE_OPTIONS", "NODE_PATH", "NODE_ENV"];

function reservedNames() {
  return new Set([...Object.keys(CANONICAL), ...Object.keys(LEGACY), ...EXTRA_RESERVED]);
}

/**
 * Every name that could carry the app's UPSTREAM LLM credentials — canonical
 * and legacy. A spawned agent must never see any of them: it talks to the
 * internal gateway with an app-local key instead.
 *
 * Derived rather than hand-listed, because the hand-listed version was the
 * hazard: OPENAI_API_KEY meant both "the app's upstream key" and "the child's
 * own OpenAI creds", so the scrub had to enumerate aliases and any missed one
 * leaked the real key into a child process.
 */
const UPSTREAM_LLM = ["LLM_BASE_URL", "LLM_API_KEY", "LLM_FAST_MODEL", "LLM_REASONING_MODEL"];

function upstreamLlmNames() {
  const names = new Set(UPSTREAM_LLM);
  for (const [old, replacement] of Object.entries(LEGACY)) {
    if (names.has(replacement)) names.add(old);
  }
  return names;
}

/** Case-insensitive membership test for the reserved set. */
function isReserved(name) {
  const upper = String(name || "").toUpperCase();
  return reservedNames().has(upper);
}

/**
 * Boot tripwire. Scans process.env for legacy names and exits if any is set
 * while its replacement is not. Hard cut, but never silent: the operator gets
 * the exact mapping and the migration command.
 */
function checkLegacyEnv({ exit = true } = {}) {
  const stale = [];
  for (const [old, replacement] of Object.entries(LEGACY)) {
    if (!isSet(old)) continue;
    if (isSet(replacement)) continue; // already migrated; the old one is just leftover text
    stale.push([old, replacement]);
  }
  if (stale.length === 0) return [];

  console.error("[FATAL] Your environment uses variable names this version no longer reads.");
  console.error("        Nothing was silently defaulted — rename them and restart:");
  console.error("");
  const width = Math.max(...stale.map(([o]) => o.length));
  for (const [old, replacement] of stale.sort()) {
    console.error(`          ${old.padEnd(width)}  →  ${replacement}`);
  }
  console.error("");
  console.error("        To rewrite a .env file in place:");
  console.error("          node scripts/migrate-env.js .env          # add --dry-run to preview");
  console.error("");
  if (exit) process.exit(1);
  return stale;
}

/** Table for generating .env.example and the Settings env hints. */
function describe() {
  return Object.entries(CANONICAL).map(([name, spec]) => ({
    name,
    type: spec.type,
    group: spec.group,
    desc: spec.desc,
    secret: Boolean(spec.secret),
    default: spec.default,
    isSet: isSet(name),
  }));
}

module.exports = {
  CANONICAL,
  LEGACY,
  get,
  set,
  isSet,
  llm,
  reservedNames,
  isReserved,
  upstreamLlmNames,
  checkLegacyEnv,
  describe,
};
