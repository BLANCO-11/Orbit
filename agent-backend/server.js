// agent-backend/server.js
// Orbit Backend — entry point
// Modular architecture: routes, WebSocket, harness abstraction, middleware

require("dotenv").config();

const express = require("express");
const http = require("http");
const cors = require("cors");
const path = require("path");
const EventEmitter = require("events");

const { validateEnv, discoverPiBinaries, probePiBinary, resolveLlmEnv } = require("./env");
const { loadConfig, saveConfig } = require("./config");
const db = require("./db");
const { metricsManager } = require("./metrics");
const { SubagentTracker, STATUS } = require("./subagent-tracker");
const { McpRegistry } = require("./mcp-registry");
const { loadHarness } = require("./harnesses");
const { generateIntelligentSpeech } = require("./services/tts");
const { generatePlan } = require("./services/plan-generator");
const { estimateTokens } = require("./metrics");
const {
  sendLog, sendStatus, sendWithSession,
  resolveTargetPath, isPathAllowed, extractPathsFromArgs,
  isPathInZones, isPathBlocked,
} = require("./ws/session-helpers");
const workspacePaths = require("./workspace-paths");
const { isMutatingTool, isReadOnlyTool, isMultiStepTask } = require("./harnesses/picode/parser");
const policyEngine = require("./policy-engine");
const { recordObserved } = require("./tool-catalog");

// Middleware
const errorHandler = require("./middleware/error-handler");
const createAuthMiddleware = require("./middleware/auth");
const requestIdMiddleware = require("./middleware/request-id");

// Routes
const createConfigRouter = require("./routes/config");
const createSessionsRouter = require("./routes/sessions");
const { createModelsRouter, createTtsRouter, createVoicesRouter } = require("./routes/models");
const createNotificationsRouter = require("./routes/notifications");
const createNotifyBus = require("./notify-bus");
const createHealthRouter = require("./routes/health");
const createWorkspaceRouter = require("./routes/workspace");
const createDevicesRouter = require("./routes/devices");
const { createPromptsRouter } = require("./routes/prompts");
const { createSkillsRouter } = require("./routes/skills");
const createConnectorsRouter = require("./routes/connectors");
const createProfilesRouter = require("./routes/profiles");
const createConnectionsRouters = require("./routes/connections");
const createAdminRouter = require("./routes/admin");
const createAuthSsoRouter = require("./routes/auth-sso");
const { encrypt, decrypt } = require("./crypto-store");

// WebSocket
const createWebSocketServer = require("./ws/index");
const createHarnessRegistry = require("./ws/harness");
const RemoteHarness = require("./harnesses/remote");
const HeadlessSocket = require("./ws/headless-socket");
const ContainerHarness = require("./harnesses/container");
const createChannelsRouter = require("./routes/channels");
const { startScheduler } = require("./channel-scheduler");

// ── Startup Validation ──────────────────────────────────────────────
validateEnv();

// ── Shared State ────────────────────────────────────────────────────
const PORT = process.env.PORT || 6800;
// Bind host. Defaults to loopback (safe: only reachable on-box / by a co-located
// nginx). Set HOST=0.0.0.0 (or a specific interface IP) to expose the backend to
// an nginx/reverse-proxy running on a DIFFERENT host (Workstream G3). When you do
// this the port is reachable off-box, so ORBIT_API_KEY becomes mandatory and the
// port should be firewalled to the proxy host.
const HOST = process.env.HOST || "127.0.0.1";
const activeSessions = new Map();    // sessionId → { harness, ws, mode, subagentTracker }
const pendingApprovals = new Map();  // toolCallId → resolve callback
const turnGuards = new Map();         // sessionId → anti-flail counters for the active turn
const sessionPlans = new Map();       // sessionId → structured plan steps (the live Mission checklist)

const PLAN_STATUSES = new Set(["pending", "active", "done", "blocked"]);

function normalizePlanSteps(steps) {
  return (Array.isArray(steps) ? steps : []).map((s, i) => ({
    id: String(s.id || i + 1),
    text: String(s.text || "").slice(0, 240),
    status: PLAN_STATUSES.has(s.status) ? s.status : "pending",
    deps: Array.isArray(s.deps) ? s.deps.map(String) : [],
  })).filter((s) => s.text);
}

// Drop dep ids that don't exist, self-deps, and any edge that would form a cycle
// (via DFS back-edge removal) so the DAG is always renderable/acyclic.
function sanitizePlanDeps(steps) {
  const ids = new Set(steps.map((s) => s.id));
  for (const s of steps) s.deps = s.deps.filter((d) => d !== s.id && ids.has(d));
  const byId = new Map(steps.map((s) => [s.id, s]));
  const mark = new Map(); // 0/undefined unvisited, 1 in-stack, 2 done
  const visit = (id) => {
    mark.set(id, 1);
    const s = byId.get(id);
    s.deps = s.deps.filter((d) => {
      const st = mark.get(d) || 0;
      if (st === 1) return false;          // back-edge → cycle, drop it
      if (st === 0) visit(d);
      return true;
    });
    mark.set(id, 2);
  };
  for (const s of steps) if (!mark.get(s.id)) visit(s.id);
  return steps;
}

// A step is "ready" when every dependency is done (informational for the DAG).
function withReady(steps) {
  const done = new Set(steps.filter((s) => s.status === "done").map((s) => s.id));
  return steps.map((s) => ({ ...s, ready: (s.deps || []).every((d) => done.has(d)) }));
}

// Load a session's plan bucket from memory or rehydrate from the DB, handling
// both the new multi-plan shape and the legacy single-plan (planSteps) shape.
function loadPlanBucket(sessionId) {
  const cached = sessionPlans.get(sessionId);
  if (cached) return cached;
  let bucket = { activePlanId: "default", plans: {} };
  try {
    const row = db.getSession(sessionId);
    if (row && Array.isArray(row.plans) && row.plans.length) {
      for (const p of row.plans) bucket.plans[p.planId] = p;
      bucket.activePlanId = row.activePlanId || row.plans[0].planId;
    } else if (row && Array.isArray(row.planSteps) && row.planSteps.length) {
      bucket.plans.default = { planId: "default", title: "Plan", type: "task", steps: normalizePlanSteps(row.planSteps) };
    }
  } catch {}
  sessionPlans.set(sessionId, bucket);
  return bucket;
}

// Persist each plan as a workspace file so plans are real, visible artifacts
// (workspace/plans/<planId>.md), in addition to the DB copy.
function persistPlanFiles(sessionId, bucket) {
  try {
    const fsx = require("fs");
    const dirs = workspacePaths.sessionDirs(sessionId);
    const plansDir = path.join(dirs.workspace, "plans");
    fsx.mkdirSync(plansDir, { recursive: true });
    for (const p of Object.values(bucket.plans)) {
      const mdContent = serializePlanToMarkdown(p);
      fsx.writeFileSync(path.join(plansDir, `${p.planId}.md`), mdContent);
    }
  } catch (e) {
    console.error("[Plans] Failed to persist markdown plans:", e.message);
  }
}

function serializePlanToMarkdown(plan) {
  let md = `# ${plan.title || "Plan"}\n\n`;
  for (const s of plan.steps || []) {
    let marker = " ";
    if (s.status === "done") marker = "x";
    else if (s.status === "active") marker = "/";
    else if (s.status === "blocked") marker = "b";
    
    let depStr = "";
    if (s.deps && s.deps.length > 0) {
      depStr = ` (deps: ${s.deps.join(", ")})`;
    }
    md += `- [${marker}] ${s.text}${depStr}\n`;
  }
  return md;
}

function parseMarkdownPlan(content, filename = "plan.md") {
  const planId = path.basename(filename, ".md");
  const lines = content.split("\n");
  let title = planId === "plan" ? "Plan" : planId;
  const steps = [];

  let headerFound = false;
  for (let line of lines) {
    line = line.trim();
    if (!headerFound && line.startsWith("# ")) {
      title = line.substring(2).trim();
      headerFound = true;
      continue;
    }

    const match = line.match(/^[-*]\s+\[([ xX/\\bB!~-])\]\s+(.*)$/);
    if (match) {
      const marker = match[1].toLowerCase();
      const rawText = match[2].trim();

      let status = "pending";
      if (marker === "x") status = "done";
      else if (marker === "/" || marker === "-" || marker === "~") status = "active";
      else if (marker === "b" || marker === "!" || marker === "B") status = "blocked";

      let text = rawText;
      let deps = [];
      const depMatch = rawText.match(/\((?:deps|after):\s*([^)]+)\)/i);
      if (depMatch) {
        deps = depMatch[1].split(",").map(d => d.trim()).filter(Boolean);
        text = rawText.replace(/\s*\((?:deps|after):\s*[^)]+\)/i, "").trim();
      }

      steps.push({
        id: String(steps.length + 1),
        text,
        status,
        deps,
      });
    }
  }

  return {
    planId,
    title: title.slice(0, 120),
    type: "task",
    steps: sanitizePlanDeps(steps),
  };
}

function syncPlansFromWorkspace(sessionId) {
  try {
    const fsx = require("fs");
    const dirs = workspacePaths.sessionDirs(sessionId);
    const plansDir = path.join(dirs.workspace, "plans");
    if (!fsx.existsSync(plansDir)) return null;

    const files = fsx.readdirSync(plansDir);
    const mdFiles = files.filter(f => f.endsWith(".md"));
    if (mdFiles.length === 0) return null;

    const bucket = loadPlanBucket(sessionId);
    let changed = false;

    for (const file of mdFiles) {
      const filePath = path.join(plansDir, file);
      const content = fsx.readFileSync(filePath, "utf-8");
      const plan = parseMarkdownPlan(content, file);
      
      const existing = bucket.plans[plan.planId];
      if (!existing || JSON.stringify(existing) !== JSON.stringify(plan)) {
        bucket.plans[plan.planId] = plan;
        changed = true;
      }
    }

    if (changed) {
      if (!bucket.activePlanId || !bucket.plans[bucket.activePlanId]) {
        bucket.activePlanId = Object.keys(bucket.plans)[0] || "default";
      }
      
      sessionPlans.set(sessionId, bucket);
      const payload = bucketToPayload(bucket);
      
      try {
        const existing = db.getSession(sessionId);
        if (existing) {
          db.saveSession({
            ...existing,
            planSteps: payload.steps,
            plans: payload.plans,
            activePlanId: payload.activePlanId,
          });
        }
      } catch (err) {
        console.error("[DB] Failed to save session plan on workspace sync:", err.message);
      }
      
      return payload;
    }
  } catch (e) {
    console.error("[Plans] Error syncing plans from workspace:", e.message);
  }
  return null;
}

