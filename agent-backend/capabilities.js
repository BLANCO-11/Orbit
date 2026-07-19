// agent-backend/capabilities.js
//
// The single source of truth for "what can Orbit actually do right now?" — one
// manifest aggregating every capability the app detects across config, env,
// the MCP registry, service connections, the Telegram bridge and the fleet.
//
// Shared infrastructure (NEXT-ITERATION-PLAN Workstreams D2, E, J):
//   • D2 — injected into the agent's system prompt at session start (dynamic,
//          never hand-edited) so the agent knows what's configured vs missing.
//   • E  — surfaced to the agent as the `list_capabilities` MCP tool.
//   • J  — exposed as GET /api/capabilities for headless clients.
//
// Every source is read defensively (try/catch per capability): a broken probe
// degrades one entry to "unknown", it never takes the whole manifest down.

const fs = require("fs");
const os = require("os");
const path = require("path");
const providers = require("./providers");

// Mirror PiCodeHarness._hasNativeSearchConfigured without importing the harness
// (avoids pulling in spawn machinery just to read a couple of keys).
function hasNativeSearch() {
  if (process.env.EXA_API_KEY || process.env.PERPLEXITY_API_KEY || process.env.GEMINI_API_KEY) return true;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".pi", "web-search.json"), "utf-8"));
    return !!(cfg.exaApiKey || cfg.perplexityApiKey || cfg.geminiApiKey || cfg.apiKey);
  } catch { return false; }
}

function resolveTtsKey(config) {
  return process.env.LOCAL_TTS_KEY || (config && config.tts && config.tts.apiKey) || "";
}

function cap(configured, connected, detail) {
  return { configured: !!configured, connected: connected === null ? null : !!connected, detail: detail || "" };
}

/**
 * Build the capability manifest.
 * @param {object} deps
 * @param {() => object} deps.getConfig
 * @param {object} [deps.mcpRegistry]      — .list()
 * @param {object} [deps.telegramBridge]   — .status()
 * @param {object} [deps.db]               — .listConnections(), .listDevices()
 * @returns {{ generatedAt: string, capabilities: object }}
 */
