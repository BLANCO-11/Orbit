// agent-backend/server.js
// Orbit Backend — entry point
// Modular architecture: routes, WebSocket, harness abstraction, middleware

require("dotenv").config();

const express = require("express");
const http = require("http");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
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
  isPathInZones, isPathBlocked, hasPathField, extractCommandPaths,
} = require("./ws/session-helpers");
const workspacePaths = require("./workspace-paths");
const { isMutatingTool, isReadOnlyTool, isMultiStepTask, classifyQuery } = require("./harnesses/picode/parser");
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
const createSecretsRouter = require("./routes/secrets");
const createTemplatesRouter = require("./routes/templates");
const createRunRouter = require("./routes/run");
const createAdminRouter = require("./routes/admin");
const createAuthSsoRouter = require("./routes/auth-sso");
const { encrypt, decrypt } = require("./crypto-store");

// WebSocket
const createWebSocketServer = require("./ws/index");
const createHarnessRegistry = require("./ws/harness");
const RemoteHarness = require("./harnesses/remote");
const HeadlessSocket = require("./ws/headless-socket");
const runContract = require("./run-contract");
const { compileTemplatePrompt, materializeScaffold } = require("./templates");
const { verifyTemplateCompliance } = require("./template-verify");
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

// ── Internal LLM gateway credential ─────────────────────────────────
// Local, app-spawned harnesses (pi/OpenCode) reach the upstream LLM only
// through the app's own /llm/v1 gateway, authenticating with this app-local
// key — the REAL upstream key never enters a child process. Generated per boot
// unless pinned via env; both are published on process.env so the picode
// harness (and the container sandbox) can thread them into the child env.
const GATEWAY_KEY = process.env.ORBIT_GATEWAY_KEY || crypto.randomBytes(24).toString("hex");
process.env.ORBIT_GATEWAY_KEY = GATEWAY_KEY;
process.env.ORBIT_GATEWAY_URL = process.env.ORBIT_GATEWAY_URL || `http://127.0.0.1:${PORT}/llm/v1`;
const activeSessions = new Map();    // sessionId → { harness, ws, mode, subagentTracker }
const pendingApprovals = new Map();  // toolCallId → resolve callback
const pendingQuestions = new Map();  // questionId → { resolve, sessionId, runId, questions } — ask_questions park/await
const activeBuilds = new Map();      // buildId → { sessionId, runId, status, block } — orbit-build handoff
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
async function loadPlanBucket(sessionId) {
  const cached = sessionPlans.get(sessionId);
  if (cached) return cached;
  let bucket = { activePlanId: "default", plans: {} };
  try {
    const row = await db.getSession(sessionId);
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

async function syncPlansFromWorkspace(sessionId) {
  try {
    const fsx = require("fs");
    const dirs = workspacePaths.sessionDirs(sessionId);
    const plansDir = path.join(dirs.workspace, "plans");
    if (!fsx.existsSync(plansDir)) return null;

    const files = fsx.readdirSync(plansDir);
    const mdFiles = files.filter(f => f.endsWith(".md"));
    if (mdFiles.length === 0) return null;

    const bucket = await loadPlanBucket(sessionId);
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
        const existing = await db.getSession(sessionId);
        if (existing) {
          await db.saveSession({
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
  // NOTE: no hardcoded baseURL default. A non-empty placeholder here (the old
  // "http://127.0.0.1:5000/v1") is truthy, so the `if (!baseURL)` guard below
  // would never fall back to the env value — that's exactly the Docker "app
  // ignores LLM_BASE_URL / dials 127.0.0.1:5000" bug. Leave it empty when
  // nothing is configured so the "no LLM configured" state stays honest and the
  // env value is actually used.
  const llmEnv = resolveLlmEnv();
  if (!config.litellm.baseURL) {
    config.litellm.baseURL = llmEnv.baseURL || "";
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

// OpenCode is an OPTIONAL second local harness. Only offer it when its binary is
// actually on PATH — otherwise selecting it just yields `spawn opencode ENOENT`.
// pi is the default; this keeps the UI honest about what can run here (item 5).
const OPENCODE_AVAILABLE = (() => {
  try {
    const fsx = require("fs");
    const dirs = (process.env.PATH || "").split(path.delimiter);
    return dirs.some((d) => { try { return fsx.existsSync(path.join(d, "opencode")); } catch { return false; } });
  } catch { return false; }
})();
if (!OPENCODE_AVAILABLE) {
  console.log("[Harness] OpenCode not found on PATH — hiding it from the harness list (pi is the default).");
}

// ── Express App ─────────────────────────────────────────────────────
const app = express();
app.use(cors({ origin: process.env.DASHBOARD_ORIGIN || "http://localhost:6801" }));
// Capture the raw body so webhook HMAC signatures (GitHub/Slack) can be
// verified against the exact bytes, not a re-serialized object.
app.use(express.json({ limit: "50mb", verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use("/screenshots", express.static(path.join(__dirname, "../workspace/screenshots")));
app.use(requestIdMiddleware);

// ── Internal LLM gateway (local agents only) ────────────────────────
// Mounted before the API auth middleware: it has its OWN app-local bearer auth
// (the gateway key), and its clients are the app's own harness children, not
// dashboard users. Per-session token metering stays on the harness `usage`
// event (real provider usage); the onUsage hook here is the seam for
// authoritative per-tenant accounting (see [[orbit-admin-rbac-sso]]).
const createLlmGateway = require("./llm-gateway");
app.use("/llm/v1", createLlmGateway({
  getConfig,
  gatewayKey: GATEWAY_KEY,
  // Paired remote harnesses reach the gateway off-box with a SCOPED per-device
  // token (never the master key). Resolve it to its device so the gateway can
  // attribute usage and enforce the device's budget; a revoked device → null.
  resolveScopedToken: async (token) => {
    const d = await db.getDeviceByLlmToken?.(token);
    return d ? { deviceId: d.id, tenantId: d.tenantId, budget: d.budget, used: d.used } : null;
  },
  onUsage: async ({ sessionId, tenantId, deviceId, model, usage }) => {
    // Tenant-level metering hook. Kept intentionally light in v1 — per-session
    // budgets are enforced on the harness usage-event path in handleStartTask.
    if (tenantId) {
      try { await db.recordTenantUsage?.(tenantId, usage); } catch {}
    }
    // Per-device running total → enforces the scoped token's budget on the next
    // request (see llm-gateway auth) and feeds per-device accounting.
    if (deviceId) {
      try { await db.recordDeviceLlmUsage?.(deviceId, (usage.input || 0) + (usage.output || 0)); } catch {}
    }
  },
}));

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
  // Runs the schema init first, then seeds the account. Fire-and-forget: it
  // completes well before a human can hit the login form, and db calls await
  // init() internally regardless.
  (async () => {
    const saUser = process.env.ORBIT_SUPERADMIN_USERNAME || "admin";
    let saPass = process.env.ORBIT_SUPERADMIN_PASSWORD || "";
    try {
      await db.init();
      if (!(await db.getUserByUsername(saUser)) && !saPass) {
        // No account yet and no password configured — generate one and print it
        // once so the operator can sign in. Set ORBIT_SUPERADMIN_PASSWORD to control it.
        saPass = require("crypto").randomBytes(9).toString("base64url");
        await db.ensureSuperadminAccount({ username: saUser, password: saPass });
        console.warn(`[Auth] Seeded superadmin account "${saUser}" with a GENERATED password: ${saPass}`);
        console.warn(`[Auth] Change it after login, or set ORBIT_SUPERADMIN_PASSWORD to manage it.`);
      } else {
        await db.ensureSuperadminAccount({ username: saUser, password: saPass || undefined });
        console.log(`[Auth] Superadmin login account "${saUser}" ready${saPass ? " (password from env)" : ""}.`);
      }
    } catch (e) {
      console.error("[Auth] Failed to seed superadmin account:", e.message);
    }
  })();
} else {
  // Ensure schema init runs at boot even when no superadmin seed is needed, so
  // migration errors surface early rather than on the first request.
  db.init().catch((e) => console.error("[DB] init failed:", e.message));
}

// ── Mount Routes ────────────────────────────────────────────────────
app.use("/api/config", authMiddleware, createConfigRouter(activeSessions));
app.use("/api/sessions", authMiddleware, createSessionsRouter());


app.use("/api/models", authMiddleware, createModelsRouter(getConfig));
app.use("/api/tts", authMiddleware, createTtsRouter(getConfig));
app.use("/api/voices", authMiddleware, createVoicesRouter(getConfig));
app.use("/api/notify", authMiddleware, createNotificationsRouter(notifyBus));
app.use("/api/workspace", authMiddleware, createWorkspaceRouter(harnessRegistry));
app.use("/api/console", authMiddleware, require("./routes/console")(harnessRegistry));
app.use("/api/prompts", authMiddleware, createPromptsRouter());
app.use("/api/skills", authMiddleware, createSkillsRouter());
app.use("/api/connectors", authMiddleware, createConnectorsRouter({ db, registry: mcpRegistry }));
app.use("/api/profiles", authMiddleware, createProfilesRouter(db));
app.use("/api/secrets", authMiddleware, createSecretsRouter({ db, encrypt }));
app.use("/api/templates", authMiddleware, createTemplatesRouter({ db }));
// Run API (Gap 1/2). startRun + cancelRun are defined below in this file; the
// router captures them by reference (they're hoisted function declarations).
app.use("/api/run", authMiddleware, createRunRouter({ db, startRun: (...a) => startRun(...a), cancelRun: (...a) => cancelRun(...a), answerRun: (...a) => answerRun(...a) }));
// ask_questions sink: the orbit-ask MCP tool POSTs here and blocks until the
// user answers (browser question_response) or the parent app answers
// (POST /api/run/:id/answer). askQuestion is a hoisted fn defined below.
app.post("/api/ask", authMiddleware, async (req, res) => {
  try {
    const result = await askQuestion({ sessionId: req.body?.sessionId, questions: req.body?.questions });
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});
// Build handoff sinks: the orbit-build MCP tools POST here. startBuild/endBuild
// are hoisted fns defined below.
app.post("/api/build/start", authMiddleware, async (req, res) => {
  try {
    const out = await startBuild({ sessionId: req.body?.sessionId, language: req.body?.language, entrypoint: req.body?.entrypoint, summary: req.body?.summary });
    res.json({ success: true, ...out });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});
app.post("/api/build/end", authMiddleware, async (req, res) => {
  try {
    const build = await endBuild({ sessionId: req.body?.sessionId, buildId: req.body?.buildId, summary: req.body?.summary, notes: req.body?.notes });
    res.json({ success: true, build });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});
// Session-scoped run version history (shares the sessions namespace; the
// sessions router's "/:id" never matches this deeper path).
app.get("/api/sessions/:id/runs", authMiddleware, async (req, res) => {
  const s = await db.getSession(req.params.id);
  if (!s) return res.status(404).json({ success: false, error: "no such session" });
  const owner = s.tenantId || null;
  const mine = (req.auth && req.auth.tenantId) || null;
  if (req.auth.role !== "superadmin" && owner !== mine) {
    return res.status(404).json({ success: false, error: "no such session" });
  }
  res.json({ success: true, runs: await db.listSessionRuns(req.params.id) });
});

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
  getSessionMode: async (sid) => activeSessions.get(sid)?.mode || (await db.getSession(sid))?.mode || null,
  // After a delegate finishes, credit the lead's sub-agent lane with the tool
  // calls + tokens the delegate racked up in ITS own session (else the lane
  // shows 0 even though the delegate did the work).
  creditLeadSubagent: async (leadSessionId, device, delegateSessionId) => {
    const lead = activeSessions.get(leadSessionId);
    if (!lead?.subagentTracker) return;
    let toolCalls = 0, tokens = 0;
    try {
      const p = metricsManager.toPersistable(delegateSessionId) || (await db.getSession(delegateSessionId))?.metrics || {};
      toolCalls = p.toolCalls?.total || 0;
      tokens = (p.tokens?.reported && !p.tokens.estimated ? p.tokens.reported.total : p.tokens?.total) || 0;
    } catch {}
    lead.subagentTracker.creditDelegate(device, { toolCalls, tokens, childSessionId: delegateSessionId });
    try {
      const existing = await db.getSession(leadSessionId);
      if (existing) {
        await db.saveSession({
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
  notifySessionCreated: async (leadSessionId, delegateSessionId, device) => {
    const lead = activeSessions.get(leadSessionId);
    if (lead) {
      if (lead.subagentTracker && device) {
        lead.subagentTracker.linkChildSession(device, delegateSessionId);
        try {
          const existing = await db.getSession(leadSessionId);
          if (existing) {
            await db.saveSession({
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
app.get("/api/telegram/status", authMiddleware, async (req, res) => {
  res.json({ success: true, ...(await telegramBridge.status()) });
});

// Capability manifest — the single source of truth for "what can Orbit do right
// now?" (config + env + connectors + connections + telegram + fleet). Shared by
// the dynamic prompt injection, the list_capabilities MCP tool, and headless
// clients that want to hydrate the full app state (Workstreams D2/E/J).
const { buildCapabilities } = require("./capabilities");
const getCapabilities = () => buildCapabilities({ getConfig, mcpRegistry, telegramBridge, db });
app.get("/api/capabilities", authMiddleware, async (req, res) => {
  try { res.json({ success: true, ...(await getCapabilities()) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// "channel" sink: everything off the web app — Telegram + Discord/Slack
// webhooks. Kept separate from the "web" bell so channel alerts and in-app
// notifications never pollute each other.
notifyBus.registerSink("channel", ({ title, body, severity }) => {
  const line = `${severity === "error" || severity === "warning" ? "⚠️ " : ""}${title}${body ? `\n${body}` : ""}`;
  try { Promise.resolve(telegramBridge.notify(line)).catch((e) => console.error("[Notify] telegram sink failed:", e.message)); } catch (e) { console.error("[Notify] telegram sink failed:", e.message); }
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
  // The local pi child's LLM is app-owned: it runs through the internal gateway,
  // so the model is whatever the app has configured. Surface it read-only, same
  // shape as remotes, so Fleet + the chat header can show it uniformly.
  const llmCfg = getConfig().litellm || {};
  const local = {
    id: "local",
    name: "pi-code",
    machine: "local",
    transport: "local",
    status: "connected",
    model: llmCfg.selectedNormalModel || "",
    provider: llmCfg.baseURL ? "orbit gateway" : "",
    capabilities: ["chat", "plan", "edit", "yolo", "subagents", "tools", "browser"],
    activeSessions: [...activeSessions.values()].filter(s => !s.harnessId || s.harnessId === "local").length,
  };
  // OpenCode as a selectable local harness (a second, harness-agnostic agent) —
  // only when its binary is present (item 5); otherwise it isn't offered.
  const opencode = OPENCODE_AVAILABLE ? {
    id: "opencode",
    name: "OpenCode",
    machine: "local",
    transport: "local",
    status: "connected",
    model: llmCfg.selectedNormalModel || "",
    provider: llmCfg.baseURL ? "orbit gateway" : "",
    capabilities: ["chat", "plan", "edit", "yolo", "tools"],
    activeSessions: [...activeSessions.values()].filter(s => s.harnessId === "opencode").length,
  } : null;
  res.json({ success: true, harnesses: [local, ...(opencode ? [opencode] : []), ...harnessRegistry.list()] });
});

// Disconnect a connected remote harness from the UI. Local harnesses (the pi
// child / OpenCode) are part of this host and can't be "disconnected" — cancel
// their sessions instead. Closes the adapter socket + drops it from the registry.
app.delete("/api/harnesses/:id", authMiddleware, (req, res) => {
  const id = req.params.id;
  if (id === "local" || id === "opencode" || id === "pi-code" || id === "picode") {
    return res.status(400).json({ success: false, error: "Local harnesses can't be disconnected; cancel their sessions instead." });
  }
  // Cancel any active sessions running on this harness first, so nothing is left
  // orphaned when the adapter socket drops.
  for (const [sid, ses] of activeSessions.entries()) {
    if (ses.harnessId === id) {
      try { ses.harness?.disconnect?.(); } catch {}
      activeSessions.delete(sid);
      try { db.clearSessionRunning(sid); } catch {}
    }
  }
  const ok = harnessRegistry.disconnect(id);
  if (!ok) return res.status(404).json({ success: false, error: "harness not connected" });
  res.json({ success: true });
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
        let { prompt, sessionId: sid, mode, systemPromptType, skills, effort, harnessId, excludeTools, profileId, sandbox, templateId } = data;
        const sessionId = sid || "default-session";

        // Expand a profile server-side: its fields are DEFAULTS; any field the
        // client sent explicitly overrides (the composer chips are per-session
        // overrides). Also lets event channels (Phase 3) run a profile with no
        // UI. `??` so an explicit override wins but omitted fields fall back.
        if (profileId) {
          const profile = await db.getProfile(profileId);
          if (profile) {
            mode = mode ?? profile.mode;
            effort = effort ?? profile.effort;
            systemPromptType = systemPromptType ?? profile.promptId;
            skills = skills ?? profile.skills;
            excludeTools = excludeTools ?? profile.toolPolicy?.excluded;
            sandbox = sandbox ?? profile.sandbox;
            templateId = templateId ?? profile.templateId;
          }
        }
        // Carry the resolved template id onto the socket so handleStartTask can
        // compile it into the prompt + materialize its scaffold at spawn.
        ws.templateId = templateId || null;

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
      
      // ── question_response (ask_questions answer from the browser) ──
      else if (data.type === "question_response") {
        const { questionId, answers } = data;
        if (questionId) resolveQuestion(questionId, answers);
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
            const planState = await loadPlanBucket(sessionId);
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
          const existing = await db.getSession(sid);
          if (existing) {
            await db.saveSession({ ...existing, mode });
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
        const session = await db.getSession(sid);
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
          const existing = await db.getSession(sid);
          if (existing) {
            await db.saveSession({ ...existing, mode });
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
// Async, but call sites treat it as fire-and-forget best-effort bookkeeping
// (never rejects — errors are swallowed here).
async function persistSessionMetrics(sessionId, subagentTracker) {
  try {
    const existing = await db.getSession(sessionId);
    if (!existing) return;
    const live = metricsManager.getMetrics(sessionId);
    let metrics = existing.metrics;
    if (live) {
      metrics = metricsManager.toPersistable(sessionId);
      if (subagentTracker) metrics.subagents = subagentTracker.toFrontendSummary();
    }
    await db.saveSession({
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
  // Nature of this query — 'conversational' | 'qa' | 'task'. Drives pre-planning
  // and, at turn end, whether/what TTS speaks. Does NOT change the permission
  // mode (the user owns that); it's an advisory signal only.
  ws.queryNature = classifyQuery(userPrompt);

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
  // Two models are configured in Settings › Models: a fast Response model and a
  // deeper Reasoning model. The composer's per-turn Effort chip is the ONLY knob
  // that decides which one runs and how much pre-planning happens — there is no
  // separate persisted "thinking mode".
  //   fast:     response model,  no pre-planning        (chat / QA / quick lookups)
  //   balanced: response model,  plans genuine multi-step work   (the default)
  //   deep:     reasoning model, plans genuine multi-step work   (dense reasoner)
  const litellmConfig = getConfig().litellm || {};
  const isReasoned = effort === "deep";
  const activeModelName = isReasoned
    ? litellmConfig.selectedReasoningModel || litellmConfig.selectedNormalModel
    : litellmConfig.selectedNormalModel;
  // Pre-plan on every lane except the pure "fast" one.
  const wantsPlan = effort !== "fast";

  // ── Hybrid planning ───────────────────────────────────────
  const isChat = !activeMode || activeMode === "chat";

  // Hybrid pre-planning only fires for genuine MULTI-STEP work — never for
  // greetings, questions, lookups, or single-step asks (Workstream B1). The pre-
  // plan is reasoning, not "the plan": it feeds the reasoning accordion only, so
  // the Mission board (plan_state) stays the single canonical plan surface
  // (Workstream B2).
  if (wantsPlan && !isChat && ws.queryNature === "task") {
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
      const prior = await db.getSession(sessionId);
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
    const priorSession = await db.getSession(sessionId);
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
      const bucket = await loadPlanBucket(sessionId);
      if (bucket && bucket.plans && Object.keys(bucket.plans).length > 0) {
        persistPlanFiles(sessionId, bucket);
        sendLog(ws, `Rehydrated ${Object.keys(bucket.plans).length} plan(s) to workspace/plans/`, false, sessionId);
      }
    } else {
      const planState = await syncPlansFromWorkspace(sessionId);
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
    // Per-request sandbox wins; otherwise the deployment default (ORBIT_DEFAULT_
    // SANDBOX = host | container | remote), else "host". Unset env → "host", so
    // existing deploys are unchanged; operators harden by setting it to
    // "container". An unavailable choice (e.g. container w/o Docker) is caught by
    // the guards just below and surfaces a clear error rather than silently
    // downgrading.
    const activeSandbox = sandbox || process.env.ORBIT_DEFAULT_SANDBOX || "host";
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

    // ── Tenant output-constraint template (optional) ──
    // Resolve the session's template (if the caller/profile named one), compile
    // it into a system-prompt fragment, and materialize its workspace scaffold
    // once into an empty workspace. Scoped to the session's tenant — the same
    // tenant the harness uses for connectors/secrets. Best-effort, never fatal.
    let templateBlock = "";
    try {
      const templateId = ws.templateId || null;
      if (templateId) {
        const sess = await db.getSession(sessionId);
        const tenantId = (sess && sess.tenantId) || (ws.auth && ws.auth.tenantId) || null;
        const template = await db.getTemplate(tenantId, templateId);
        if (template) {
          templateBlock = compileTemplatePrompt(template);
          if (template.def && template.def.scaffold) {
            const fsx = require("fs");
            const dirs = workspacePaths.ensureSessionDirs(sessionId);
            let existing = [];
            try { existing = fsx.readdirSync(dirs.workspace).filter((f) => f !== ".pi"); } catch {}
            if (!existing.length) {
              const r = materializeScaffold(dirs.workspace, template.def.scaffold);
              if (r.dirs || r.files) sendLog(ws, `[Template] scaffold '${template.id}': ${r.dirs} dir(s), ${r.files} file(s)`, false, sessionId);
            }
          }
        }
      }
    } catch (e) { console.error("[Template] resolve failed:", e.message); }

    try {
      const events = createHarnessEventEmitter(ws, sessionId, activeMode, subagentTracker);
      const commonOpts = {
        events, config: getConfig(), sessionId, mode: activeMode,
        systemPromptType, skills: skills || [], model: activeModelName,
        excludeTools: excludeTools || null, templateBlock,
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
        harness = new RemoteHarness({ ...commonOpts, registryEntry: remoteEntry, db });
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
    await db.setSessionRunning(sessionId, { activePrompt: userPrompt, mode: activeMode });
    const existing = await db.getSession(sessionId);
    if (existing) {
      await db.saveSession({ ...existing, mode: activeMode });
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
  const profile = profileId ? await db.getProfile(profileId) : null;

  // Persist an initial row so the session is visible immediately.
  try {
    await db.saveSession({
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
  socket.templateId = profile?.templateId || null;

  // Expand the profile → handleStartTask fields (it doesn't take profileId).
  await handleStartTask(
    socket, prompt, sessionId,
    profile?.mode, profile?.promptId, profile?.skills || [],
    profile?.effort, "local", profile?.toolPolicy?.excluded || null
  );
  return { sessionId };
}

// ── Run API core (Gap 1 + Gap 2 + Gap 5) ───────────────────────────
// A "run" is one versioned execution against a session's durable context. This
// wraps handleStartTask on a HeadlessSocket, records a `runs` row, arms the
// layered timeouts (idle watchdog + absolute backstop), and — off the SAME
// terminal lifecycle the transcript already hangs on (socket done/error) —
// assembles the typed result contract + snapshots the run's artifacts.
//
// Async by design: startRun returns as soon as the harness is spawned + prompt
// sent; the parent app polls GET /api/run/:id for the contract.
const activeRuns = new Map(); // runId → { sessionId, lifecycle, idleTimer, maxTimer, done }
const TERMINAL_RUN_STATUSES = new Set(["succeeded", "failed", "timeout", "error", "needs_review"]);
const DEFAULT_IDLE_MS = Number(process.env.ORBIT_RUN_IDLE_MS || 180_000);   // 3 min of silence → hang
const DEFAULT_MAX_RUN_MS = Number(process.env.ORBIT_RUN_MAX_MS || 1_200_000); // 20 min absolute backstop

function clampMs(v, dflt, min = 1000, max = 3_600_000) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return dflt;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

// Best-effort usage snapshot for the contract. Metrics are still live at
// agent_end (whenDone resolves there, before releaseSession), so this reads the
// real turn totals; falls back to the persisted session metrics if released.
async function readRunUsage(sessionId) {
  try {
    const u = metricsManager.toFrontendUpdate(sessionId);
    if (u && (u.tokens || u.cost || u.toolCalls)) {
      return { tokens: u.tokens || 0, cost: u.cost || 0, toolCalls: u.toolCalls || 0 };
    }
  } catch {}
  try {
    const s = await db.getSession(sessionId);
    const m = s && s.metrics;
    if (m) return { tokens: m.sessionTokens || m.tokens?.total || 0, cost: m.cost || 0, toolCalls: m.sessionToolCalls || m.toolCalls?.total || 0 };
  } catch {}
  return { tokens: 0, cost: 0, toolCalls: 0 };
}

async function startRun({ sessionId: reqSessionId, prompt, profileId, mode, effort, tenantId, source, sandbox, timeouts, templateId } = {}) {
  const profile = profileId ? await db.getProfile(profileId) : null;

  // Resolve session (reuse or create) + this run's version number.
  let sessionId = reqSessionId || null;
  let resolvedTenant = tenantId || null;
  let priorMessages = null;
  if (sessionId) {
    const existing = await db.getSession(sessionId);
    if (existing) {
      // Reuse the session's own tenant — a run never silently re-homes a session.
      resolvedTenant = existing.tenantId || tenantId || null;
      priorMessages = Array.isArray(existing.messages) ? existing.messages : null;
    }
  } else {
    sessionId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
  const seq = await db.nextRunSeq(sessionId);
  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const effMode = mode !== undefined ? mode : (profile?.mode || "");
  const effEffort = effort !== undefined ? effort : profile?.effort;
  // Always attach the mandatory `script-gen` skill so every run is instructed to
  // smoke-test and emit a schema-valid artifacts/RESULT.json — without it the
  // contract can only ever be needs_review (Gap 2). Profile skills merge on top.
  const effSkills = Array.from(new Set([...(profile?.skills || []), "script-gen"]));
  const effExclude = profile?.toolPolicy?.excluded || null;
  // Runs default to the CONTAINER sandbox (network-on smoke tests, Gap 5) when a
  // deployment default isn't set — an override chain keeps host/remote reachable.
  let effSandbox = sandbox || profile?.sandbox || process.env.ORBIT_RUN_SANDBOX || process.env.ORBIT_DEFAULT_SANDBOX || "container";
  // Never hard-fail a run just because Docker is absent: downgrade container →
  // host (still network-on) so the caller always gets a terminal contract.
  if (effSandbox === "container" && !ContainerHarness.dockerAvailable()) {
    console.warn("[Run] container sandbox requested but Docker unavailable — falling back to host.");
    effSandbox = "host";
  }
  const promptId = profile?.promptId;
  const effTemplateId = templateId !== undefined ? templateId : (profile?.templateId || null);

  // Persist the session row FIRST, carrying the tenant — the harness reads the
  // tenant from here at spawn for secret injection + tenant-scoped MCP (Gap 3/4).
  try {
    const existing = await db.getSession(sessionId);
    if (existing) {
      await db.saveSession({ ...existing, tenantId: resolvedTenant, mode: effMode });
    } else {
      await db.saveSession({
        id: sessionId, title: (prompt || "Run").slice(0, 60),
        messages: [{ role: "user", content: prompt }],
        logs: [], executionPlan: "", mode: effMode,
        metrics: {}, subagentTree: {}, tenantId: resolvedTenant, timestamp: Date.now(),
      });
    }
  } catch (e) { console.error("[Run] initial session save failed:", e.message); }

  await db.createRun({ runId, sessionId, seq, tenantId: resolvedTenant, status: "running", prompt, source: source || "api", mode: effMode });

  const socket = new HeadlessSocket(sessionId, db, {
    title: (prompt || "Run").slice(0, 60),
    source: source || "api",
    notify: (n) => broadcastNotification(n),
  });
  // Preserve prior transcript on a reused session; seed the new user turn.
  if (priorMessages && priorMessages.length) socket.seedMessages(priorMessages);
  socket.addUserMessage(prompt);
  socket.templateId = effTemplateId; // consumed by handleStartTask at spawn

  // ── Layered timeouts (Gap 5) ──
  const t = timeouts || {};
  const idleMs = clampMs(t.idleTimeoutMs, DEFAULT_IDLE_MS);
  const maxMs = clampMs(t.maxRunMs, DEFAULT_MAX_RUN_MS);
  const rec = { sessionId, runId, seq, lifecycle: "completed", idleTimer: null, maxTimer: null, done: false };
  activeRuns.set(runId, rec);

  const killWith = (why) => {
    if (rec.done) return;
    if (rec.lifecycle === "completed") rec.lifecycle = why; // "timeout" | "cancelled"
    const ses = activeSessions.get(sessionId);
    try { ses?.harness?.cancel?.(); } catch {}
  };
  const armIdle = () => {
    if (!idleMs) return;
    if (rec.idleSuspended) return; // parked on ask_questions — don't count the wait as a hang
    clearTimeout(rec.idleTimer);
    rec.idleTimer = setTimeout(() => killWith("timeout"), idleMs);
  };
  // Exposed so askQuestion() can pause the idle watchdog while a run legitimately
  // waits for a human answer (the absolute backstop still applies).
  rec.armIdle = armIdle;
  rec.suspendIdle = () => { rec.idleSuspended = true; clearTimeout(rec.idleTimer); };
  rec.resumeIdle = () => { rec.idleSuspended = false; armIdle(); };
  // Reset the idle watchdog on every harness→socket event; a truly hung run stops
  // emitting and dies, while a long legit run (still emitting) keeps living.
  const origSend = socket.send.bind(socket);
  socket.send = (str) => { armIdle(); return origSend(str); };
  armIdle();
  if (maxMs) rec.maxTimer = setTimeout(() => killWith("timeout"), maxMs);

  // Fire the task. handleStartTask resolves quickly (spawn + sendPrompt); the
  // terminal state arrives via the socket's status events.
  handleStartTask(
    socket, prompt, sessionId,
    effMode, promptId, effSkills, effEffort, "local", effExclude, effSandbox
  ).catch((e) => {
    console.error("[Run] handleStartTask threw:", e.message);
    rec.lifecycle = "error";
    try { socket.send(JSON.stringify({ type: "status", status: "error" })); } catch {}
  });

  // On terminal lifecycle: (optionally nudge once for a missing RESULT.json,)
  // then assemble the contract, snapshot artifacts, finalize the row.
  socket.whenDone().then(async (status) => {
    // ── Auto-finalize nudge (Gap 2 reliability) ──
    // A clean completion that DIDN'T leave a valid artifacts/RESULT.json would
    // become needs_review. Before giving up, send ONE follow-up turn asking the
    // still-live agent to smoke-test + write RESULT.json, then re-assess. The
    // idle/absolute watchdogs (not cleared yet) still bound this extra turn.
    if (rec.lifecycle === "completed" && status !== "error" && !rec.nudged) {
      let result = null;
      try { result = runContract.readResultJson(workspacePaths.sessionDirs(sessionId).artifacts); } catch {}
      const harnessAlive = !!(activeSessions.get(sessionId) && activeSessions.get(sessionId).harness);
      if (result && (!result.present || !result.valid) && harnessAlive) {
        rec.nudged = true;
        const NUDGE =
          "Before you finish: there is no valid ../artifacts/RESULT.json yet, which the run contract requires. " +
          "Run the script now as a bounded smoke test (a --dry-run or single-item fetch), capture its exit and output, " +
          "then write ../artifacts/RESULT.json EXACTLY per the script-gen skill: " +
          `{ "ok": <bool>, "summary": "...", "primaryArtifact": "<script filename>", "tests": { "ran": true, "passed": <bool>, "command": "...", "output": "...(no secret values)" } }. ` +
          "Do this now and nothing else.";
        const p2 = socket.rearm();
        armIdle(); // re-arm the idle watchdog for the nudge turn
        handleStartTask(
          socket, NUDGE, sessionId,
          effMode, promptId, effSkills, effEffort, "local", effExclude, effSandbox
        ).catch((e) => {
          console.error("[Run] nudge turn threw:", e.message);
          try { socket.send(JSON.stringify({ type: "status", status: "error" })); } catch {}
        });
        status = await p2;
      }
    }

    rec.done = true;
    clearTimeout(rec.idleTimer);
    clearTimeout(rec.maxTimer);
    // A watchdog firing during EITHER turn sets rec.lifecycle; re-read it here.
    let lifecycle = rec.lifecycle;
    if (lifecycle === "completed" && status === "error") lifecycle = "error";
    try {
      const usage = await readRunUsage(sessionId);
      const errText =
        lifecycle === "timeout" ? "run exceeded its time limit (idle/backstop)"
        : lifecycle === "cancelled" ? "run cancelled by caller"
        : lifecycle === "error" ? "the agent turn ended in error (see logs)"
        : null;
      const contract = runContract.assembleContract({
        runId, sessionId, seq, lifecycle,
        finalMessage: socket.getResult(), usage, error: errText,
      });
      // Tenant-template compliance (audit-only — surfaced, never flips status).
      try {
        if (effTemplateId) {
          const template = await db.getTemplate(resolvedTenant, effTemplateId);
          const compliance = verifyTemplateCompliance(sessionId, template);
          if (compliance) contract.templateCompliance = compliance;
        }
      } catch (e) { console.error("[Template] verify failed:", e.message); }
      // Build handoff verdict (from end_build), if the agent ran one this run.
      if (rec.build) {
        contract.build = rec.build;
        // A definitive tester failure flips the run to failed (never a false pass).
        if (rec.build.status === "failed" && contract.status === "succeeded") {
          contract.status = "failed";
          contract.ok = false;
        }
      }
      runContract.snapshotArtifacts(sessionId, runId);
      await db.updateRun(runId, { status: contract.status, contract, endedAt: Date.now() });
    } catch (e) {
      console.error("[Run] contract assembly failed:", e.message);
      try {
        await db.updateRun(runId, {
          status: "error", endedAt: Date.now(),
          contract: { runId, sessionId, seq, status: "error", ok: false, summary: "contract assembly failed", error: e.message, artifacts: [], tests: { ran: false, passed: false } },
        });
      } catch {}
    } finally {
      activeRuns.delete(runId);
    }
  });

  return { runId, sessionId, seq, status: "running" };
}

// Cancel an in-flight run. Marks lifecycle "cancelled" and signals the harness;
// the terminal handler above then finalizes the contract. Returns false if the
// run isn't active (already finished / unknown).
function cancelRun(runId) {
  const rec = activeRuns.get(runId);
  if (!rec || rec.done) return false;
  if (rec.lifecycle === "completed") rec.lifecycle = "cancelled";
  const ses = activeSessions.get(rec.sessionId);
  try { ses?.harness?.cancel?.(); } catch {}
  return true;
}

// ── ask_questions (baked-in HITL clarification) ─────────────────────
// The orbit-ask MCP tool POSTs /api/ask and BLOCKS; we park a promise and
// resolve it from EITHER a browser `question_response` (interactive) OR a
// headless POST /api/run/:id/answer (parent app). Bounded so a turn never hangs.
const ASK_TIMEOUT_MS = Number(process.env.ORBIT_ASK_TIMEOUT_MS || 600_000); // 10 min

function normalizeQuestions(input) {
  const arr = Array.isArray(input) ? input : [];
  return arr.slice(0, 4).map((q, i) => {
    const rawKind = q && q.kind;
    const options = Array.isArray(q && q.options)
      ? q.options.slice(0, 8).map((o) => (typeof o === "string"
          ? { label: o.slice(0, 200) }
          : { label: String((o && o.label) || "").slice(0, 200), description: o && o.description ? String(o.description).slice(0, 500) : undefined }))
        .filter((o) => o.label)
      : [];
    let kind = ["text", "single", "multi"].includes(rawKind) ? rawKind : (options.length ? "single" : "text");
    if (kind === "text" && options.length) kind = "single";
    return {
      id: String((q && q.id) || `q${i + 1}`),
      question: String((q && q.question) || "").slice(0, 2000),
      header: q && q.header ? String(q.header).slice(0, 40) : undefined,
      kind, options,
    };
  }).filter((q) => q.question);
}

function findRunBySession(sessionId) {
  for (const rec of activeRuns.values()) {
    if (rec.sessionId === sessionId && !rec.done) return rec;
  }
  return null;
}

function finishAsk(rec) {
  if (!rec) return;
  rec.awaitingQuestionId = null;
  rec.resumeIdle?.();
  // Flip the run row back to running (cleared contract → GET synthesizes "running").
  db.updateRun(rec.runId, { status: "running", contract: {} }).catch(() => {});
}

async function askQuestion({ sessionId, questions }) {
  const qs = normalizeQuestions(questions);
  if (!sessionId || !qs.length) throw new Error("sessionId and at least one question are required");
  const questionId = `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Route to any live browser client watching this session (interactive path).
  try {
    const payload = JSON.stringify({ type: "question_request", sessionId, questionId, questions: qs });
    wss.clients.forEach((c) => {
      if (c.readyState === 1 && c.activeSessionId === sessionId) { try { c.send(payload); } catch {} }
    });
  } catch {}

  // If this session is an active RUN, mark it awaiting_input for pollers and
  // suspend its idle watchdog (a human may take a while; the backstop still holds).
  const rec = findRunBySession(sessionId);
  if (rec) {
    rec.suspendIdle?.();
    rec.awaitingQuestionId = questionId;
    try {
      await db.updateRun(rec.runId, {
        status: "awaiting_input",
        contract: {
          runId: rec.runId, sessionId, seq: rec.seq, status: "awaiting_input", ok: false,
          summary: "awaiting caller input", pendingQuestions: qs, questionId,
          artifacts: [], tests: { ran: false, passed: false },
        },
      });
    } catch (e) { console.error("[ask] run status update failed:", e.message); }
  }

  return await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (pendingQuestions.delete(questionId)) {
        finishAsk(rec);
        resolve({ answered: false, note: "No answer was provided within the time limit; proceed with your best assumption.", answers: {} });
      }
    }, ASK_TIMEOUT_MS);
    pendingQuestions.set(questionId, {
      resolve: (answers) => { clearTimeout(timer); finishAsk(rec); resolve({ answered: true, answers: answers || {} }); },
      sessionId, runId: rec ? rec.runId : null, questions: qs,
    });
  });
}

// Resolve a parked question by id (browser question_response OR headless answer).
function resolveQuestion(questionId, answers) {
  const p = pendingQuestions.get(questionId);
  if (!p) return false;
  pendingQuestions.delete(questionId);
  try { p.resolve(answers || {}); } catch {}
  return true;
}

// Answer a run's pending question (headless parent-app path).
function answerRun(runId, { questionId, answers } = {}) {
  const rec = activeRuns.get(runId);
  const qid = questionId || (rec && rec.awaitingQuestionId);
  if (!qid) return false;
  const p = pendingQuestions.get(qid);
  if (!p) return false;
  if (runId && p.runId && p.runId !== runId) return false;
  return resolveQuestion(qid, answers);
}

// ── orbit-build (build handoff notifiers → external test facility) ──
// start_build / end_build are lifecycle notifiers the agent calls once a script
// is written, to hand it off to the EXTERNAL build+test facility (a separate
// service, out of Orbit's scope). start_build marks the boundary + emits an
// event; end_build submits the artifacts to the tester and merges the returned
// verdict into the run contract.
//
// NOTE: the external tester HTTP client is a STUB here — the facility is built
// and owned separately (see plans/external-testing-facility.md). When
// ORBIT_TESTER_URL is unset, end_build returns a `skipped` verdict rather than
// failing, so the handoff is inert until the facility is wired.
const TESTER_URL = process.env.ORBIT_TESTER_URL || "";

// Emit a build lifecycle event to the session's live browser clients + the
// in-app notification bell (so parent-app progress UIs and the console see it).
function emitBuildState(sessionId, build) {
  try {
    const payload = JSON.stringify({ type: "build_state", sessionId, build });
    wss.clients.forEach((c) => {
      if (c.readyState === 1 && c.activeSessionId === sessionId) { try { c.send(payload); } catch {} }
    });
  } catch {}
}

async function startBuild({ sessionId, language, entrypoint, summary }) {
  if (!sessionId) throw new Error("no session context");
  const buildId = `bld_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const rec = findRunBySession(sessionId);
  const build = {
    buildId, status: "building", language: language || "", entrypoint: entrypoint || "",
    summary: summary || "", submitted: false, startedAt: Date.now(),
  };
  activeBuilds.set(buildId, { sessionId, runId: rec ? rec.runId : null, status: "building", block: build });
  emitBuildState(sessionId, build);
  return { buildId };
}

// Submit the session's artifacts to the external tester (stubbed) and return a
// `build` verdict block. Also stashes it on the run rec so run finalization
// merges it into the contract.
async function endBuild({ sessionId, buildId, summary, notes }) {
  if (!sessionId) throw new Error("no session context");
  const entry = buildId ? activeBuilds.get(buildId) : null;
  const rec = findRunBySession(sessionId);
  const bId = buildId || (entry && entry.block.buildId) || `bld_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Collect an artifact manifest for the handoff (best-effort).
  let artifacts = [];
  try { artifacts = runContract.listArtifacts(workspacePaths.sessionDirs(sessionId).artifacts).map((a) => a.path); } catch {}

  let block;
  if (!TESTER_URL) {
    // Facility not wired — inert, non-failing handoff.
    block = {
      buildId: bId, submitted: false, status: "skipped",
      summary: summary || "external test facility not configured (ORBIT_TESTER_URL unset)",
      artifacts,
    };
  } else {
    // Real submission (bounded). The verdict schema is owned by the external
    // facility; we merge it under `tester`.
    emitBuildState(sessionId, { buildId: bId, status: "submitting" });
    try {
      const headers = { "Content-Type": "application/json" };
      if (process.env.ORBIT_TESTER_KEY) headers["Authorization"] = `Bearer ${process.env.ORBIT_TESTER_KEY}`;
      const resp = await fetch(`${TESTER_URL.replace(/\/$/, "")}/grade`, {
        method: "POST", headers,
        body: JSON.stringify({ submissionId: bId, sessionId, notes: notes || "", artifacts }),
      });
      const verdict = await resp.json().catch(() => ({}));
      block = {
        buildId: bId, submitted: true,
        status: verdict.status === "passed" ? "passed" : (verdict.status === "failed" ? "failed" : "error"),
        summary: summary || verdict.summary || "", tester: verdict, artifacts,
      };
    } catch (e) {
      block = { buildId: bId, submitted: true, status: "error", summary: `tester submit failed: ${e.message}`, artifacts };
    }
  }

  activeBuilds.set(bId, { sessionId, runId: rec ? rec.runId : null, status: block.status, block });
  if (rec) rec.build = block; // merged into the contract at finalization
  emitBuildState(sessionId, block);
  return block;
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
  
  // Async, but call sites treat it as fire-and-forget best-effort bookkeeping
  // (never rejects — errors are swallowed here).
  async function saveSubagentTree(sid, tracker) {
    try {
      const existing = await db.getSession(sid);
      if (existing) {
        await db.saveSession({
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
    const resolveToolPath = (p) => {
      if (p.startsWith("~")) return p.replace(/^~/, require("os").homedir());
      if (path.isAbsolute(p)) return p;
      return path.resolve(path.join(sessionRoot, "workspace", p));
    };
    const rawPaths = extractPathsFromArgs(args);
    if (args && args.path && typeof args.path === "string" && !rawPaths.includes(args.path)) {
      rawPaths.push(args.path);
    }
    const toolPaths = rawPaths.map(resolveToolPath);

    // Shell command path tokens (Tier 2 tokenization). Kept SEPARATE from
    // toolPaths and consulted ONLY by the hard blocklist below — never by the
    // zone/capability logic — so a tokenized path can hard-block a protected
    // target but can never soft-gate an otherwise-allowed command.
    const commandPaths = (args && typeof args.command === "string")
      ? extractCommandPaths(args.command).map(resolveToolPath)
      : [];

    // (1) Hard blocklist — sits BELOW the permission layer: user consent cannot
    // override it. Two tiers:
    //   • blockedPaths      — no READ and no WRITE (secrets: ~/.ssh, ~/.aws, …).
    //   • writeBlockedPaths — no WRITE, reads OK (Orbit's own source: the agent
    //     may read/explain its code but never modify it). `bash` counts as write.
    const blockedPaths = (cfg.fileSystem && cfg.fileSystem.blockedPaths) || [];
    const writeBlockedPaths = (cfg.fileSystem && cfg.fileSystem.writeBlockedPaths) || [];
    const toolWrites = isMutatingTool(name);
    // Blocklist runs over declared tool paths AND tokenized shell command paths.
    const blockCandidates = commandPaths.length ? toolPaths.concat(commandPaths) : toolPaths;
    let blockedHit = blockCandidates.find((p) => isPathBlocked(p, blockedPaths));
    let blockKind = blockedHit ? "protected (no read/write)" : null;
    if (!blockedHit && toolWrites) {
      blockedHit = blockCandidates.find((p) => isPathBlocked(p, writeBlockedPaths));
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
    let isOutside = outsidePaths.length > 0;

    // Empty-argument write bypass (Vuln C): a file-writing tool that arrives with
    // NO path field at all can't be proven in-zone, yet toolToCapability(name,false)
    // would classify it write_workspace → auto-allowed in edit. Treat a targetless
    // file-write as "outside" so the write_outside matrix (edit→ask, chat/plan→
    // block) governs it instead of silently allowing an unverifiable write.
    // SCOPED to genuine file-write tools only — deliberately NOT isMutatingTool(),
    // which also covers `bash`/`subagent` (a shell command routinely names no path
    // arg, so reclassifying those here would break normal shell/subagent use).
    const isFileWriteTool = /^(write|edit|replace_file_content|multi_replace_file_content)$/.test(String(name).toLowerCase());
    if (isFileWriteTool && toolPaths.length === 0 && !hasPathField(args)) {
      isOutside = true;
    }

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
  
  events.on("tool_call_end", async ({ id, name, result, isError, subagentId }) => {
    sendLog(ws, `[Tool Done] Finished ${name}`);

    const resultStr = typeof result === "string" ? result : JSON.stringify(result || "");
    const latencyMs = metricsManager.endToolCall(sessionId, id, name, resultStr);

    sendWithSession(ws, { type: "tool_end", toolCallId: id, name, result, latencyMs }, sessionId);

    // Sync plans from workspace in case file tools modified any plans
    const planState = await syncPlansFromWorkspace(sessionId);
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

    // Never end a turn with a blank assistant bubble. If the model produced no
    // final text, substitute a graceful fallback so the user always gets a
    // response — UNLESS the turn was deliberately halted (policy block / anti-
    // flail), which already surfaced its own explanation.
    let finalContent = cleanFinalText;
    if (!finalContent) {
      const g = turnGuards.get(sessionId);
      if (g && g.halted) {
        finalContent = ""; // already messaged by the policy/anti-flail path
      } else if (g && g.calls > 0) {
        finalContent = "Done — the actions above are the result of this turn. Let me know if you'd like anything else.";
      } else {
        finalContent = "I couldn't produce a response for that. It may have been declined, or it needs a capability the current mode blocks — try rephrasing, or switch modes and retry.";
      }
    }
    sendWithSession(ws, { type: "message", role: "assistant", content: finalContent }, sessionId);
    
    // TTS fallback. When the model followed the prompt it already emitted a
    // dedicated <tts> spoken block, which was extracted and voiced sentence-by-
    // sentence during streaming (see the accumulated_text handler) — nothing to
    // do here. Only when that block is MISSING do we fall back, and even then we
    // NEVER speak the full response: we make one separate, short inference that
    // produces a single spoken sentence. If that fails, we stay silent rather
    // than reading the entire (often long / code-laden) reply aloud.
    //
    // Query-nature gate: voice suits conversation and Q&A, not heavy task output.
    // For a 'task' query we skip this fallback summary entirely — a task that
    // wanted a spoken line already got it from its own <tts> block above; without
    // one, staying silent beats narrating a code/build dump. Conversational and
    // Q&A turns still get the spoken fallback.
    const ttsMatch = (accumulatedText || "").match(/<tts>([\s\S]*?)<\/tts>/i);
    const speakFallback = ws.queryNature !== "task";
    if (!ttsMatch && cleanFinalText && speakFallback) {
      // Short, plain, single-line replies are already speakable as-is; anything
      // longer or formatted gets condensed to one sentence first.
      const isAlreadySpeakable =
        cleanFinalText.length <= 50 &&
        !cleanFinalText.includes("`") &&
        !cleanFinalText.includes("\n") &&
        !cleanFinalText.includes("*");
      if (isAlreadySpeakable) {
        sendWithSession(ws, { type: "intelligent_speech", content: cleanFinalText }, sessionId);
      } else {
        const summary = await generateIntelligentSpeech(ws.currentPrompt || "query", cleanFinalText, getConfig);
        if (summary) {
          sendWithSession(ws, { type: "intelligent_speech", content: summary }, sessionId);
        }
        // No summary → no speech. Better silent than reading the whole reply.
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
    const planState = await syncPlansFromWorkspace(sessionId);
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
    // Surface a graceful assistant message in the CHAT (not just the Logs tab) so
    // a provider/content-policy/API failure is never a silent empty turn. Map the
    // common causes to a readable hint; full detail stays in the logs.
    const raw = String(message || "");
    let hint = "something went wrong running that turn";
    if (/content|policy|safety|moderation|filtered|refus/i.test(raw)) hint = "the model or provider declined that request on content-policy grounds";
    else if (/429|rate.?limit|quota|insufficient_quota/i.test(raw)) hint = "the model provider is rate-limiting or out of quota";
    else if (/401|403|unauthor|api[_ ]?key|invalid.*key/i.test(raw)) hint = "the model endpoint rejected the credentials (check LLM_API_KEY)";
    else if (/timeout|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|network|fetch failed|unreachable|socket hang/i.test(raw)) hint = "the model endpoint was unreachable";
    sendWithSession(ws, {
      type: "message",
      role: "assistant",
      content: `⚠️ I couldn't complete that — ${hint}. You can rephrase and try again; full details are in the Logs tab.`,
    }, sessionId);
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
    // Baked-in clarification (ask the user, incl. MCQ) + build handoff notifiers.
    "orbit-ask": { path: path.join(__dirname, "./mcp/ask-mcp.js") },
    "orbit-build": { path: path.join(__dirname, "./mcp/build-mcp.js") },
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

server.listen(PORT, HOST, async () => {
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
  try { Promise.resolve(telegramBridge.start()).catch((e) => console.error("[Telegram] start failed:", e.message)); } catch (e) { console.error("[Telegram] start failed:", e.message); }
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
    const interrupted = await db.listInterruptedSessions();
    if (interrupted.length) {
      console.log(`[Resume] ${interrupted.length} interrupted session(s) detected — resumable from the console.`);
    }
  } catch {}
});