function bucketToPayload(bucket) {
  const plans = Object.values(bucket.plans).map((p) => ({ ...p, steps: withReady(p.steps) }));
  const active = bucket.plans[bucket.activePlanId] || Object.values(bucket.plans)[0] || null;
  return {
    activePlanId: active ? active.planId : bucket.activePlanId,
    plans,
    steps: active ? withReady(active.steps) : [], // back-compat: active plan's steps
  };
}



// Anti-flail limits: stop a turn that's spinning without making progress.
const MAX_TOOL_CALLS_PER_TURN = 40;        // hard runaway backstop
const MAX_CONSECUTIVE_UNPRODUCTIVE = 6;    // repeated empty/errored tool results

/** Heuristic: did a tool result fail to produce anything useful? */
function isUnproductiveResult(isError, result) {
  if (isError) return true;
  const s = (typeof result === "string" ? result : JSON.stringify(result || "")).trim();
  if (s.length < 15) return true;
  return /error executing|\(no output\)|exited with code [1-9]|bot challenge|captcha|are you a robot|429 too many|no results found|thin content|can't play this video|target closed/i.test(s);
}
const sessionAllowedPaths = new Map(); // sessionId → Set<allowedPaths>

// Read config fresh from disk each call so a saved change (policy, budgets,
// notifications) hot-reloads on the next tool call / turn without a restart.
// Previously this returned a single startup snapshot, so POST /api/config
// wrote the file but nothing in-process ever saw the new values.
loadConfig(); // fail fast at boot if the config file is missing/corrupt
const getConfig = () => {
  const config = loadConfig();
  // `llm` is the neutral config key (Workstream F1); `litellm` is the historical
  // one. Merge llm over litellm so either works, keeping `litellm` as the
  // canonical internal shape the rest of the code already reads.
  if (config.llm && typeof config.llm === "object") {
    config.litellm = { ...(config.litellm || {}), ...config.llm };
  }
  if (!config.litellm) config.litellm = {};
  // Env fallbacks: LLM_* → LITELLM_* → OPENAI_* (see env.resolveLlmEnv).
  const llmEnv = resolveLlmEnv();
  if (!config.litellm.baseURL) {
    config.litellm.baseURL = llmEnv.baseURL || "http://127.0.0.1:5000/v1";
  }
  if (!config.litellm.apiKey) {
    config.litellm.apiKey = llmEnv.apiKey || "";
  }
  if (!config.litellm.selectedNormalModel) {
    config.litellm.selectedNormalModel = llmEnv.model || "";
  }
  return config;
};
const { nodePath, piPath } = discoverPiBinaries();
probePiBinary(piPath);

