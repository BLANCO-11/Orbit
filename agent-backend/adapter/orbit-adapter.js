#!/usr/bin/env node
// orbit-adapter — connect a local pi harness to a remote Orbit console.
//
// Run this on any machine that has `pi` installed to make it a harness the
// console can drive, exactly like the console's own local pi. It pairs with
// the console using a one-time code (from Fleet → Pair a harness), opens an
// authenticated WebSocket, and bridges a local PiCodeHarness: the console
// sends spawn/prompt/cancel, and every harness event streams back.
//
// The token is the durable credential: on first pair it is persisted to
// ~/.orbit/adapter-credentials.json (keyed by server host, chmod 600). On
// restart the adapter reconnects straight from that file — no re-pairing.
// Dropped sockets self-heal via a supervised reconnect loop with backoff.
//
// Usage:
//   # First pair (any ONE of these):
//   node orbit-adapter.js --connect 'https://HOST/api/pair/connect?code=AB3XK9'
//   node orbit-adapter.js --server wss://HOST --code AB3XK9 [--name "My workstation"]
//   node orbit-adapter.js --server wss://HOST --token <deviceToken>
//   # Reconnect after a restart (credentials already stored):
//   node orbit-adapter.js --server wss://HOST     # or with no args if only one host is stored
//
// Flags: --credentials <path>, --no-persist, and env ORBIT_ADAPTER_HOME.
//
// LiteLLM creds come from this machine's env: LITELLM_KEY (or OPENAI_API_KEY),
// LITELLM_BASE_URL, LITELLM_MODEL.

const os = require("os");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");
const EventEmitter = require("events");
const PiCodeHarness = require("../harnesses/picode");
const { discoverPiBinaries, resolveLlmEnv } = require("../env");

const DEFAULT_RECONNECT = { backoffMs: [1000, 2000, 5000, 15000], maxJitterMs: 500 };
const DEFAULT_HEARTBEAT = { intervalMs: 30000, type: "ping" };

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    // Boolean flags (no value): --no-persist, --persist.
    if (next === undefined || next.startsWith("--")) args[key] = true;
    else { args[key] = next; i++; }
  }
  return args;
}

// ── Credential persistence ──────────────────────────────────────────────
// One file, a map of { [serverHost]: { wsUrl, token, deviceId, label, scope } }.

function credentialsPath(args) {
  if (args.credentials) return args.credentials;
  const home = process.env.ORBIT_ADAPTER_HOME || path.join(os.homedir(), ".orbit");
  return path.join(home, "adapter-credentials.json");
}

function loadStore(credsPath) {
  try { return JSON.parse(fs.readFileSync(credsPath, "utf8")); } catch { return {}; }
}

function saveCredential(credsPath, wsUrl, cred) {
  const host = new URL(wsUrl).host;
  const store = loadStore(credsPath);
  store[host] = { wsUrl, ...cred };
  fs.mkdirSync(path.dirname(credsPath), { recursive: true });
  fs.writeFileSync(credsPath, JSON.stringify(store, null, 2), { mode: 0o600 });
  try { fs.chmodSync(credsPath, 0o600); } catch {}
}

function dropCredential(credsPath, wsUrl) {
  const store = loadStore(credsPath);
  try { delete store[new URL(wsUrl).host]; } catch {}
  try { fs.writeFileSync(credsPath, JSON.stringify(store, null, 2), { mode: 0o600 }); } catch {}
}

// ── Descriptor resolution ────────────────────────────────────────────────
// Turn whatever the user passed (a connect URL, a code, a bare token, or
// nothing at all) into a connection descriptor, persisting the token so the
// next start needs no code.

async function fetchDescriptor(connectUrl) {
  const res = await fetch(connectUrl);
  if (!res.ok) {
    let err = {};
    try { err = await res.json(); } catch {}
    throw new Error(err.message || `connect failed (HTTP ${res.status})`);
  }
  return res.json();
}

async function redeemCode(httpBase, code, label) {
  const res = await fetch(`${httpBase}/api/pair/redeem`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: code.toUpperCase().trim(), label }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.success) throw new Error(data.message || "pairing failed");
  return data.device;
}

function descriptorFromStored(stored) {
  return {
    protocolVersion: "1",
    wsUrl: stored.wsUrl,
    token: stored.token,
    device: { id: stored.deviceId, label: stored.label, scope: stored.scope },
    heartbeat: DEFAULT_HEARTBEAT,
    reconnect: DEFAULT_RECONNECT,
  };
}

