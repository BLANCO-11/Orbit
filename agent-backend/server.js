// agent-backend/server.js
// Orbit Backend — entry point
// Modular architecture: routes, WebSocket, harness abstraction, middleware

require("dotenv").config();

const express = require("express");
const http = require("http");
const cors = require("cors");
const path = require("path");
const EventEmitter = require("events");

const { validateEnv, discoverPiBinaries } = require("./env");
const { loadConfig } = require("./config");
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
} = require("./ws/session-helpers");
const { isMutatingTool, isReadOnlyTool, isConversationalPrompt } = require("./harnesses/picode/parser");
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
const createHealthRouter = require("./routes/health");
const createWorkspaceRouter = require("./routes/workspace");
const createDevicesRouter = require("./routes/devices");
const { createPromptsRouter } = require("./routes/prompts");
const { createSkillsRouter } = require("./routes/skills");
const createConnectorsRouter = require("./routes/connectors");
const createProfilesRouter = require("./routes/profiles");

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
const activeSessions = new Map();    // sessionId → { harness, ws, mode, subagentTracker }
const pendingApprovals = new Map();  // toolCallId → resolve callback
const sessionAllowedPaths = new Map(); // sessionId → Set<allowedPaths>

// Read config fresh from disk each call so a saved change (policy, budgets,
// notifications) hot-reloads on the next tool call / turn without a restart.
// Previously this returned a single startup snapshot, so POST /api/config
// wrote the file but nothing in-process ever saw the new values.
loadConfig(); // fail fast at boot if the config file is missing/corrupt
const getConfig = () => loadConfig();
const { nodePath, piPath } = discoverPiBinaries();

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
const mcpRegistry = new McpRegistry();
mcpRegistry.connectAll().catch(err => console.error("MCP registry connect failed:", err.message));

// ── HTTP + WebSocket Server ─────────────────────────────────────────
const server = http.createServer(app);
const harnessRegistry = createHarnessRegistry(); // remote orbit-adapter connections
const wss = createWebSocketServer(server, db, harnessRegistry);

// ── Auth ────────────────────────────────────────────────────────────
const authMiddleware = createAuthMiddleware(db);
if (!createAuthMiddleware.getSharedApiKey()) {
  console.warn("[SECURITY] ORBIT_API_KEY is not set — the API and WebSocket are UNAUTHENTICATED.");
  console.warn("[SECURITY] Fine for local-only dev; set ORBIT_API_KEY before exposing this server beyond 127.0.0.1.");
}

// ── Mount Routes ────────────────────────────────────────────────────
app.use("/api/config", authMiddleware, createConfigRouter(activeSessions));
app.use("/api/sessions", authMiddleware, createSessionsRouter());
app.use("/api/models", authMiddleware, createModelsRouter(getConfig));
app.use("/api/tts", authMiddleware, createTtsRouter(getConfig));
app.use("/api/voices", authMiddleware, createVoicesRouter());
app.use("/api/notify", authMiddleware, createNotificationsRouter(getConfig, wss));
app.use("/api/workspace", authMiddleware, createWorkspaceRouter());
app.use("/api/prompts", authMiddleware, createPromptsRouter());
app.use("/api/skills", authMiddleware, createSkillsRouter());
app.use("/api/connectors", authMiddleware, createConnectorsRouter(mcpRegistry));
app.use("/api/profiles", authMiddleware, createProfilesRouter(db));

// Channels: CRUD + test-fire are authed; the /:id/webhook receiver is public
// (external senders can't present a device token) and self-verifies per channel.
const channelOrigin = () => process.env.DASHBOARD_ORIGIN || "http://localhost:6801";
const channelsRouter = createChannelsRouter({ db, runProfileHeadless, getOrigin: channelOrigin });
app.use("/api/channels", (req, res, next) => {
  // Let the public webhook path through without auth; gate everything else.
  if (/^\/[^/]+\/webhook$/.test(req.path) && req.method === "POST") return next();
  return authMiddleware(req, res, next);
}, channelsRouter);

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
  res.json({ success: true, harnesses: [local, ...harnessRegistry.list()] });
});