// ── Express App ─────────────────────────────────────────────────────
const app = express();
app.use(cors({ origin: process.env.DASHBOARD_ORIGIN || "http://localhost:6801" }));
// Capture the raw body so webhook HMAC signatures (GitHub/Slack) can be
// verified against the exact bytes, not a re-serialized object.
app.use(express.json({ limit: "50mb", verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use("/screenshots", express.static(path.join(__dirname, "../workspace/screenshots")));
app.use(requestIdMiddleware);

// ── MCP Connector Registry ──────────────────────────────────────────
// Owns .pi/mcp.json (the servers the agent reaches) and keeps a backend-side
// client to each for live status + tool listing.
ensureOrbitMcpServersRegistered();
const mcpRegistry = new McpRegistry();
mcpRegistry.connectAll().catch(err => console.error("MCP registry connect failed:", err.message));

// ── HTTP + WebSocket Server ─────────────────────────────────────────
const server = http.createServer(app);
const harnessRegistry = createHarnessRegistry(); // remote orbit-adapter connections
const wss = createWebSocketServer(server, db, harnessRegistry);

// ── Notification bus ────────────────────────────────────────────────
// One bus, typed sinks. "web" and "desktop" are wired here (they only need the
// WS server + host shell); the "channel" sink is registered further down, once
// the Telegram bridge exists. Callers/tools choose sinks per-event.
const notifyBus = createNotifyBus();
notifyBus.registerSink("web", ({ title, body, severity, timestamp }) => {
  const msg = JSON.stringify({ type: "notification", title, body, severity, timestamp });
  wss.clients.forEach((c) => { if (c.readyState === 1) { try { c.send(msg); } catch {} } });
});
notifyBus.registerSink("desktop", ({ title, body, severity }) => {
  const { exec } = require("child_process");
  const t = String(title || "Orbit").replace(/"/g, '\\"');
  const m = String(body || "").replace(/"/g, '\\"');
  const urgency = severity === "error" ? "critical" : severity === "warning" ? "normal" : "low";
  exec(`notify-send -u ${urgency} "${t}" "${m}"`, (err) => {
    if (err) console.error("[Notify] desktop notify-send failed:", err.message);
  });
});

// ── Auth ────────────────────────────────────────────────────────────
const authMiddleware = createAuthMiddleware(db);
const authEnforced = !!createAuthMiddleware.getSuperadminKey();
if (!authEnforced) {
  console.warn("[SECURITY] ORBIT_SUPERADMIN_KEY is not set — the API and WebSocket are UNAUTHENTICATED (dev-mode: every caller is treated as superadmin).");
  console.warn("[SECURITY] Fine for local-only / single-user dev; set ORBIT_SUPERADMIN_KEY before exposing this server beyond 127.0.0.1.");
}

// Seed the local superadmin ACCOUNT used by the browser login form (username +
// password — distinct from ORBIT_SUPERADMIN_KEY, which is the bearer credential
// for programmatic API access). Only relevant when auth is enforced or a
// password is explicitly configured; skipped in pure dev-mode (no login shown).
if (authEnforced || process.env.ORBIT_SUPERADMIN_PASSWORD) {
  const saUser = process.env.ORBIT_SUPERADMIN_USERNAME || "admin";
  let saPass = process.env.ORBIT_SUPERADMIN_PASSWORD || "";
  try {
    if (!db.getUserByUsername(saUser) && !saPass) {
      // No account yet and no password configured — generate one and print it
      // once so the operator can sign in. Set ORBIT_SUPERADMIN_PASSWORD to control it.
      saPass = require("crypto").randomBytes(9).toString("base64url");
      db.ensureSuperadminAccount({ username: saUser, password: saPass });
      console.warn(`[Auth] Seeded superadmin account "${saUser}" with a GENERATED password: ${saPass}`);
      console.warn(`[Auth] Change it after login, or set ORBIT_SUPERADMIN_PASSWORD to manage it.`);
    } else {
      db.ensureSuperadminAccount({ username: saUser, password: saPass || undefined });
      console.log(`[Auth] Superadmin login account "${saUser}" ready${saPass ? " (password from env)" : ""}.`);
    }
  } catch (e) {
    console.error("[Auth] Failed to seed superadmin account:", e.message);
  }
}

// ── Mount Routes ────────────────────────────────────────────────────
app.use("/api/config", authMiddleware, createConfigRouter(activeSessions));
app.use("/api/sessions", authMiddleware, createSessionsRouter());


app.use("/api/models", authMiddleware, createModelsRouter(getConfig));
app.use("/api/tts", authMiddleware, createTtsRouter(getConfig));
app.use("/api/voices", authMiddleware, createVoicesRouter(getConfig));
app.use("/api/notify", authMiddleware, createNotificationsRouter(notifyBus));
app.use("/api/workspace", authMiddleware, createWorkspaceRouter());
app.use("/api/console", authMiddleware, require("./routes/console")());
app.use("/api/prompts", authMiddleware, createPromptsRouter());
app.use("/api/skills", authMiddleware, createSkillsRouter());
app.use("/api/connectors", authMiddleware, createConnectorsRouter(mcpRegistry));
app.use("/api/profiles", authMiddleware, createProfilesRouter(db));

// Service connections: list/token/disconnect are authed; the OAuth start +
// callback are browser-navigated (can't carry a header token) so they mount
// public and self-protect with state + PKCE.
const { connectionsRouter, oauthRouter } = createConnectionsRouters({
  db, mcpRegistry, encrypt, decrypt,
  getOrigin: () => process.env.DASHBOARD_ORIGIN || "http://localhost:6801",
});
app.use("/api/connections", authMiddleware, connectionsRouter);
app.use("/api/oauth", oauthRouter);

// Admin console (multi-tenant API keys, RBAC, observability, SSO toggle). Authed;
// each handler further gates on role (requireRole) inside the router.
const adminOrigin = () => process.env.DASHBOARD_ORIGIN || "http://localhost:6801";
app.use("/api/admin", authMiddleware, createAdminRouter(db, { getOrigin: adminOrigin }));

// Auth: SSO login/callback/logout are public (browser-navigated); /whoami is
// authed (it self-mounts authMiddleware inside the router).
app.use("/api/auth", createAuthSsoRouter({ db, getOrigin: adminOrigin, authMiddleware }));

// Channels: CRUD + test-fire are authed; the /:id/webhook receiver is public
// (external senders can't present a device token) and self-verifies per channel.
const channelOrigin = () => process.env.DASHBOARD_ORIGIN || "http://localhost:6801";
const channelsRouter = createChannelsRouter({ db, runProfileHeadless, getOrigin: channelOrigin });
app.use("/api/channels", (req, res, next) => {
  // Let the public webhook path through without auth; gate everything else.
  if (/^\/[^/]+\/webhook$/.test(req.path) && req.method === "POST") return next();
  return authMiddleware(req, res, next);
}, channelsRouter);

// Fleet: orchestrated-lead dispatch. The lead agent delegates tasks to other
// devices via the `orbit-fleet` MCP tools, which call these routes; each
// dispatch runs a headless turn on the target device's harness (handleStartTask
// is hoisted, defined below). Authed like any other API surface.
const createFleet = require("./fleet");
const createFleetRouter = require("./routes/fleet");
const fleet = createFleet({
  db, harnessRegistry, handleStartTask,
  // Lets fleet dispatch inherit a delegate's rights from the LEAD session's mode.
  getSessionMode: (sid) => activeSessions.get(sid)?.mode || db.getSession(sid)?.mode || null,
  // After a delegate finishes, credit the lead's sub-agent lane with the tool
  // calls + tokens the delegate racked up in ITS own session (else the lane
  // shows 0 even though the delegate did the work).
  creditLeadSubagent: (leadSessionId, device, delegateSessionId) => {
    const lead = activeSessions.get(leadSessionId);
    if (!lead?.subagentTracker) return;
    let toolCalls = 0, tokens = 0;
    try {
      const p = metricsManager.toPersistable(delegateSessionId) || db.getSession(delegateSessionId)?.metrics || {};
      toolCalls = p.toolCalls?.total || 0;
      tokens = (p.tokens?.reported && !p.tokens.estimated ? p.tokens.reported.total : p.tokens?.total) || 0;
    } catch {}
    lead.subagentTracker.creditDelegate(device, { toolCalls, tokens, childSessionId: delegateSessionId });
    try {
      const existing = db.getSession(leadSessionId);
      if (existing) {
        db.saveSession({
          ...existing,
          subagentTree: lead.subagentTracker.toJSON()
        });
      }
    } catch (e) {
      console.error("[Fleet] Failed to save lead session subagent tree:", e.message);
    }
    try { sendWithSession(lead.ws, { type: "subagent_metrics", ...subagentFields(lead.subagentTracker) }, leadSessionId); } catch {}
    try { sendWithSession(lead.ws, { type: "refresh_sessions" }, leadSessionId); } catch {}
  },
  notifySessionCreated: (leadSessionId, delegateSessionId, device) => {
    const lead = activeSessions.get(leadSessionId);
    if (lead) {
      if (lead.subagentTracker && device) {
        lead.subagentTracker.linkChildSession(device, delegateSessionId);
        try {
          const existing = db.getSession(leadSessionId);
          if (existing) {
            db.saveSession({
              ...existing,
              subagentTree: lead.subagentTracker.toJSON()
            });
          }
        } catch (e) {
          console.error("[Fleet] Failed to save lead session subagent tree on notify:", e.message);
        }
        try { sendWithSession(lead.ws, { type: "subagent_metrics", ...subagentFields(lead.subagentTracker) }, leadSessionId); } catch {}
      }
      if (lead.ws) {
        sendWithSession(lead.ws, { type: "refresh_sessions" }, leadSessionId);
      }
    }
  },
});
app.use("/api/fleet", authMiddleware, createFleetRouter({ fleet }));

// Telegram bridge: two-way integration over the stored "telegram" bot token.
// Inbound messages from paired chats run the agent (via the same headless
// dispatch fleet uses); outbound alerts are pushed from the notification bus.
const createTelegramBridge = require("./telegram-bridge");
const telegramBridge = createTelegramBridge({ db, decrypt, dispatch: fleet.dispatchToDevice });
app.get("/api/telegram/status", authMiddleware, (req, res) => {
  res.json({ success: true, ...telegramBridge.status() });
});

// Capability manifest — the single source of truth for "what can Orbit do right
// now?" (config + env + connectors + connections + telegram + fleet). Shared by
// the dynamic prompt injection, the list_capabilities MCP tool, and headless
// clients that want to hydrate the full app state (Workstreams D2/E/J).
const { buildCapabilities } = require("./capabilities");
const getCapabilities = () => buildCapabilities({ getConfig, mcpRegistry, telegramBridge, db });
app.get("/api/capabilities", authMiddleware, (req, res) => {
  try { res.json({ success: true, ...getCapabilities() }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// "channel" sink: everything off the web app — Telegram + Discord/Slack
// webhooks. Kept separate from the "web" bell so channel alerts and in-app
// notifications never pollute each other.
notifyBus.registerSink("channel", ({ title, body, severity }) => {
  const line = `${severity === "error" || severity === "warning" ? "⚠️ " : ""}${title}${body ? `\n${body}` : ""}`;
  try { telegramBridge.notify(line); } catch (e) { console.error("[Notify] telegram sink failed:", e.message); }
  const config = getConfig();
  const tag = `[${String(severity || "info").toUpperCase()}]`;
  if (config?.notifications?.discordWebhook) {
    fetch(config.notifications.discordWebhook, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: `**${tag} ${title}**${body ? `\n${body}` : ""}` }),
    }).catch((e) => console.error("[Notify] Discord webhook failed:", e.message));
  }
  if (config?.notifications?.slackWebhook) {
    fetch(config.notifications.slackWebhook, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `*${tag} ${title}*${body ? `\n${body}` : ""}` }),
    }).catch((e) => console.error("[Notify] Slack webhook failed:", e.message));
  }
});

// Harness registry: the always-present local pi-code plus any connected remote
// orbit-adapters. Sessions can target a specific harness by id on start_task.
app.get("/api/harnesses", authMiddleware, (req, res) => {
  const local = {
    id: "local",
    name: "pi-code",
    machine: "local",
    transport: "local",
    status: "connected",
    capabilities: ["chat", "plan", "edit", "yolo", "subagents", "tools", "browser"],
    activeSessions: [...activeSessions.values()].filter(s => !s.harnessId || s.harnessId === "local").length,
  };
  // OpenCode as a selectable local harness (a second, harness-agnostic agent).
  const opencode = {
    id: "opencode",
    name: "OpenCode",
    machine: "local",
    transport: "local",
    status: "connected",
    capabilities: ["chat", "plan", "edit", "yolo", "tools"],
    activeSessions: [...activeSessions.values()].filter(s => s.harnessId === "opencode").length,
  };
  res.json({ success: true, harnesses: [local, opencode, ...harnessRegistry.list()] });
});

// Tools a harness can offer, for the tools/extensions manager. Merges the
// harness's own tools (built-ins + extensions + observed) with the shared MCP
// connector tools (which every harness reaches). Harness-agnostic: the backend
// never special-cases a harness type — it just asks it.
app.get("/api/harnesses/:id/tools", authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    let harnessTools = [];
    const LOCAL_TYPES = { local: "picode", "pi-code": "picode", picode: "picode", opencode: "opencode" };
    if (!id || LOCAL_TYPES[id]) {
      const probe = loadHarness(LOCAL_TYPES[id] || "picode", {
        events: new EventEmitter(), config: getConfig(), sessionId: "probe",
        mode: "chat", binaries: { nodePath, piPath },
      });
      harnessTools = await probe.listTools();
    } else {
      const entry = harnessRegistry.get(id);
      if (!entry) return res.status(404).json({ success: false, error: "harness not connected" });
      const RemoteH = require("./harnesses/remote");
      const probe = new RemoteH({ events: new EventEmitter(), config: getConfig(), sessionId: "probe", registryEntry: entry });
      harnessTools = await probe.listTools();
    }
    // Shared MCP connector tools (one group per connected connector).
    const connectorTools = mcpRegistry.list().flatMap((c) =>
      (c.tools || []).map((t) => ({
        id: t.name, name: t.name, source: `connector:${c.name}`,
        description: t.description || `via ${c.name}`, enabledByDefault: true,
      }))
    );
    res.json({ success: true, tools: [...harnessTools, ...connectorTools] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});
app.use("/api/health", createHealthRouter({ db, mcpRegistry, getConfig, activeSessions }));
app.use("/api", createDevicesRouter(db, authMiddleware, () => process.env.DASHBOARD_ORIGIN || "http://localhost:6801"));

// Error handler (must be last middleware)
app.use(errorHandler);

// ── WebSocket Handler ───────────────────────────────────────────────
wss.on("connection", (ws) => {
  console.log("Dashboard client connected to WebSocket.");

  ws.on("message", async (messageStr) => {
    try {
      const data = JSON.parse(messageStr);
      
      // ── start_task ──────────────────────────────────────────
      if (data.type === "start_task") {
        let { prompt, sessionId: sid, mode, systemPromptType, skills, effort, harnessId, excludeTools, profileId, sandbox } = data;
        const sessionId = sid || "default-session";

        // Expand a profile server-side: its fields are DEFAULTS; any field the
        // client sent explicitly overrides (the composer chips are per-session
        // overrides). Also lets event channels (Phase 3) run a profile with no
        // UI. `??` so an explicit override wins but omitted fields fall back.
        if (profileId) {
          const profile = db.getProfile(profileId);
          if (profile) {
            mode = mode ?? profile.mode;
            effort = effort ?? profile.effort;
            systemPromptType = systemPromptType ?? profile.promptId;
            skills = skills ?? profile.skills;
            excludeTools = excludeTools ?? profile.toolPolicy?.excluded;
            sandbox = sandbox ?? profile.sandbox;
          }
        }

        // Device scope enforcement (scope is set at pairing time; ws.device is
        // null for the local dev / shared-secret path, which is unrestricted).
        const scope = ws.device?.scope || "full";
        if (scope === "read_only") {
          sendLog(ws, "[Scope] This device is read-only and cannot start tasks.", false, sessionId);
          sendWithSession(ws, { type: "scope_denied", scope, message: "This device is paired read-only. It can watch sessions but not start them." }, sessionId);
          sendStatus(ws, "done", sessionId);
          return;
        }
        if (scope === "chat_voice" && mode && mode !== "chat") {
          // chat+voice devices may converse but not run tools — pin to chat mode.
          sendLog(ws, `[Scope] chat+voice device: forcing chat mode (requested "${mode}").`, false, sessionId);
          mode = "chat";
        }

        // Concurrent sessions are allowed: sibling sessions on this socket are
        // NOT killed (previously they were). Explicit switches still cancel the
        // old session via cancel_session; leaving a session running lets one
        // device drive several agents at once.
        await handleStartTask(ws, prompt, sessionId, mode, systemPromptType, skills, effort, harnessId, excludeTools, sandbox);
      }
      
      // ── approval_response ───────────────────────────────────
      else if (data.type === "approval_response") {
        const resolve = pendingApprovals.get(data.toolCallId);
        if (resolve) {
          pendingApprovals.delete(data.toolCallId);
          resolve(data.approved);
        }
      }
      
      // ── edit_permission_response ────────────────────────────
      else if (data.type === "edit_permission_response") {
        const { toolCallId, decision, path: permPath, sessionId: permSid } = data;
        const sid = permSid || ws.activeSessionId;
        sendLog(ws, `[Edit Mode] Permission for "${permPath || "unknown"}": ${decision}`, false);
        
        // allow_session + allow_always both grant for the rest of this session.
        if ((decision === "allow_session" || decision === "allow_always") && permPath) {
          if (!sessionAllowedPaths.has(sid)) sessionAllowedPaths.set(sid, new Set());
          sessionAllowedPaths.get(sid).add(resolveTargetPath(permPath));
        }
        // allow_always ALSO persists the containing folder to the durable write
        // allow-list — the bridge from in-chat consent → app policy. Blocklisted
        // paths never reach here (hard-blocked earlier), so this can't loosen a
        // guardrail. Reject if the folder is under a blocked path, belt-and-braces.
        if (decision === "allow_always" && permPath) {
          try {
            const folder = require("path").dirname(resolveTargetPath(permPath));
            const cfg = loadConfig();
            cfg.fileSystem = cfg.fileSystem || {};
            const blocked = [...(cfg.fileSystem.blockedPaths || []), ...(cfg.fileSystem.writeBlockedPaths || [])];
            if (isPathBlocked(folder, blocked)) {
              sendLog(ws, `[Policy] Refused to always-allow "${folder}" — it's under a protected path.`, false);
            } else {
              const list = cfg.fileSystem.allowedWritePaths || [];
              if (!list.includes(folder)) {
                list.push(folder);
                cfg.fileSystem.allowedWritePaths = list;
                saveConfig(cfg);
                sendLog(ws, `[Policy] Always-allow: added "${folder}" to the durable write allow-list.`, false);
              }
            }
          } catch (e) { console.error("allow_always persist failed:", e.message); }
        }

        const resolve = pendingApprovals.get(toolCallId);
        if (resolve) {
          pendingApprovals.delete(toolCallId);
          resolve(decision === "allow_once" || decision === "allow_session" || decision === "allow_always");
        }
      }
      
      // ── compact ─────────────────────────────────────────────
      else if (data.type === "compact") {
        const ses = activeSessions.get(data.sessionId || ws.activeSessionId);
        if (ses?.harness?.piProcess) {
          ses.harness.piProcess.stdin.write(
            JSON.stringify({ id: `compact-${Date.now()}`, type: "compact" }) + "\n"
          );
        }
      }
      
      // ── set_auto_compaction ─────────────────────────────────
      else if (data.type === "set_auto_compaction") {
        const ses = activeSessions.get(data.sessionId || ws.activeSessionId);
        if (ses?.harness?.piProcess) {
          ses.harness.piProcess.stdin.write(
            JSON.stringify({ id: `autocompact-${Date.now()}`, type: "set_auto_compaction", enabled: data.enabled }) + "\n"
          );
        }
      }
      
      // ── subscribe ───────────────────────────────────────────
      else if (data.type === "subscribe") {
        const { sessionId } = data;
        if (sessionId) {
          ws.activeSessionId = sessionId;
          const ses = activeSessions.get(sessionId);
          if (ses) {
            // Bind the active WebSocket to this running session
            ses.ws = ws;
            // Send the current running status immediately
            const status = ses.harness?.piProcess ? (ses.status || "thinking") : "done";
            sendStatus(ws, status, sessionId);
          } else {
            sendStatus(ws, "done", sessionId);
          }
          
          // Send the current plan state immediately if it exists
          try {
            const planState = loadPlanBucket(sessionId);
            if (planState) {
              sendWithSession(ws, {
                type: "plan_state",
                steps: planState.plans.default?.steps || [],
                plans: Object.values(planState.plans),
                activePlanId: planState.activePlanId,
              }, sessionId);
            }
          } catch (e) {
            console.error("[WS] Failed to send plan state on subscribe:", e.message);
          }
        }
      }

      // ── mode_switch ─────────────────────────────────────────
      else if (data.type === "mode_switch") {
        const { sessionId, mode } = data;
        const sid = sessionId || ws.activeSessionId;
        const ses = activeSessions.get(sid);
        if (ses?.harness) {
          try { ses.harness.disconnect(); } catch {}
        }
        activeSessions.delete(sid);
        
        try {
          const existing = db.getSession(sid);
          if (existing) {
            db.saveSession({ ...existing, mode });
          }
        } catch (e) {
          console.error("[DB] Failed to update session mode on switch:", e.message);
        }

        sendLog(ws, `[Mode Switch] Session switched to "${mode || "chat"}". Next prompt will use new behavior.`, false);
      }
      
      // ── cancel ──────────────────────────────────────────────
      else if (data.type === "cancel") {
        const ses = activeSessions.get(data.sessionId || ws.activeSessionId);
        if (ses?.harness) {
          try { ses.harness.cancel(); } catch (e) { console.error("Error cancelling:", e); }
          activeSessions.delete(data.sessionId || ws.activeSessionId);
        }
      }
      
      // ── resume ──────────────────────────────────────────────
      // Continue an interrupted turn (harness died / server restarted).
      // pi restores its own conversation context via --session-id, so we just
      // respawn and re-issue the prompt that was in flight.
      else if (data.type === "resume") {
        const sid = data.sessionId;
        const session = db.getSession(sid);
        const rs = session?.runState;
        if (rs?.running && rs.activePrompt) {
          ws.activeSessionId = sid;
          sendLog(ws, `[Resume] Resuming interrupted turn for ${sid}...`, false, sid);
          const ses = activeSessions.get(sid);
          if (ses?.harness) { try { ses.harness.disconnect(); } catch {} }
          activeSessions.delete(sid);
          await handleStartTask(ws, rs.activePrompt, sid, rs.mode);
        } else {
          sendWithSession(ws, { type: "error", message: "Nothing to resume for this session." }, sid);
        }
      }

      // ── cancel_session ──────────────────────────────────────
      else if (data.type === "cancel_session") {
        const ses = activeSessions.get(data.sessionId);
        if (ses?.harness) {
          console.log(`[Session Switch] Killing agent process for session ${data.sessionId}...`);
          try { ses.harness.disconnect(); } catch {}
          activeSessions.delete(data.sessionId);
          sendLog(ws, `[Session Switch] Session ${data.sessionId} process terminated.`, false);
        }
        // A cancelled session isn't mid-run anymore — clear the resumable flag so
        // no stale "interrupted / Resume" banner lingers (Workstream D4).
        try { db.clearSessionRunning(data.sessionId); } catch {}
      }
      
      // ── mode_switch_rerun ───────────────────────────────────
      else if (data.type === "mode_switch_rerun") {
        const { sessionId, mode, prompt: rerunPrompt, systemPromptType: st, skills: rerunSkills } = data;
        const sid = sessionId || ws.activeSessionId;

        const ses = activeSessions.get(sid);
        if (ses?.harness) { try { ses.harness.disconnect(); } catch {} }
        activeSessions.delete(sid);

        try {
          const existing = db.getSession(sid);
          if (existing) {
            db.saveSession({ ...existing, mode });
          }
        } catch (e) {
          console.error("[DB] Failed to update session mode on rerun:", e.message);
        }

        if (rerunPrompt) {
          sendLog(ws, `[Mode Switch Rerun] Re-sending prompt with mode "${mode}"`, false);
          const contextPrompt = `[System Note: You suggested switching to ${mode} mode. The user approved this request, switched the session permission mode to "${mode}", and re-submitted your prompt. Please review your active workspace plan under plans/ and resume your task. Original prompt: "${rerunPrompt}"]`;
          await handleStartTask(ws, contextPrompt, sid, mode, st, rerunSkills);
        }
      }
    } catch (err) {
      console.error("WebSocket message error:", err);
      sendWithSession(ws, { type: "error", message: err.message });
    }
  });

  ws.on("close", () => {
    console.log("Dashboard client disconnected.");
    for (const [sid, ses] of activeSessions.entries()) {
      if (ses.ws === ws) {
        // Persist final metrics (no-clobber: keeps the DB copy if already released)
        persistSessionMetrics(sid, ses.subagentTracker);

        if (ses.harness) {
          try { ses.harness.disconnect(); } catch {}
        }
        // The owning dashboard socket closed and we just tore down the harness,
        // so this session isn't running — clear the resumable flag so it doesn't
        // reopen showing a stale "interrupted / Resume" banner (Workstream D4). A
        // hard server crash doesn't fire this handler, so restart-resume (which
        // relies on run_state persisting in the DB) is unaffected.
        try { db.clearSessionRunning(sid); } catch {}
        activeSessions.delete(sid);
        metricsManager.releaseSession(sid);
      }
    }
  });
});

// ── Agent Task Handler ──────────────────────────────────────────────
// Persist a session's metrics WITHOUT clobbering good DB values with a zeroed
// snapshot. `metricsManager.toPersistable()` returns empty zeros once a session's
// in-memory metrics have been released (releaseSession — 5s after a turn, or on
// ws close). Several teardown paths race: e.g. on reload the browser-close
// handler saves + releases, then the harness `close` event fires and would
// re-save zeros over the real turn-end numbers — the "metrics show 0 after
// reload" bug. Only write metrics when they're still live; otherwise keep the
// DB copy. subagentTree is written from the (non-released) tracker when given.
function persistSessionMetrics(sessionId, subagentTracker) {
  try {
    const existing = db.getSession(sessionId);
    if (!existing) return;
    const live = metricsManager.getMetrics(sessionId);
    let metrics = existing.metrics;
    if (live) {
      metrics = metricsManager.toPersistable(sessionId);
      if (subagentTracker) metrics.subagents = subagentTracker.toFrontendSummary();
    }
    db.saveSession({
      ...existing,
      metrics,
      subagentTree: subagentTracker ? subagentTracker.toJSON() : existing.subagentTree,
    });
  } catch (e) {
    console.error(`[Metrics] persist failed for ${sessionId}:`, e.message);
  }
}

async function handleStartTask(ws, userPrompt, sessionId, mode, systemPromptType, skills, effort, harnessId, excludeTools, sandbox) {
  ws.activeSessionId = sessionId;
  ws.currentPrompt = userPrompt;
  
  const activeMode = mode || "";

  // NOTE: the old keyword-based "chat mode pre-check" was removed. It guessed
  // from prompt words whether a mode change was needed and blocked the turn
  // before the agent ran — which ignored the policy matrix (e.g. a user who
  // set network:chat=allow was still told to switch modes). The policy engine
  // is now the single source of truth: each tool call is evaluated against the
  // capability × mode matrix at tool_call_start, so chat mode allows exactly
  // what the matrix permits and blocks the rest, per-tool, with a suggestion.

  sendStatus(ws, "thinking", sessionId);
  sendLog(ws, `Processing prompt: "${userPrompt}"`, true, sessionId);

  // ── Effort profile → model + planning depth ────────────────
  // fast:     normal model, no pre-planning (chat/QA/quick research)
  // balanced: normal model, config's taskMode (the default)
  // deep:     reasoning model + hybrid pre-planning (dense planner/responder)
  const litellmConfig = getConfig().litellm || {};
  const configTaskMode = litellmConfig.taskMode || "normal";
  let taskMode = configTaskMode;
  let activeModelName = litellmConfig.selectedNormalModel;
  if (effort === "deep") {
    taskMode = "hybrid";
    activeModelName = litellmConfig.selectedReasoningModel || litellmConfig.selectedNormalModel;
  } else if (effort === "fast") {
    taskMode = "normal";
  } else if (configTaskMode === "reasoning") {
    activeModelName = litellmConfig.selectedReasoningModel || litellmConfig.selectedNormalModel;
  }

  // ── Hybrid planning ───────────────────────────────────────
  const isChat = !activeMode || activeMode === "chat";

  // Hybrid pre-planning only fires for genuine MULTI-STEP work — never for
  // greetings, questions, lookups, or single-step asks (Workstream B1). The pre-
  // plan is reasoning, not "the plan": it feeds the reasoning accordion only, so
  // the Mission board (plan_state) stays the single canonical plan surface
  // (Workstream B2).
  if (taskMode === "hybrid" && !isChat && isMultiStepTask(userPrompt)) {
    sendLog(ws, "Sketching an approach...", true, sessionId);
    const plan = await generatePlan(userPrompt, getConfig);
    if (plan) {
      sendLog(ws, "Planning notes ready.", true, sessionId);
      sendWithSession(ws, { type: "reasoning_update", content: plan }, sessionId);
    }
  }

  // ── Initialize metrics ────────────────────────────────────
  // Restore prior cumulative metrics from the DB when this session has no live
  // in-memory metrics (a fresh turn after releaseSession, or after a server
  // restart) — otherwise initSession would start from zero and the next
  // turn-end save would overwrite the session's real running totals. This keeps
  // per-session observability cumulative across turns and reloads.
  if (!metricsManager.getMetrics(sessionId)) {
    try {
      const prior = db.getSession(sessionId);
      if (prior && prior.metrics && Object.keys(prior.metrics).length) {
        metricsManager.loadSession(sessionId, prior.metrics);
      }
    } catch (e) {
      console.error(`[Metrics] Could not restore prior metrics for ${sessionId}:`, e.message);
    }
  }
  metricsManager.initSession(sessionId, activeMode, activeModelName);

  // ── Budget gate ───────────────────────────────────────────────────
  // Enforce per-session cost/token caps BEFORE spending anything on this
  // turn. Caps of 0 mean unlimited. Exceeding halts the turn and tells the
  // user, rather than silently burning past the limit.
  const budgets = getConfig().budgets || {};
  const budgetState = metricsManager.checkBudget(sessionId, budgets);
  if (!budgetState.ok) {
    const parts = budgetState.exceeded.map(e =>
      e.kind === "cost"
        ? `cost $${e.value.toFixed(4)} ≥ cap $${Number(e.limit).toFixed(4)}`
        : `${Math.round(e.value).toLocaleString()} tokens ≥ cap ${Number(e.limit).toLocaleString()}`
    );
    sendLog(ws, `[Budget] Session cap reached — ${parts.join("; ")}. Turn halted.`, false, sessionId);
    sendWithSession(ws, {
      type: "budget_exceeded",
      exceeded: budgetState.exceeded,
      message: `Session budget reached (${parts.join("; ")}). Raise the cap in Policies to continue.`,
    }, sessionId);
    sendStatus(ws, "done", sessionId);
    return;
  }

  metricsManager.recordInputTokens(sessionId, userPrompt);
  metricsManager.beginTurn(sessionId, userPrompt);
  // Reset the anti-flail guard for the new turn.
  turnGuards.set(sessionId, { calls: 0, consecutiveUnproductive: 0, stopped: false, halted: false });

  // ── Initialize subagent tracker ───────────────────────────
  // Restore prior sub-agent history for this session (if any was persisted)
  // instead of always starting from an empty tree — otherwise a harness
  // restart, or even just the next prompt turn before an autosave fires,
  // silently drops all previously-tracked sub-agent activity.
  const subagentTracker = new SubagentTracker(sessionId);
  try {
    const priorSession = db.getSession(sessionId);
    if (priorSession && priorSession.subagentTree && priorSession.subagentTree.agents) {
      subagentTracker.fromJSON(priorSession.subagentTree);
    }
  } catch (e) {
    console.error(`[SubagentTracker] Error restoring history for ${sessionId}:`, e.message);
  }
  
  // Ensure session workspace dirs exist
  const dirs = workspacePaths.ensureSessionDirs(sessionId);
  try {
    const fsx = require("fs");
    const plansDir = path.join(dirs.workspace, "plans");
    fsx.mkdirSync(plansDir, { recursive: true });
    
    const mdFiles = fsx.existsSync(plansDir) ? fsx.readdirSync(plansDir).filter(f => f.endsWith(".md")) : [];
    if (mdFiles.length === 0) {
      const bucket = loadPlanBucket(sessionId);
      if (bucket && bucket.plans && Object.keys(bucket.plans).length > 0) {
        persistPlanFiles(sessionId, bucket);
        sendLog(ws, `Rehydrated ${Object.keys(bucket.plans).length} plan(s) to workspace/plans/`, false, sessionId);
      }
    } else {
      const planState = syncPlansFromWorkspace(sessionId);
      if (planState) {
        sendWithSession(ws, {
          type: "plan_state",
          steps: planState.steps,
          plans: planState.plans,
          activePlanId: planState.activePlanId,
        }, sessionId);
      }
    }
  } catch (e) {
    console.error("[Plans] Rehydration/Sync failed on task start:", e.message);
  }

  // ── Spawn or reuse harness ────────────────────────────────
  // A session may target a specific harness by id: "local" (or unset) runs the
  // local pi child process; a remote id runs on the connected orbit-adapter of
  // that id, via RemoteHarness. Both implement the same interface downstream.
  let sessionItem = activeSessions.get(sessionId);
  if (!sessionItem || !sessionItem.harness) {
    const activeSandbox = sandbox || "host";
    // Local harness types run on THIS host (a child process). Anything else is a
    // remote harness id (a paired orbit-adapter).
    const LOCAL_HARNESSES = { local: "picode", "pi-code": "picode", picode: "picode", opencode: "opencode" };
    const localHarnessType = LOCAL_HARNESSES[harnessId || "local"];
    // Sandbox 'remote' runs on a paired remote harness; an unknown (non-local)
    // harnessId does too. 'container' runs in an ephemeral Docker container.
    const wantRemote = activeSandbox === "remote" || (harnessId && !localHarnessType);
    const remoteEntry = wantRemote
      ? (harnessRegistry.get(harnessId) || harnessRegistry.list()[0] && harnessRegistry.get(harnessRegistry.list()[0].id))
      : null;
    if (wantRemote && !remoteEntry) {
      sendLog(ws, `[Sandbox] No remote harness connected for ${activeSandbox === "remote" ? "sandbox=remote" : `harness "${harnessId}"`}.`, false, sessionId);
      sendWithSession(ws, { type: "error", message: `No remote harness is connected. Pair one in Fleet, or pick host/container.` }, sessionId);
      sendStatus(ws, "error", sessionId);
      return;
    }
    if (activeSandbox === "container" && !ContainerHarness.dockerAvailable()) {
      sendLog(ws, `[Sandbox] Docker is not available; cannot run sandbox=container.`, false, sessionId);
      sendWithSession(ws, { type: "error", message: `Docker isn't available, so the container sandbox can't run. Use host or remote.` }, sessionId);
      sendStatus(ws, "error", sessionId);
      return;
    }
    sendLog(ws, `Spawning agent session for ${sessionId} (mode=${activeMode}, sandbox=${activeSandbox}, harness=${remoteEntry ? remoteEntry.id : "local"})...`, false, sessionId);

    try {
      const events = createHarnessEventEmitter(ws, sessionId, activeMode, subagentTracker);
      const commonOpts = {
        events, config: getConfig(), sessionId, mode: activeMode,
        systemPromptType, skills: skills || [], model: activeModelName,
        excludeTools: excludeTools || null,
        // Dynamic capability manifest, rendered fresh per session start and laid
        // into the system prompt so the agent knows what it can use vs what
        // needs setup — never hand-edited (Workstream D2).
        capabilitiesBlock: (() => {
          try { return require("./capabilities").renderPromptBlock(getCapabilities()); }
          catch { return ""; }
        })(),
      };
      let harness;
      if (remoteEntry) {
        harness = new RemoteHarness({ ...commonOpts, registryEntry: remoteEntry });
      } else if (activeSandbox === "container") {
        harness = new ContainerHarness({ ...commonOpts, binaries: { nodePath, piPath } });
      } else {
        harness = loadHarness(localHarnessType || "picode", { ...commonOpts, binaries: { nodePath, piPath } });
      }

      await harness.connect();
      sessionItem = { harness, ws, status: "thinking", mode: activeMode, subagentTracker, deviceId: ws.device?.id || null, harnessId: remoteEntry ? remoteEntry.id : (harnessId || "local"), sandbox: activeSandbox };
      activeSessions.set(sessionId, sessionItem);
    } catch (err) {
      console.error(`[handleStartTask] Failed to spawn harness:`, err);
      sendLog(ws, `Failed to spawn agent: ${err.message}`, false, sessionId);
      sendStatus(ws, "error", sessionId);
      return;
    }
  }
  
  sessionItem.status = "executing";
  sendStatus(ws, "executing", sessionId);
  
  // ── Metrics auto-save ─────────────────────────────────────
  const saveInterval = getConfig().metrics?.saveIntervalMs || 30000;
  const metricsAutoSave = setInterval(() => {
    const ses = activeSessions.get(sessionId);
    if (!ses) { clearInterval(metricsAutoSave); return; }
    // No-clobber persist (keeps DB copy if metrics were released); also writes
    // the rich sub-agent summary so the Trace tab rehydrates on refresh.
    persistSessionMetrics(sessionId, subagentTracker);
  }, saveInterval);
  
  sessionItem._metricsAutoSave = metricsAutoSave;

  // Mark the session as running so an interrupted turn (harness death / server
  // restart) is detectable and resumable. Cleared on agent_end / close.
  try {
    db.setSessionRunning(sessionId, { activePrompt: userPrompt, mode: activeMode });
    const existing = db.getSession(sessionId);
    if (existing) {
      db.saveSession({ ...existing, mode: activeMode });
    }
  } catch {}

  // Send the prompt
  await sessionItem.harness.sendPrompt(userPrompt);
}

// ── Headless run (event channels) ──────────────────────────────────
// Run a profile with no dashboard attached: a HeadlessSocket records the
// transcript and persists the session, so the run shows up in the session
// list and replays in the timeline. Used by event channels (routes/channels).
async function runProfileHeadless({ profileId, prompt, title, source }) {
  const sessionId = `channel-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const profile = profileId ? db.getProfile(profileId) : null;

  // Persist an initial row so the session is visible immediately.
  try {
    db.saveSession({
      id: sessionId,
      title: title || (prompt || "Channel run").slice(0, 60),
      messages: [{ role: "user", content: prompt }],
      logs: [], executionPlan: "", mode: profile?.mode || "",
      metrics: {}, subagentTree: {}, timestamp: Date.now(),
    });
  } catch (e) {
    console.error("[Headless] initial save failed:", e.message);
  }

  const socket = new HeadlessSocket(sessionId, db, {
    title: title || (prompt || "Channel run").slice(0, 60),
    source,
    notify: (n) => broadcastNotification(n),
  });
  socket.addUserMessage(prompt);

  // Expand the profile → handleStartTask fields (it doesn't take profileId).
  await handleStartTask(
    socket, prompt, sessionId,
    profile?.mode, profile?.promptId, profile?.skills || [],
    profile?.effort, "local", profile?.toolPolicy?.excluded || null
  );
  return { sessionId };
}

/**
 * Internal system events (a background/headless run finishing, an interruption)
 * go to the web dashboard + desktop only — NOT to channels. Channel alerts are
 * reserved for things the agent explicitly sends via the notify tool, so the
 * user's Telegram isn't spammed by every internal run.
 */
function broadcastNotification({ title, body, severity }) {
  notifyBus.notify({ title, body, severity, sinks: ["web", "desktop"], source: "system" });
}

// A fleet delegation shows up as a normal tool call named for the orbit-fleet
// dispatch tool (pi prefixes MCP tools, e.g. `mcp_orbit-fleet_dispatch_to_device`),
// so match on the suffix regardless of prefix spelling.
function isFleetDispatchTool(name) {
  return typeof name === "string" && /dispatch_to_device$/.test(name);
}

// The single source of sub-agent data for the UI: the rich tracker summary
// (all agents incl. completed, each with task/tools/reasoning/currentAction),
// split into the full list + the currently-active subset. Attached to every
// metrics send so the thin metricsManager view never clobbers it.
const ACTIVE_SA = new Set(["working", "spawning", "reasoning"]);
function subagentFields(tracker) {
  const all = tracker.toFrontendSummary();
  return { subagents: all, activeSubagents: all.filter((a) => ACTIVE_SA.has(a.status)) };
}

// ── Harness Event Emitter Factory ──────────────────────────────────
function createHarnessEventEmitter(ws, sessionId, mode, subagentTracker) {
  const events = new EventEmitter();
  
  events.on("text_delta", ({ delta }) => {
    metricsManager.recordOutputTokens(sessionId, delta);
    sendWithSession(ws, {
      type: "message",
      role: "assistant",
      content: delta, // accumulated text is sent via the accumulated_text event
    }, sessionId);
  });
  
  events.on("accumulated_text", ({ text }) => {
    const cleanText = text.replace(/<tts>[\s\S]*?$/gi, "").replace(/<tts>[\s\S]*?<\/tts>/gi, "").trim();
    sendWithSession(ws, { type: "message", role: "assistant", content: cleanText }, sessionId);
    
    // Extract TTS content
    const ttsMatch = text.match(/<tts>([\s\S]*?)<\/tts>/i);
    if (ttsMatch) {
      const ttsText = ttsMatch[1].trim();
      const sentences = ttsText.match(/[^.!?]+[.!?]+/g) || [ttsText];
      sentences.forEach(s => {
        const trimmed = s.trim();
        if (trimmed.length > 2) {
          sendWithSession(ws, { type: "speech_sentence", content: trimmed }, sessionId);
        }
      });
    }
  });
  
  events.on("thinking_delta", ({ delta }) => {
    metricsManager.recordReasoning(sessionId, estimateTokens(delta));
  });

  // Provider-reported usage relayed by the harness. When the usage belongs to
  // a sub-agent's own LLM calls, credit that agent's counters too; the session
  // totals always absorb it (sub-agent work is session work).
  events.on("usage", ({ input, output, reasoning, cacheRead, subagentId }) => {
    if (subagentId) {
      const agent = subagentTracker.getAgent(subagentId);
      if (agent) {
        agent.tokens.input += input || 0;
        agent.tokens.output += output || 0;
        agent.tokens.reasoning += reasoning || 0;
        agent.tokens.total = agent.tokens.input + agent.tokens.output + agent.tokens.reasoning;
      }
    }
    metricsManager.recordUsage(sessionId, { input, output, reasoning, cacheRead });
    sendWithSession(ws, {
      type: "usage_update",
      ...metricsManager.toFrontendUpdate(sessionId),
      ...subagentFields(subagentTracker),
    }, sessionId);
  });
  
  events.on("accumulated_thinking", ({ text }) => {
    // Live thinking is reasoning, not "the plan" — it feeds the reasoning
    // accordion only. The Mission board (plan_state) is the canonical plan
    // surface (Workstream B2).
    sendWithSession(ws, { type: "reasoning_update", content: text }, sessionId);
  });
  
  function saveSubagentTree(sid, tracker) {
    try {
      const existing = db.getSession(sid);
      if (existing) {
        db.saveSession({
          ...existing,
          subagentTree: tracker.toJSON()
        });
      }
    } catch (e) {
      console.error("[DB] Failed to save subagent tree:", e.message);
    }
  }

  events.on("tool_call_start", ({ id, name, arguments: args, subagentId }) => {
    // If this turn was already halted (policy block or anti-flail), ignore the
    // tool calls pi still emits before cancel() lands — otherwise every trailing
    // blocked call re-fires a "Mode Change Required" banner (the duplicate-prompt
    // bug). Only top-level calls gate the turn; sub-agent calls pass through.
    const guard = turnGuards.get(sessionId);
    if (guard && guard.halted && !subagentId) return;

    const argsStr = JSON.stringify(args || {});
    sendLog(ws, `[Tool Call] ${name} ${argsStr}`);

    // Learn tool names as they're used so the tools manager self-populates.
    recordObserved("picode", name);

    metricsManager.startToolCall(sessionId, id, name);
    metricsManager.setToolCallArgs(sessionId, id, args);

    sendWithSession(ws, { type: "tool_start", toolCallId: id, name, arguments: args }, sessionId);



    // Track subagent spawns
    if (name === "subagent") {
      const saPrompt = (args && (args.prompt || args.task)) || "Task execution";
      const saName = "Subagent (" + saPrompt.substring(0, 24) + (saPrompt.length > 24 ? "..." : "") + ")";
      const inheritedMode = mode || "chat";
      const parentId = subagentId || null;

      // Enforce sub-agent depth cap: a spawn deeper than the limit is refused
      // before the agent process is tracked or run.
      const maxDepth = getConfig().budgets?.maxSubagentDepth ?? 2;
      const depth = subagentTracker.depthOf(parentId);
      if (maxDepth > 0 && depth > maxDepth) {
        sendLog(ws, `[Budget] Blocked sub-agent spawn at depth ${depth} (cap ${maxDepth}).`, false);
        sendWithSession(ws, {
          type: "budget_exceeded",
          exceeded: [{ kind: "subagentDepth", limit: maxDepth, value: depth }],
          message: `Sub-agent depth ${depth} exceeds the cap of ${maxDepth}. Raise it in Policies to allow deeper nesting.`,
        }, sessionId);
        const ses = activeSessions.get(sessionId);
        if (ses) ses.status = "done";
        if (ses?.harness) ses.harness.cancel();
        sendStatus(ws, "done", sessionId);
        return;
      }

      subagentTracker.spawnAgent(id, saName, parentId, inheritedMode, saPrompt);
      subagentTracker.setStatus(id, STATUS.WORKING);
      metricsManager.addSubagent(sessionId, { id, name: saName, parentId, status: STATUS.WORKING, mode: inheritedMode, task: saPrompt });
      saveSubagentTree(sessionId, subagentTracker);

      sendLog(ws, `[Subagent Spawn] Mode="${inheritedMode}" inherited by subagent "${saName}".`, false);
    } else if (subagentId && subagentTracker.getAgent(subagentId)) {
      // This tool call is being made BY a subagent (nested tool use) — record it against the subagent, not the session.
      subagentTracker.startToolCall(subagentId, id, name, args);
      saveSubagentTree(sessionId, subagentTracker);
    } else if (isFleetDispatchTool(name)) {
      // The lead delegating to a device. The delegated run is its own session,
      // but surface it here as a sub-agent lane so it shows in the Mission board
      // under the lead. Completed in tool_call_end when the dispatch returns.
      const device = (args && args.device) || "device";
      const task = (args && args.task) || "";
      subagentTracker.spawnAgent(id, `⇢ ${device}`, null, mode || "chat", task);
      subagentTracker.setStatus(id, STATUS.WORKING);
      metricsManager.addSubagent(sessionId, { id, name: `⇢ ${device}`, parentId: null, status: STATUS.WORKING, mode: mode || "chat", task: task });
      saveSubagentTree(sessionId, subagentTracker);
      sendWithSession(ws, {
        type: "subagent_metrics",
        ...metricsManager.toFrontendUpdate(sessionId),
        ...subagentFields(subagentTracker),
      }, sessionId);
    }

    // ── Policy-matrix enforcement ─────────────────────────────
    // Map the tool to a capability (write in/out depends on the path), then
    // evaluate it against the configurable capability × mode matrix, tightened
    // by any per-device override. block → cancel; ask → surface a gate.
    const activeMode = mode || "chat";
    const cfg = getConfig();
    
    // Resolve all target paths relative to the session's workspace
    const sessionRoot = workspacePaths.sessionRoot(sessionId);
    const rawPaths = extractPathsFromArgs(args);
    if (args && args.path && typeof args.path === "string" && !rawPaths.includes(args.path)) {
      rawPaths.push(args.path);
    }
    const toolPaths = rawPaths.map(p => {
      if (p.startsWith("~")) return p.replace(/^~/, require("os").homedir());
      if (path.isAbsolute(p)) return p;
      return path.resolve(path.join(sessionRoot, "workspace", p));
    });

    // (1) Hard blocklist — sits BELOW the permission layer: user consent cannot
    // override it. Two tiers:
    //   • blockedPaths      — no READ and no WRITE (secrets: ~/.ssh, ~/.aws, …).
    //   • writeBlockedPaths — no WRITE, reads OK (Orbit's own source: the agent
    //     may read/explain its code but never modify it). `bash` counts as write.
    const blockedPaths = (cfg.fileSystem && cfg.fileSystem.blockedPaths) || [];
    const writeBlockedPaths = (cfg.fileSystem && cfg.fileSystem.writeBlockedPaths) || [];
    const toolWrites = isMutatingTool(name);
    let blockedHit = toolPaths.find((p) => isPathBlocked(p, blockedPaths));
    let blockKind = blockedHit ? "protected (no read/write)" : null;
    if (!blockedHit && toolWrites) {
      blockedHit = toolPaths.find((p) => isPathBlocked(p, writeBlockedPaths));
      if (blockedHit) blockKind = "write-protected";
    }
    if (blockedHit) {
      if (guard) guard.halted = true;
      sendLog(ws, `[Policy] Hard-blocked "${name}" — "${blockedHit}" is ${blockKind}.`, false);
      sendWithSession(ws, {
        type: "policy_blocked", toolName: name, capability: "blocked_path", mode: activeMode,
        suggestedMode: null,
        reason: `"${blockedHit}" is a ${blockKind} path — this is a hard guardrail that can't be overridden, even with permission.`,
      }, sessionId);
      sendWithSession(ws, {
        type: "tool_end",
        toolCallId: id,
        name,
        result: `Blocked by Policy: "${blockedHit}" is protected.`,
        latencyMs: 0
      }, sessionId);
      const ses = activeSessions.get(sessionId);
      if (ses) ses.status = "done";
      if (ses?.harness) ses.harness.cancel();
      // The turn stopped without a clean end — clear the resumable flag so no
      // stale "interrupted / Resume" banner lingers (Workstream D4).
      try { db.clearSessionRunning(sessionId); } catch {}
      sendStatus(ws, "done", sessionId);
      return;
    }

    // (2) Safe zone = THIS session's root (~/.orbit/sessions/<id>) + the durable
    // allow-list + any path the user granted this session. Writes elsewhere are
    // "outside" → require consent. Sessions are isolated: another session's root
    // is not in this zone, so cross-session writes also ask.
    const durableAllow = (cfg.fileSystem && cfg.fileSystem.allowedWritePaths) || [];
    const sessionPerms = sessionAllowedPaths.get(sessionId) || new Set();
    const safeZones = [sessionRoot, ...durableAllow];
    const outsidePaths = toolPaths.filter((p) =>
      !isPathInZones(p, safeZones) && !sessionPerms.has(resolveTargetPath(p))
    );
    const isOutside = outsidePaths.length > 0;
    const capability = policyEngine.toolToCapability(name, isOutside);
    const deviceOverrides = ws.device?.policyOverrides || null;
    
    // Auto-allow reading/writing plans in the workspace plans directory in ALL
    // modes, including chat. The behavior prompt instructs the agent to maintain
    // plan files, so blocking that write in chat made the agent's own instructed
    // behavior trigger a mode-switch halt (Workstream B3). The plans dir is
    // sandboxed and low-risk, so a plan write is never worth a mode change.
    const onlyTouchesPlans = toolPaths.length > 0 && toolPaths.every(p => {
      const plansDir = path.join(sessionRoot, "workspace", "plans");
      return p === plansDir || p.startsWith(plansDir + path.sep);
    });

    let { decision } = onlyTouchesPlans
      ? { decision: "allow" }
      : policyEngine.evaluate(capability, activeMode, cfg, deviceOverrides);

    if (decision === "block") {
      // Halt the turn so trailing blocked tool calls don't each re-fire the banner.
      // This is a SOFT block (policy matrix) — unlike a hard blocklist hit, it must
      // not tear down pi: we abort just the current turn and keep the process (and
      // its conversational context) alive for the re-run after a mode switch.
      if (guard) guard.halted = true;
      // Suggest the least-privileged mode that would allow this capability.
      const suggestion = ["plan", "edit", "yolo"].find(m =>
        policyEngine.evaluate(capability, m, getConfig(), deviceOverrides).decision !== "block"
      );
      sendLog(ws, `[Policy] Blocked "${name}" (${capability}) in ${activeMode} mode.`, false);
      sendWithSession(ws, {
        type: "policy_blocked",
        toolName: name,
        capability,
        mode: activeMode,
        suggestedMode: suggestion || null,
        reason: suggestion
          ? `"${name}" needs ${capability.replace(/_/g, " ")}, which ${activeMode} mode blocks. Switch to ${suggestion.toUpperCase()} mode.`
          : `"${name}" needs ${capability.replace(/_/g, " ")}, which is blocked in every mode by policy.`,
      }, sessionId);
      sendWithSession(ws, {
        type: "tool_end",
        toolCallId: id,
        name,
        result: suggestion
          ? `Blocked by Policy: needs ${capability.replace(/_/g, " ")}. Switch to ${suggestion.toUpperCase()} mode.`
          : `Blocked by Policy: needs ${capability.replace(/_/g, " ")}, which is blocked by policy.`,
        latencyMs: 0
      }, sessionId);
      // Keep the legacy mode_suggestion for the existing frontend banner.
      if (suggestion) {
        sendWithSession(ws, { type: "mode_suggestion", mode: suggestion, reason: `The agent needs ${suggestion.toUpperCase()} mode to use "${name}".` }, sessionId);
      }
      const ses = activeSessions.get(sessionId);
      if (ses) ses.status = "done";
      // Soft block: abort just this turn but keep pi alive (context preserved for
      // the re-run after a mode switch). Fall back to full cancel() for harnesses
      // that don't support a graceful turn-abort (remote/container).
      if (ses?.harness?.abortTurn) ses.harness.abortTurn();
      else if (ses?.harness) ses.harness.cancel();
      // Aborted turn is not a clean end — clear the resumable flag (Workstream D4).
      try { db.clearSessionRunning(sessionId); } catch {}
      sendStatus(ws, "done", sessionId);
      return;
    }

    if (decision === "ask") {
      // Surface an approval gate. outsidePaths already excludes anything granted
      // for this session, so we won't re-ask for a path the user already allowed.
      if (capability !== "write_outside" || outsidePaths.length > 0) {
        sendLog(ws, `[Policy] "${name}" (${capability}) requires approval in ${activeMode} mode.`, false);
        sendWithSession(ws, {
          type: "edit_permission_request",
          toolCallId: id,
          toolName: name,
          capability,
          paths: outsidePaths,
          outsidePaths,
          safeZone: sessionRoot,
        }, sessionId);
      }
    }
  });
  
  events.on("tool_call_end", ({ id, name, result, isError, subagentId }) => {
    sendLog(ws, `[Tool Done] Finished ${name}`);

    const resultStr = typeof result === "string" ? result : JSON.stringify(result || "");
    const latencyMs = metricsManager.endToolCall(sessionId, id, name, resultStr);

    sendWithSession(ws, { type: "tool_end", toolCallId: id, name, result, latencyMs }, sessionId);

    // Sync plans from workspace in case file tools modified any plans
    const planState = syncPlansFromWorkspace(sessionId);
    if (planState) {
      sendWithSession(ws, {
        type: "plan_state",
        steps: planState.steps,
        plans: planState.plans,
        activePlanId: planState.activePlanId,
      }, sessionId);
    }

    // ── Anti-flail guard ──────────────────────────────────────
    // Stop a turn that's spinning: too many tool calls overall, or a run of
    // empty/errored results (the "spiral across search engines" failure mode).
    // Only top-level calls count (sub-agents manage their own budget).
    if (!subagentId) {
      const g = turnGuards.get(sessionId);
      if (g && !g.stopped) {
        g.calls += 1;
        g.consecutiveUnproductive = isUnproductiveResult(isError, result)
          ? g.consecutiveUnproductive + 1
          : 0;
        const runaway = g.calls >= MAX_TOOL_CALLS_PER_TURN;
        const stuck = g.consecutiveUnproductive >= MAX_CONSECUTIVE_UNPRODUCTIVE;
        if (runaway || stuck) {
          g.stopped = true;
          g.halted = true; // also gate trailing tool_call_start emits
          const why = stuck
            ? `${g.consecutiveUnproductive} tool calls in a row returned nothing useful`
            : `this turn hit ${g.calls} tool calls`;
          sendLog(ws, `[Anti-flail] Stopping turn — ${why}.`, false, sessionId);
          const ses = activeSessions.get(sessionId);
          if (ses) ses.status = "done";
          if (ses?.harness) { try { ses.harness.cancel(); } catch {} }
          sendWithSession(ws, {
            type: "message", role: "assistant",
            content: `I stopped because ${why} — I don't seem to be making progress. Could be a blocked/unavailable source or the wrong approach. Tell me how you'd like to proceed, or refine the request.`,
          }, sessionId);
          broadcastNotification({ title: "Agent stopped (no progress)", body: why, severity: "warning" });
          sendStatus(ws, "done", sessionId);
          return;
        }
      }
    }

    // Handle nested tool calls made BY a subagent
    if (subagentId && subagentTracker.getAgent(subagentId)) {
      const subLatencyMs = subagentTracker.endToolCall(subagentId, id, resultStr);
      metricsManager.addSubagentToolCall(sessionId, subagentId, name, null, resultStr, subLatencyMs);
      saveSubagentTree(sessionId, subagentTracker);
    }

    // Fleet dispatch lane completion — the delegated device finished and its
    // answer came back as the tool result.
    if (isFleetDispatchTool(name) && subagentTracker.getAgent(id)) {
      subagentTracker.markCompleted(id, resultStr);
      metricsManager.completeSubagent(sessionId, id, resultStr);
      saveSubagentTree(sessionId, subagentTracker);
    }

    // Subagent completion
    if (name === "subagent") {
      subagentTracker.markCompleted(id, resultStr);
      metricsManager.completeSubagent(sessionId, id, resultStr);
      saveSubagentTree(sessionId, subagentTracker);

      // Aggregate subagent tokens into session totals
      const subTokens = subagentTracker.getAgent(id)?.tokens;
      if (subTokens) {
        metricsManager.aggregateSubagentTokens(sessionId, {
          input: subTokens.input || 0,
          output: subTokens.output || 0,
          reasoning: subTokens.reasoning || 0,
        });
      }
    }
    
    // Send metrics update
    sendWithSession(ws, {
      type: "subagent_metrics",
      // Spread FIRST so the tracker's full-history summary isn't clobbered by
      ...metricsManager.toFrontendUpdate(sessionId),
      ...subagentFields(subagentTracker),
    }, sessionId);
  });
  
  events.on("subagent_reasoning", ({ subagentId, delta, tokens }) => {
    subagentTracker.addReasoning(subagentId, delta, tokens);
    metricsManager.addSubagentReasoning(sessionId, subagentId, delta, tokens);
    saveSubagentTree(sessionId, subagentTracker);
    
    sendWithSession(ws, {
      type: "subagent_metrics",
      // Spread FIRST so the tracker's full-history summary isn't clobbered by
      ...metricsManager.toFrontendUpdate(sessionId),
      ...subagentFields(subagentTracker),
    }, sessionId);
  });
  
  events.on("subagent_status", ({ subagentId, status }) => {
    subagentTracker.setStatus(subagentId, status);
    const normalizedStatus = subagentTracker.getAgent(subagentId)?.status;
    metricsManager.updateSubagent(sessionId, subagentId, { status: normalizedStatus });
    saveSubagentTree(sessionId, subagentTracker);

    sendWithSession(ws, {
      type: "subagent_metrics",
      // Spread FIRST so the tracker's full-history summary isn't clobbered by
      ...metricsManager.toFrontendUpdate(sessionId),
      ...subagentFields(subagentTracker),
    }, sessionId);
  });
  
  events.on("agent_end", async ({ accumulatedText, accumulatedThinking }) => {
    sendLog(ws, "Agent prompt turn completed.");

    // Close the per-turn ledger entry and push the final numbers for this turn.
    metricsManager.endTurn(sessionId);
    sendWithSession(ws, {
      type: "usage_update",
      ...metricsManager.toFrontendUpdate(sessionId),
      ...subagentFields(subagentTracker),
    }, sessionId);

    const cleanFinalText = (accumulatedText || "")
      .replace(/<tts>[\s\S]*?<\/tts>/gi, "")
      .trim();
    
    sendWithSession(ws, { type: "message", role: "assistant", content: cleanFinalText }, sessionId);
    
    // TTS: Only generate final summary or fallback TTS if we did NOT stream any <tts> tags during generation.
    const ttsMatch = (accumulatedText || "").match(/<tts>([\s\S]*?)<\/tts>/i);
    if (!ttsMatch) {
      const ttsText = cleanFinalText;
      if (ttsText.length > 50 || ttsText.includes("`") || ttsText.includes("\n") || ttsText.includes("*")) {
        const summary = await generateIntelligentSpeech(ws.currentPrompt || "query", cleanFinalText, getConfig);
        if (summary) {
          sendWithSession(ws, { type: "intelligent_speech", content: summary }, sessionId);
        } else {
          sendWithSession(ws, { type: "intelligent_speech", content: ttsText }, sessionId);
        }
      } else if (ttsText) {
        sendWithSession(ws, { type: "intelligent_speech", content: ttsText }, sessionId);
      }
    }

    // Persist metrics to the DB at EVERY turn end, not just on ws.close /
    // harness-close / the 30s autosave. Metrics are backend-owned (the client
    // POST can't write them — see routes/sessions.js), so without this a fresh
    // session refreshed before the next autosave/close read back zero — the
    // "observability resets on refresh" bug. Metrics are live here (mid-turn),
    // so this writes the real cumulative numbers.
    persistSessionMetrics(sessionId, subagentTracker);

    // Sync plans from workspace at turn end
    const planState = syncPlansFromWorkspace(sessionId);
    if (planState) {
      sendWithSession(ws, {
        type: "plan_state",
        steps: planState.steps,
        plans: planState.plans,
        activePlanId: planState.activePlanId,
      }, sessionId);
    }

    // Turn finished cleanly — no longer resumable. Clear the DB run_state (so a
    // later reload won't resurrect the "interrupted / Resume" banner). We do NOT
    // broadcast refresh_sessions here: that triggers a full loadSessions() which
    // re-dispatches messages/metrics from the (lagging) DB snapshot and clobbers
    // the just-streamed reply. The banner is cleared optimistically on the client
    // and via this DB clear on the next natural reload (Workstream D4).
    const ses = activeSessions.get(sessionId);
    if (ses) ses.status = "done";
    try { db.clearSessionRunning(sessionId); } catch {}
    sendStatus(ws, "done", sessionId);
  });

  events.on("stderr", ({ text }) => {
    sendLog(ws, `[Pi Stderr] ${text}`, false, sessionId);
  });
  
  events.on("close", ({ code }) => {
    const ses = activeSessions.get(sessionId);
    if (ses?._metricsAutoSave) clearInterval(ses._metricsAutoSave);

    // Persist final metrics + the RICH sub-agent summary so the Trace tab
    // rehydrates fully on refresh. No-clobber: if in-memory metrics were already
    // released (e.g. the ws-close handler ran first on reload), keep the DB copy
    // instead of overwriting the real turn-end numbers with zeros.
    persistSessionMetrics(sessionId, subagentTracker);

    activeSessions.delete(sessionId);
    // NOTE: deliberately do NOT clear run_state here. A harness `close` can be a
    // genuine mid-turn crash/restart — precisely when the session IS resumable
    // and the "Resume" banner should appear. run_state is cleared only on the
    // paths that represent a real stop: clean turn-end, policy block, and
    // cancel_session (Workstream D4).
    sendStatus(ws, "done", sessionId);

    setTimeout(() => metricsManager.releaseSession(sessionId), 5000);
  });
  
  events.on("error", ({ message }) => {
    const ses = activeSessions.get(sessionId);
    if (ses) ses.status = "error";
    sendStatus(ws, "error", sessionId);
    sendLog(ws, `Fatal error: ${message}`, false, sessionId);
  });
  
  return events;
}