async function resolveDescriptor(args, credsPath, name) {
  // Persist unless explicitly opted out via --no-persist or --persist false.
  const persist = args.persist !== false && args["no-persist"] !== true;

  // 1. Explicit connect URL → the server hands back the full descriptor.
  if (typeof args.connect === "string") {
    const d = await fetchDescriptor(args.connect);
    if (persist) saveCredential(credsPath, d.wsUrl, {
      token: d.token, deviceId: d.device?.id, label: d.device?.label, scope: d.device?.scope,
    });
    return d;
  }

  const server = typeof args.server === "string" ? args.server : null;

  // 2. Explicit token + server → minimal descriptor, no round-trip.
  if (typeof args.token === "string" && server) {
    const d = { protocolVersion: "1", wsUrl: `${server}/api/harness`, token: args.token, device: {}, heartbeat: DEFAULT_HEARTBEAT, reconnect: DEFAULT_RECONNECT };
    if (persist) saveCredential(credsPath, d.wsUrl, { token: args.token });
    return d;
  }

  // 3. Code + server → redeem for a token.
  if (typeof args.code === "string" && server) {
    const httpBase = server.replace(/^ws/, "http");
    const device = await redeemCode(httpBase, args.code, name);
    const d = { protocolVersion: "1", wsUrl: `${server}/api/harness`, token: device.token, device, heartbeat: DEFAULT_HEARTBEAT, reconnect: DEFAULT_RECONNECT };
    if (persist) saveCredential(credsPath, d.wsUrl, {
      token: device.token, deviceId: device.id, label: device.label, scope: device.scope,
    });
    return d;
  }

  // 4. Nothing fresh supplied → reconnect from a persisted credential.
  const store = loadStore(credsPath);
  const hosts = Object.keys(store);
  let stored = null;
  if (server) {
    try { stored = store[new URL(`${server}/api/harness`).host] || store[new URL(server).host]; } catch {}
  } else if (hosts.length === 1) {
    stored = store[hosts[0]]; // unambiguous: the only host we know
  }
  if (stored && stored.token) return descriptorFromStored(stored);

  throw new Error(
    "No credentials. Provide --connect <url>, or --server <url> with --code <code> or --token <token>." +
      (hosts.length > 1 ? ` (Stored hosts: ${hosts.join(", ")} — pass --server to pick one.)` : "")
  );
}

// ── Supervised connection ────────────────────────────────────────────────