// Tools a harness can offer, for the tools/extensions manager. Merges the
// harness's own tools (built-ins + extensions + observed) with the shared MCP
// connector tools (which every harness reaches). Harness-agnostic: the backend
// never special-cases a harness type — it just asks it.
app.get("/api/harnesses/:id/tools", authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    let harnessTools = [];
    if (!id || id === "local") {
      const probe = loadHarness("picode", {
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
        
        if (decision === "allow_session" && permPath) {
          if (!sessionAllowedPaths.has(sid)) sessionAllowedPaths.set(sid, new Set());
          sessionAllowedPaths.get(sid).add(resolveTargetPath(permPath));
        }
        
        const resolve = pendingApprovals.get(toolCallId);
        if (resolve) {
          pendingApprovals.delete(toolCallId);
          resolve(decision === "allow_once" || decision === "allow_session");
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
      
      // ── mode_switch ─────────────────────────────────────────
      else if (data.type === "mode_switch") {
        const { sessionId, mode } = data;
        const ses = activeSessions.get(sessionId || ws.activeSessionId);
        if (ses?.harness) {
          try { ses.harness.disconnect(); } catch {}
        }
        activeSessions.delete(sessionId || ws.activeSessionId);
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
      }
      
      // ── mode_switch_rerun ───────────────────────────────────
      else if (data.type === "mode_switch_rerun") {
        const { sessionId, mode, prompt: rerunPrompt, systemPromptType: st, skills: rerunSkills } = data;
        const sid = sessionId || ws.activeSessionId;

        const ses = activeSessions.get(sid);
        if (ses?.harness) { try { ses.harness.disconnect(); } catch {} }
        activeSessions.delete(sid);

        if (rerunPrompt) {
          sendLog(ws, `[Mode Switch Rerun] Re-sending prompt with mode "${mode}"`, false);
          await handleStartTask(ws, rerunPrompt, sid, mode, st, rerunSkills);
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
        // Persist final metrics
        try {
          const persistable = metricsManager.toPersistable(sid);
          const existingSession = db.getSession(sid);
          if (existingSession) {
            db.saveSession({
              ...existingSession,
              metrics: persistable,
              subagentTree: ses.subagentTracker ? ses.subagentTracker.toJSON() : existingSession.subagentTree,
            });
          }
        } catch (e) {
          console.error(`[Metrics] Error persisting session ${sid}:`, e.message);
        }

        if (ses.harness) {
          try { ses.harness.disconnect(); } catch {}
        }
        activeSessions.delete(sid);
        metricsManager.releaseSession(sid);
      }
    }
  });
});

// ── Agent Task Handler ──────────────────────────────────────────────
async function handleStartTask(ws, userPrompt, sessionId, mode, systemPromptType, skills, effort, harnessId, excludeTools, sandbox) {
  ws.activeSessionId = sessionId;
  ws.currentPrompt = userPrompt;
  
  const activeMode = mode || "";
  
  // ── Chat mode pre-check ───────────────────────────────────
  if (!activeMode || activeMode === "chat") {
    const toolKeyWords = ['read', 'write', 'edit', 'file', 'code', 'run', 'execute', 'command',
      'create', 'modify', 'search', 'find', 'grep', 'list', 'dir', 'folder', 'directory',
      'install', 'npm', 'git', 'compile', 'build', 'test', 'deploy', 'bash', 'shell',
      'terminal', 'open', 'navigate', 'browser', 'web', 'fetch', 'download', 'upload',
      'delete', 'remove', 'copy', 'move', 'rename', 'make', 'generate', 'implement'];
    const lowerPrompt = userPrompt.toLowerCase();
    const needsTools = toolKeyWords.some(kw => lowerPrompt.includes(kw));
    
    if (needsTools) {
      const suggestedMode = lowerPrompt.includes('read') || lowerPrompt.includes('search') ||
        lowerPrompt.includes('find') || lowerPrompt.includes('list') ? 'plan' : 'edit';
      sendLog(ws, `[Chat Mode] Prompt appears to need tools. Suggesting ${suggestedMode} mode.`, false, sessionId);
      sendWithSession(ws, {
        type: "mode_suggestion",
        mode: suggestedMode,
        reason: `Your prompt appears to need tool execution, but you're in Chat mode. Please switch to ${suggestedMode.toUpperCase()} mode.`
      }, sessionId);
      sendStatus(ws, "done", sessionId);
      return;
    }
  }
  
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

  if (taskMode === "hybrid" && !isChat && !isConversationalPrompt(userPrompt)) {
    sendLog(ws, "Generating execution plan...", true, sessionId);
    const plan = await generatePlan(userPrompt, getConfig);
    if (plan) {
      sendLog(ws, "TUI execution plan generated successfully.", true, sessionId);
      sendWithSession(ws, { type: "plan", content: plan }, sessionId);
      sendWithSession(ws, { type: "reasoning_update", content: plan }, sessionId);
    }
  }

  // ── Initialize metrics ────────────────────────────────────
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
  
  // ── Spawn or reuse harness ────────────────────────────────
  // A session may target a specific harness by id: "local" (or unset) runs the
  // local pi child process; a remote id runs on the connected orbit-adapter of
  // that id, via RemoteHarness. Both implement the same interface downstream.
  let sessionItem = activeSessions.get(sessionId);
  if (!sessionItem || !sessionItem.harness) {
    const activeSandbox = sandbox || "host";
    // Sandbox 'remote' runs on a paired remote harness; an explicit remote
    // harnessId does too. 'container' runs in an ephemeral Docker container.
    const wantRemote = activeSandbox === "remote" || (harnessId && harnessId !== "local");
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
      };
      let harness;
      if (remoteEntry) {
        harness = new RemoteHarness({ ...commonOpts, registryEntry: remoteEntry });
      } else if (activeSandbox === "container") {
        harness = new ContainerHarness({ ...commonOpts, binaries: { nodePath, piPath } });
      } else {
        harness = loadHarness("picode", { ...commonOpts, binaries: { nodePath, piPath } });
      }

      await harness.connect();
      sessionItem = { harness, ws, mode: activeMode, subagentTracker, deviceId: ws.device?.id || null, harnessId: remoteEntry ? remoteEntry.id : "local", sandbox: activeSandbox };
      activeSessions.set(sessionId, sessionItem);
    } catch (err) {
      console.error(`[handleStartTask] Failed to spawn harness:`, err);
      sendLog(ws, `Failed to spawn agent: ${err.message}`, false, sessionId);
      sendStatus(ws, "error", sessionId);
      return;
    }
  }
  
  sendStatus(ws, "executing", sessionId);
  
  // ── Metrics auto-save ─────────────────────────────────────
  const saveInterval = getConfig().metrics?.saveIntervalMs || 30000;
  const metricsAutoSave = setInterval(() => {
    const ses = activeSessions.get(sessionId);
    if (!ses) { clearInterval(metricsAutoSave); return; }
    try {
      const persistable = metricsManager.toPersistable(sessionId);
      const existingSession = db.getSession(sessionId);
      if (existingSession) {
        db.saveSession({ ...existingSession, metrics: persistable, subagentTree: subagentTracker.toJSON() });
      }
    } catch {}
  }, saveInterval);
  
  sessionItem._metricsAutoSave = metricsAutoSave;

  // Mark the session as running so an interrupted turn (harness death / server
  // restart) is detectable and resumable. Cleared on agent_end / close.
  try { db.setSessionRunning(sessionId, { activePrompt: userPrompt, mode: activeMode }); } catch {}

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