// ── Graceful Shutdown ───────────────────────────────────────────────
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Shutdown] Received ${signal}. Shutting down gracefully...`);
  
  // Stop accepting new connections
  server.close(() => console.log("[Shutdown] HTTP server closed."));
  
  // Kill all active sessions
  for (const [sid, ses] of activeSessions.entries()) {
    console.log(`[Shutdown] Stopping session ${sid}...`);
    persistSessionMetrics(sid, ses.subagentTracker);

    if (ses.harness) {
      try { ses.harness.disconnect(); } catch {}
    }
  }
  activeSessions.clear();
  
  // Close WebSocket connections
  wss.clients.forEach(client => client.close(1001, "Server shutting down"));
  wss.close();
  
  // Disconnect MCP
  await mcpRegistry.disconnectAll().catch(() => {});
  
  console.log("[Shutdown] Cleanup complete. Exiting.");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ── Start ───────────────────────────────────────────────────────────
// Ensure Orbit's own MCP servers are registered in .pi/mcp.json so the agent
// gets its platform tools: `orbit-fleet` (delegate-to-device) and `orbit-notify`
// (message the user / raise alerts — a network capability, so no bash needed).
// Written on boot (not committed with a hard-coded path) so command + API key +
// port always match THIS install.
function ensureOrbitMcpServersRegistered() {
  const servers = {
    // Platform tool shims — native to the backend (thin MCP wrappers over
    // notify-bus.js / fleet.js; MCP is the only way to expose a tool to pi).
    "orbit-fleet": { path: path.join(__dirname, "./mcp/fleet-mcp.js") },
    "orbit-notify": { path: path.join(__dirname, "./mcp/notify-mcp.js") },
    // External capability servers — live under the top-level mcp-servers/ folder.
    "orbit-transcript": { path: path.join(__dirname, "../mcp-servers/transcript/index.js") },
    "orbit-search": { path: path.join(__dirname, "../mcp-servers/search/index.js") },
    "lightpanda": {
      path: path.join(__dirname, "../mcp-servers/lightpanda/index.js"),
      env: { LIGHTPANDA_WS: process.env.LIGHTPANDA_WS || "ws://127.0.0.1:9222" }
    }
  };
  try {
    const fs = require("fs");
    const { MCP_CONFIG_PATH } = require("./mcp-registry");
    const cfg = fs.existsSync(MCP_CONFIG_PATH)
      ? JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, "utf-8"))
      : { settings: { toolPrefix: "mcp" }, mcpServers: {} };
    cfg.mcpServers = cfg.mcpServers || {};
    let changed = false;

    if (cfg.mcpServers["orbit-plan"]) {
      delete cfg.mcpServers["orbit-plan"];
      changed = true;
      console.log("[Orbit MCP] Removed orbit-plan from .pi/mcp.json");
    }

    for (const [id, entry] of Object.entries(servers)) {
      const desired = {
        command: "node",
        args: [entry.path],
        transport: "stdio",
        lifecycle: "eager",
        env: {
          ORBIT_API: `http://127.0.0.1:${PORT}`,
          ...(process.env.ORBIT_API_KEY ? { ORBIT_API_KEY: process.env.ORBIT_API_KEY } : {}),
          ...(entry.env || {})
        },
      };
      if (JSON.stringify(cfg.mcpServers[id]) !== JSON.stringify(desired)) {
        cfg.mcpServers[id] = desired;
        changed = true;
        console.log(`[Orbit MCP] Registered ${id} in .pi/mcp.json`);
      }
    }
    if (changed) {
      fs.mkdirSync(path.dirname(MCP_CONFIG_PATH), { recursive: true });
      fs.writeFileSync(MCP_CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n");
    }
  } catch (e) {
    console.error("[Orbit MCP] Could not register Orbit MCP servers:", e.message);
  }
}