function connectSupervised(descriptor, { name, machine, config, binaries, credsPath, persisted }) {
  const backoff = (descriptor.reconnect && descriptor.reconnect.backoffMs) || DEFAULT_RECONNECT.backoffMs;
  const maxJitter = (descriptor.reconnect && descriptor.reconnect.maxJitterMs) || DEFAULT_RECONNECT.maxJitterMs;
  const heartbeatMs = (descriptor.heartbeat && descriptor.heartbeat.intervalMs) || DEFAULT_HEARTBEAT.intervalMs;
  const url = `${descriptor.wsUrl}?token=${encodeURIComponent(descriptor.token)}`;

  let attempt = 0;
  let stopped = false;
  const harnesses = new Map(); // sessionId → PiCodeHarness

  function cleanupSessions() {
    for (const h of harnesses.values()) { try { h.disconnect(); } catch {} }
    harnesses.clear();
  }

  function scheduleReconnect() {
    if (stopped) return;
    const base = backoff[Math.min(attempt, backoff.length - 1)];
    const delay = base + Math.floor(Math.random() * maxJitter);
    attempt++;
    console.log(`[adapter] Reconnecting in ${Math.round(delay)}ms (attempt ${attempt})...`);
    setTimeout(connect, delay);
  }

  function connect() {
    if (stopped) return;
    const ws = new WebSocket(url);
    let heartbeat = null;

    ws.on("open", () => {
      attempt = 0;
      console.log(`[adapter] Connected to ${descriptor.wsUrl}. Registering as "${name}".`);
      // Report (read-only) which LLM this remote is bringing, so the console can
      // DISPLAY it in Fleet + the chat header. The app never manages or proxies
      // a remote's LLM — this is observability only.
      const llmModel = (config.litellm && config.litellm.selectedNormalModel) || "";
      let llmProvider = "";
      try { llmProvider = config.litellm && config.litellm.baseURL ? new URL(config.litellm.baseURL).host : ""; } catch {}
      ws.send(JSON.stringify({
        type: "register",
        name,
        machine,
        model: llmModel,
        provider: llmProvider,
        capabilities: ["chat", "plan", "edit", "yolo", "subagents", "tools"],
      }));
      // Heartbeat: WS ping frames keep the socket alive through nginx idle
      // timeouts and surface dead peers. The server auto-pongs at the protocol
      // level, so no server-side change is needed.
      heartbeat = setInterval(() => { try { ws.ping(); } catch {} }, heartbeatMs);
    });

    // A 401 on upgrade means the token was rejected (revoked/rotated). If it
    // came from a stored credential, drop it and exit "re-pair required" —
    // retrying with a dead token would just loop forever.
    ws.on("unexpected-response", (_req, res) => {
      if (res.statusCode === 401) {
        console.error("[adapter] Token rejected (401). Credentials are no longer valid.");
        if (persisted) {
          dropCredential(credsPath, descriptor.wsUrl);
          console.error("[adapter] Cleared stored credentials. Re-pair with a fresh code from Fleet.");
        }
        stopped = true;
        try { ws.terminate(); } catch {}
        process.exit(1);
      }
    });

    ws.on("message", async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      if (msg.type === "registered") {
        console.log(`[adapter] Registered as harness ${msg.harnessId}. Waiting for sessions.`);
        return;
      }

      if (msg.type === "spawn") {
        const sessionId = msg.sessionId;
        const events = new EventEmitter();
        const origEmit = events.emit.bind(events);
        events.emit = (event, data) => {
          try { ws.send(JSON.stringify({ type: "event", sessionId, event, data })); } catch {}
          return origEmit(event, data);
        };
        // Merge the app-computed policy matrix + webAccess into this remote's
        // config so PiCodeHarness renders the SAME live policy table + web-tool
        // excludes a local pi would (the adapter's own config has neither). The
        // capabilities manifest is passed through pre-rendered.
        const spawnConfig = {
          ...config,
          ...(msg.policyMatrix ? { policyMatrix: msg.policyMatrix } : {}),
          ...(msg.webAccess ? { webAccess: msg.webAccess } : {}),
        };
        const harness = new PiCodeHarness({
          events, config: spawnConfig, sessionId,
          mode: msg.mode, systemPromptType: msg.systemPromptType,
          skills: msg.skills || [], model: msg.model,
          excludeTools: msg.excludeTools || null, binaries,
          capabilitiesBlock: msg.capabilitiesBlock || "",
        });
        harnesses.set(sessionId, harness);
        try {
          await harness.connect();
          console.log(`[adapter] Spawned session ${sessionId} (mode=${msg.mode}).`);
        } catch (e) {
          console.error(`[adapter] Spawn failed for ${sessionId}:`, e.message);
          events.emit("error", { message: e.message });
        }
        return;
      }

      if (msg.type === "list_tools") {
        try {
          const probe = new PiCodeHarness({ events: new EventEmitter(), config, sessionId: "probe", mode: "chat", binaries });
          const tools = await probe.listTools();
          ws.send(JSON.stringify({ type: "tools_list", reqId: msg.reqId, tools }));
        } catch (e) {
          ws.send(JSON.stringify({ type: "tools_list", reqId: msg.reqId, tools: [] }));
        }
        return;
      }

      if (msg.type === "prompt") {
        const harness = harnesses.get(msg.sessionId);
        if (harness) await harness.sendPrompt(msg.message);
        return;
      }

      if (msg.type === "cancel") {
        const harness = harnesses.get(msg.sessionId);
        if (harness) await harness.cancel();
        return;
      }

      if (msg.type === "disconnect") {
        const harness = harnesses.get(msg.sessionId);
        if (harness) { await harness.disconnect(); harnesses.delete(msg.sessionId); }
        return;
      }

      // Operator disconnect from the Fleet UI: TERMINAL. Stop every agent on this
      // machine and exit — do NOT reconnect (a transient drop still reconnects).
      if (msg.type === "shutdown") {
        console.log("[adapter] Shutdown requested by operator — stopping agents and exiting.");
        cleanupSessions();
        stopped = true;
        try { ws.close(4001, "operator disconnect"); } catch {}
        process.exit(0);
        return;
      }
    });

    ws.on("close", (code) => {
      if (heartbeat) clearInterval(heartbeat);
      cleanupSessions();
      if (stopped) return;
      // Operator disconnect closes with 4001 — terminal, no reconnect (fallback
      // for when the `shutdown` message wasn't processed before the close).
      if (code === 4001) {
        console.log("[adapter] Disconnected by operator — exiting (will not reconnect).");
        stopped = true; process.exit(0);
        return;
      }
      console.log("[adapter] Disconnected from console.");
      scheduleReconnect();
    });

    ws.on("error", (err) => {
      console.error("[adapter] WebSocket error:", err.message);
      // 'close' fires after 'error' and drives the reconnect.
    });
  }

  const shutdown = () => { stopped = true; cleanupSessions(); process.exit(0); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  connect();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const name = (typeof args.name === "string" && args.name) || `${os.userInfo().username}@${os.hostname()}`;
  const machine = os.hostname();
  const credsPath = credentialsPath(args);

  // Did the descriptor come purely from stored credentials? (No fresh code /
  // token / connect URL on this invocation.) If so, a 401 clears them.
  const persisted = !args.connect && !args.token && !args.code;

  let descriptor;
  try {
    descriptor = await resolveDescriptor(args, credsPath, name);
  } catch (e) {
    console.error(`[adapter] ${e.message}`);
    process.exit(1);
  }

  console.log(`[adapter] Using ${persisted ? "stored" : "fresh"} credentials for ${descriptor.wsUrl}.`);

  // Bring-your-own-LLM: a remote harness uses THIS machine's own OpenAI-compatible
  // endpoint (the app does not proxy it). Neutral LLM_* names win, with the
  // historical LITELLM_* / OPENAI_* as fallbacks. No poisoned default — an empty
  // baseURL means "not configured here" rather than silently dialing 127.0.0.1.
  const llm = resolveLlmEnv();
  const config = {
    litellm: {
      baseURL: llm.baseURL,
      apiKey: llm.apiKey,
      selectedNormalModel: llm.model,
    },
  };
  const binaries = discoverPiBinaries();

  connectSupervised(descriptor, { name, machine, config, binaries, credsPath, persisted });
}

main().catch((err) => {
  console.error("[adapter] Fatal:", err.message);
  process.exit(1);
});