/** Broadcast a notification to every connected dashboard. */
function broadcastNotification({ title, body, severity }) {
  const msg = JSON.stringify({ type: "notification", title, body, severity, timestamp: new Date().toISOString() });
  wss.clients.forEach((c) => { if (c.readyState === 1) { try { c.send(msg); } catch {} } });
  console.log(`[Notify] ${severity || "info"}: ${title} — ${body || ""}`);
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
  events.on("usage", ({ input, output, reasoning, subagentId }) => {
    if (subagentId) {
      const agent = subagentTracker.getAgent(subagentId);
      if (agent) {
        agent.tokens.input += input || 0;
        agent.tokens.output += output || 0;
        agent.tokens.reasoning += reasoning || 0;
        agent.tokens.total = agent.tokens.input + agent.tokens.output + agent.tokens.reasoning;
      }
    }
    metricsManager.recordUsage(sessionId, { input, output, reasoning });
    sendWithSession(ws, {
      type: "usage_update",
      ...metricsManager.toFrontendUpdate(sessionId),
    }, sessionId);
  });
  
  events.on("accumulated_thinking", ({ text }) => {
    sendWithSession(ws, { type: "plan", content: text }, sessionId);
    sendWithSession(ws, { type: "reasoning_update", content: text }, sessionId);
  });
  
  events.on("tool_call_start", ({ id, name, arguments: args, subagentId }) => {
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
        if (ses?.harness) ses.harness.cancel();
        sendStatus(ws, "done", sessionId);
        return;
      }

      subagentTracker.spawnAgent(id, saName, parentId, inheritedMode, saPrompt);
      subagentTracker.setStatus(id, STATUS.WORKING);
      metricsManager.addSubagent(sessionId, { id, name: saName, parentId, status: STATUS.WORKING, mode: inheritedMode });

      sendLog(ws, `[Subagent Spawn] Mode="${inheritedMode}" inherited by subagent "${saName}".`, false);
    } else if (subagentId && subagentTracker.getAgent(subagentId)) {
      // This tool call is being made BY a subagent (nested tool use) — record it against the subagent, not the session.
      subagentTracker.startToolCall(subagentId, id, name, args);
    }
    
    // ── Policy-matrix enforcement ─────────────────────────────
    // Map the tool to a capability (write in/out depends on the path), then
    // evaluate it against the configurable capability × mode matrix, tightened
    // by any per-device override. block → cancel; ask → surface a gate.
    const activeMode = mode || "chat";
    const toolPaths = extractPathsFromArgs(args);
    const outsidePaths = toolPaths.filter(p => !isPathAllowed(p));
    const isOutside = outsidePaths.length > 0;
    const capability = policyEngine.toolToCapability(name, isOutside);
    const deviceOverrides = ws.device?.policyOverrides || null;
    const { decision } = policyEngine.evaluate(capability, activeMode, getConfig(), deviceOverrides);

    if (decision === "block") {
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
      // Keep the legacy mode_suggestion for the existing frontend banner.
      if (suggestion) {
        sendWithSession(ws, { type: "mode_suggestion", mode: suggestion, reason: `The agent needs ${suggestion.toUpperCase()} mode to use "${name}".` }, sessionId);
      }
      const ses = activeSessions.get(sessionId);
      if (ses?.harness) ses.harness.cancel();
      sendStatus(ws, "done", sessionId);
      return;
    }

    if (decision === "ask") {
      // Surface an approval gate in the timeline. For path-scoped writes we
      // honor any session-granted allowances so we don't re-ask every time.
      const sessionPerms = sessionAllowedPaths.get(sessionId) || new Set();
      const unresolvedPaths = outsidePaths.filter(p => !sessionPerms.has(resolveTargetPath(p)));
      if (capability !== "write_outside" || unresolvedPaths.length > 0) {
        sendLog(ws, `[Policy] "${name}" (${capability}) requires approval in ${activeMode} mode.`, false);
        sendWithSession(ws, {
          type: "edit_permission_request",
          toolCallId: id,
          toolName: name,
          capability,
          paths: unresolvedPaths,
          outsidePaths: unresolvedPaths,
          safeZone: require("./ws/session-helpers").PROJECT_ROOT,
        }, sessionId);
      }
    }
  });
  
  events.on("tool_call_end", ({ id, name, result, subagentId }) => {
    sendLog(ws, `[Tool Done] Finished ${name}`);

    const resultStr = typeof result === "string" ? result : JSON.stringify(result || "");
    const latencyMs = metricsManager.endToolCall(sessionId, id, name, resultStr);

    sendWithSession(ws, { type: "tool_end", toolCallId: id, name, result, latencyMs }, sessionId);

    // Handle nested tool calls made BY a subagent
    if (subagentId && subagentTracker.getAgent(subagentId)) {
      const subLatencyMs = subagentTracker.endToolCall(subagentId, id, resultStr);
      metricsManager.addSubagentToolCall(sessionId, subagentId, name, null, resultStr, subLatencyMs);
    }

    // Subagent completion
    if (name === "subagent") {
      subagentTracker.markCompleted(id, resultStr);
      metricsManager.completeSubagent(sessionId, id, resultStr);

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
      // toFrontendUpdate()'s active-only `subagents` field.
      ...metricsManager.toFrontendUpdate(sessionId),
      subagents: subagentTracker.toFrontendSummary(),
    }, sessionId);
  });
  
  events.on("subagent_reasoning", ({ subagentId, delta, tokens }) => {
    subagentTracker.addReasoning(subagentId, delta, tokens);
    metricsManager.addSubagentReasoning(sessionId, subagentId, delta, tokens);
    
    sendWithSession(ws, {
      type: "subagent_metrics",
      // Spread FIRST so the tracker's full-history summary isn't clobbered by
      // toFrontendUpdate()'s active-only `subagents` field.
      ...metricsManager.toFrontendUpdate(sessionId),
      subagents: subagentTracker.toFrontendSummary(),
    }, sessionId);
  });
  
  events.on("subagent_status", ({ subagentId, status }) => {
    subagentTracker.setStatus(subagentId, status);
    const normalizedStatus = subagentTracker.getAgent(subagentId)?.status;
    metricsManager.updateSubagent(sessionId, subagentId, { status: normalizedStatus });

    sendWithSession(ws, {
      type: "subagent_metrics",
      // Spread FIRST so the tracker's full-history summary isn't clobbered by
      // toFrontendUpdate()'s active-only `subagents` field.
      ...metricsManager.toFrontendUpdate(sessionId),
      subagents: subagentTracker.toFrontendSummary(),
    }, sessionId);
  });
  
  events.on("agent_end", async ({ accumulatedText, accumulatedThinking }) => {
    sendLog(ws, "Agent prompt turn completed.");

    // Close the per-turn ledger entry and push the final numbers for this turn.
    metricsManager.endTurn(sessionId);
    sendWithSession(ws, {
      type: "usage_update",
      ...metricsManager.toFrontendUpdate(sessionId),
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

    // Turn finished cleanly — no longer resumable.
    try { db.clearSessionRunning(sessionId); } catch {}
    sendStatus(ws, "done", sessionId);
  });

  events.on("stderr", ({ text }) => {
    sendLog(ws, `[Pi Stderr] ${text}`, false, sessionId);
  });
  
  events.on("close", ({ code }) => {
    const ses = activeSessions.get(sessionId);
    if (ses?._metricsAutoSave) clearInterval(ses._metricsAutoSave);
    
    // Persist final metrics
    try {
      const persistable = metricsManager.toPersistable(sessionId);
      const existingSession = db.getSession(sessionId);
      if (existingSession) {
        db.saveSession({ ...existingSession, metrics: persistable, subagentTree: subagentTracker.toJSON() });
      }
    } catch (e) {
      console.error(`[Metrics] Error persisting metrics for ${sessionId}:`, e.message);
    }
    
    activeSessions.delete(sessionId);
    sendStatus(ws, "done", sessionId);
    
    setTimeout(() => metricsManager.releaseSession(sessionId), 5000);
  });
  
  events.on("error", ({ message }) => {
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
    try {
      const persistable = metricsManager.toPersistable(sid);
      const existing = db.getSession(sid);
      if (existing) {
        db.saveSession({
          ...existing,
          metrics: persistable,
          subagentTree: ses.subagentTracker ? ses.subagentTracker.toJSON() : existing.subagentTree,
        });
      }
    } catch {}
    
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
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Orbit Backend Server listening on 127.0.0.1:${PORT} (internal only)`);
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