server.listen(PORT, HOST, () => {
  const exposed = HOST !== "127.0.0.1" && HOST !== "localhost";
  console.log(`Orbit Backend Server listening on ${HOST}:${PORT}${exposed ? " (EXPOSED off-loopback)" : " (internal only)"}`);
  if (exposed && !process.env.ORBIT_API_KEY) {
    console.warn(`[SECURITY] HOST=${HOST} exposes the API/WS off-loopback but ORBIT_API_KEY is NOT set — anyone who can reach ${HOST}:${PORT} can drive the agent. Set ORBIT_API_KEY and firewall this port to the proxy host.`);
  }
  // Essential service: the Lightpanda browser is the mandatory default browser
  // for every agent. Ensure its container is up with an auto-restart policy so
  // a crash never leaves agents web-blind (falling back to code_search/nonsense).
  require("./lightpanda").ensureLightpandaRunning().catch((e) =>
    console.error("[Lightpanda] ensure failed:", e.message));
  // Start the Telegram bridge (no-ops cleanly if no bot token is set). Guard it:
  // a boot-time failure here must not take the whole server down / crash-loop.
  try { telegramBridge.start(); } catch (e) { console.error("[Telegram] start failed:", e.message); }
  // Test the LLM endpoint once at boot so capabilities.llm.connected reflects
  // reality immediately and the UI can show "connection failed" vs "not
  // configured" without waiting for the first prompt (Workstream F3).
  require("./services/llm-probe").probeLlm(getConfig)
    .then((r) => console.log(`[LLM] Boot probe: ${r.ok ? `connected (${r.models.length} models)` : `not connected (${r.error})`}.`))
    .catch(() => {});
  // Fire schedule-type channels locally (no inbound exposure needed).
  startScheduler({ db, runProfileHeadless });
  // Any session still marked running at startup was interrupted (this process
  // replaced the one that owned it). The dashboard offers to resume them.
  try {
    const interrupted = db.listInterruptedSessions();
    if (interrupted.length) {
      console.log(`[Resume] ${interrupted.length} interrupted session(s) detected — resumable from the console.`);
    }
  } catch {}
});