async function buildCapabilities(deps = {}) {
  const { getConfig, mcpRegistry, telegramBridge, db } = deps;
  let config = {};
  try { config = (getConfig && getConfig()) || {}; } catch { config = {}; }

  const capabilities = {};

  // ── LLM ──────────────────────────────────────────────────────────
  try {
    const l = config.litellm || {};
    const configured = !!(l.apiKey && l.baseURL);
    // `connected` reflects the last live probe (Workstream F3): true (reachable),
    // false (configured but the endpoint/key/model failed), or null (untested).
    let connected = null;
    let detail = configured ? `model ${l.selectedNormalModel || "?"} via ${l.baseURL}` : "no LLM endpoint configured";
    if (configured) {
      try {
        const probe = require("./services/llm-probe").getLastLlmProbe();
        if (probe && probe.configured && probe.ok === true) {
          connected = true;
        } else if (probe && probe.configured && probe.ok === false) {
          connected = false;
          detail = `connection failed: ${probe.error || "unknown error"} (${l.baseURL})`;
        }
      } catch {}
    } else {
      connected = false;
    }
    capabilities.llm = cap(configured, connected, detail);
  } catch { capabilities.llm = cap(false, false, "unknown"); }

  // ── Text-to-speech ───────────────────────────────────────────────
  try {
    const key = resolveTtsKey(config);
    capabilities.tts = cap(!!key, key ? null : false,
      key ? `pocket-tts at ${process.env.LOCAL_TTS_URL || (config.tts && config.tts.url) || "http://127.0.0.1:6767"}` : "no TTS key (voice UI hidden)");
  } catch { capabilities.tts = cap(false, false, "unknown"); }

  // ── Web search ───────────────────────────────────────────────────
  // orbit-search (keyless MCP) is ALWAYS available; a native backend key just
  // upgrades quality. So search is configured either way.
  try {
    const native = hasNativeSearch();
    capabilities.web_search = cap(true, true,
      native ? "native web_search (backend key set)" : "orbit-search MCP (keyless default)");
  } catch { capabilities.web_search = cap(true, true, "orbit-search MCP"); }

  // ── Web browse (Lightpanda) ──────────────────────────────────────
  try {
    const enabled = config.webAccess && config.webAccess.enabled === true;
    capabilities.web_browse = cap(enabled, enabled ? null : false,
      enabled ? "Lightpanda MCP browser enabled" : "disabled (enable via config.webAccess)");
  } catch { capabilities.web_browse = cap(false, false, "unknown"); }

  // ── MCP connectors ───────────────────────────────────────────────
  try {
    const list = (mcpRegistry && mcpRegistry.list && mcpRegistry.list()) || [];
    const connected = list.filter((c) => c.status === "connected");
    capabilities.connectors = {
      configured: list.length > 0,
      connected: connected.length > 0,
      detail: list.length ? list.map((c) => `${c.name}:${c.status}`).join(", ") : "none registered",
      items: list.map((c) => ({ name: c.name, status: c.status, tools: (c.tools || []).map((t) => t.name || t) })),
    };
  } catch { capabilities.connectors = cap(false, false, "unknown"); }

  // ── Service connections (OAuth / token providers) ────────────────
  try {
    const all = providers.listProviders();
    let connectedIds = new Set();
    try { connectedIds = new Set(((db && db.listConnections && await db.listConnections()) || []).map((c) => c.provider)); } catch {}
    capabilities.connections = {
      configured: all.some((p) => p.configured),
      connected: connectedIds.size > 0,
      detail: connectedIds.size ? `connected: ${[...connectedIds].join(", ")}` : "no services connected",
      items: all.map((p) => ({ id: p.id, name: p.name, configured: p.configured, connected: connectedIds.has(p.id) })),
    };
  } catch { capabilities.connections = cap(false, false, "unknown"); }

  // ── Telegram ─────────────────────────────────────────────────────
  try {
    const s = (telegramBridge && telegramBridge.status && await telegramBridge.status()) || {};
    capabilities.telegram = cap(!!s.configured, s.running ? true : (s.configured ? null : false),
      s.configured ? `bot ${s.botUsername || "?"} · ${(s.allowedChats || []).length} chat(s)` : "no bot token");
  } catch { capabilities.telegram = cap(false, false, "unknown"); }

  // ── Discord / Slack outbound webhooks ────────────────────────────
  try {
    const n = config.notifications || {};
    capabilities.discord = cap(!!n.discordWebhook, !!n.discordWebhook, n.discordWebhook ? "webhook set" : "no webhook");
    capabilities.slack = cap(!!n.slackWebhook, !!n.slackWebhook, n.slackWebhook ? "webhook set" : "no webhook");
  } catch { capabilities.discord = cap(false, false, "unknown"); capabilities.slack = cap(false, false, "unknown"); }

  // ── Notifications (always available: web bell + desktop + orbit-notify) ──
  capabilities.notify = cap(true, true, "orbit-notify tool → web/desktop/channel sinks");

  // ── Enterprise SSO (OIDC) ────────────────────────────────────────
  try {
    const oidcConfigured = !!(process.env.OIDC_ISSUER_URL && process.env.OIDC_CLIENT_ID && process.env.OIDC_CLIENT_SECRET);
    const enabled = !!(config.auth && config.auth.sso && config.auth.sso.enabled);
    capabilities.sso = cap(oidcConfigured, oidcConfigured ? enabled : false,
      oidcConfigured
        ? (enabled ? `OIDC enabled · ${process.env.OIDC_ISSUER_URL}` : "OIDC configured but disabled (toggle in Admin)")
        : "no OIDC env (set OIDC_ISSUER_URL / OIDC_CLIENT_ID / OIDC_CLIENT_SECRET)");
  } catch { capabilities.sso = cap(false, false, "unknown"); }

  // ── Fleet devices ────────────────────────────────────────────────
  try {
    const devices = (db && db.listDevices && await db.listDevices()) || [];
    capabilities.fleet = {
      configured: devices.length > 0,
      connected: devices.some((d) => d.status === "online" || d.online),
      detail: devices.length ? `${devices.length} device(s)` : "no paired devices",
      items: devices.map((d) => ({ id: d.id || d.deviceId, name: d.name, status: d.status || (d.online ? "online" : "offline") })),
    };
  } catch { capabilities.fleet = cap(false, false, "unknown"); }

  return {
    generatedAt: new Date().toISOString(),
    capabilities,
  };
}

/**
 * Render a TERSE markdown block for the system prompt. One line per capability;
 * keep it short — this rides in every session's prompt budget.
 */
function renderPromptBlock(manifest) {
  const caps = (manifest && manifest.capabilities) || {};
  const lines = ["## What's configured right now",
    "Your live capabilities this session (from GET /api/capabilities). Use what's",
    "ready; if a task needs something marked unavailable, ask the user to set it up.",
    ""];
  const label = (c) => {
    if (!c) return "unknown";
    if (c.configured && c.connected) return "✅ ready";
    if (c.configured && c.connected === null) return "🟡 configured";
    if (c.configured) return "🟡 configured (not connected)";
    return "⚪ unavailable";
  };
  const order = [
    ["llm", "LLM"], ["web_search", "Web search"], ["web_browse", "Web browse"],
    ["tts", "Voice (TTS)"], ["notify", "Notifications"], ["telegram", "Telegram"],
    ["discord", "Discord"], ["slack", "Slack"], ["connectors", "MCP connectors"],
    ["connections", "Service connections"], ["fleet", "Fleet devices"],
    ["sso", "Enterprise SSO"],
  ];
  for (const [key, name] of order) {
    const c = caps[key];
    if (!c) continue;
    lines.push(`- **${name}** — ${label(c)}${c.detail ? ` · ${c.detail}` : ""}`);
  }
  return lines.join("\n");
}

module.exports = { buildCapabilities, renderPromptBlock, hasNativeSearch };
