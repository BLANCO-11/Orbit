// agent-backend/server.js
// AegisAgent Backend — entry point
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
const LightpandaMcpClient = require("./mcp-client");
const { loadHarness } = require("./harnesses");
const { generateIntelligentSpeech } = require("./services/tts");
const { generatePlan } = require("./services/plan-generator");
const { estimateTokens } = require("./metrics");
const {
  sendLog, sendStatus, sendWithSession,
  resolveTargetPath, isPathAllowed, extractPathsFromArgs,
} = require("./ws/session-helpers");
const { isMutatingTool, isReadOnlyTool, isConversationalPrompt } = require("./harnesses/picode/parser");

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

// WebSocket
const createWebSocketServer = require("./ws/index");

// ── Startup Validation ──────────────────────────────────────────────
validateEnv();

// ── Shared State ────────────────────────────────────────────────────
const PORT = process.env.PORT || 6800;
const activeSessions = new Map();    // sessionId → { harness, ws, mode, subagentTracker }
const pendingApprovals = new Map();  // toolCallId → resolve callback
const sessionAllowedPaths = new Map(); // sessionId → Set<allowedPaths>

let securityConfig = loadConfig();
const getConfig = () => securityConfig;
const { nodePath, piPath } = discoverPiBinaries();

// ── Express App ─────────────────────────────────────────────────────
const app = express();
app.use(cors({ origin: process.env.DASHBOARD_ORIGIN || "http://localhost:6801" }));
app.use(express.json({ limit: "50mb" }));
app.use("/screenshots", express.static(path.join(__dirname, "../workspace/screenshots")));
app.use(requestIdMiddleware);

// ── MCP Client ──────────────────────────────────────────────────────
const mcpClient = new LightpandaMcpClient();
mcpClient.connect().catch(err => console.error("MCP connect failed:", err.message));

// ── HTTP + WebSocket Server ─────────────────────────────────────────
const server = http.createServer(app);
const wss = createWebSocketServer(server);

// ── Auth ────────────────────────────────────────────────────────────
const authMiddleware = createAuthMiddleware(getConfig);

// ── Mount Routes ────────────────────────────────────────────────────
app.use("/api/config", authMiddleware, createConfigRouter(activeSessions));
app.use("/api/sessions", authMiddleware, createSessionsRouter());
app.use("/api/models", authMiddleware, createModelsRouter(getConfig));
app.use("/api/tts", authMiddleware, createTtsRouter(getConfig));
app.use("/api/voices", authMiddleware, createVoicesRouter());
app.use("/api/notify", authMiddleware, createNotificationsRouter(getConfig, wss));
app.use("/api/workspace", authMiddleware, createWorkspaceRouter());
app.use("/api/health", createHealthRouter({ db, mcpClient, getConfig, activeSessions }));

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
        const { prompt, sessionId: sid, mode, systemPromptType } = data;
        const sessionId = sid || "default-session";
        
        // Session isolation: kill other sessions on this WS
        for (const [eid, ses] of activeSessions.entries()) {
          if (eid !== sessionId && ses.ws === ws) {
            console.log(`[Session Isolation] Killing session ${eid} on this WS before starting ${sessionId}...`);
            try { ses.harness?.disconnect(); } catch {}
            activeSessions.delete(eid);
          }
        }
        
        await handleStartTask(ws, prompt, sessionId, mode, systemPromptType);
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
        const { sessionId, mode, prompt: rerunPrompt, systemPromptType: st } = data;
        const sid = sessionId || ws.activeSessionId;
        
        const ses = activeSessions.get(sid);
        if (ses?.harness) { try { ses.harness.disconnect(); } catch {} }
        activeSessions.delete(sid);
        
        if (rerunPrompt) {
          sendLog(ws, `[Mode Switch Rerun] Re-sending prompt with mode "${mode}"`, false);
          await handleStartTask(ws, rerunPrompt, sid, mode, st);
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
            db.saveSession({ ...existingSession, metrics: persistable });
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
async function handleStartTask(ws, userPrompt, sessionId, mode, systemPromptType) {
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
  
  // ── Hybrid planning ───────────────────────────────────────
  const taskMode = getConfig().litellm?.taskMode || "normal";
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
  metricsManager.initSession(sessionId, activeMode);
  metricsManager.recordInputTokens(sessionId, userPrompt);
  
  // ── Initialize subagent tracker ───────────────────────────
  const subagentTracker = new SubagentTracker(sessionId);
  
  // ── Spawn or reuse harness ────────────────────────────────
  let sessionItem = activeSessions.get(sessionId);
  if (!sessionItem || !sessionItem.harness) {
    sendLog(ws, `Spawning agent session for ${sessionId} (mode=${activeMode})...`, false, sessionId);
    
    const harness = loadHarness("picode", {
      events: createHarnessEventEmitter(ws, sessionId, activeMode, subagentTracker),
      config: getConfig(),
      sessionId,
      mode: activeMode,
      systemPromptType,
      binaries: { nodePath, piPath },
    });
    
    await harness.connect();
    sessionItem = { harness, ws, mode: activeMode, subagentTracker };
    activeSessions.set(sessionId, sessionItem);
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
        db.saveSession({ ...existingSession, metrics: persistable });
      }
    } catch {}
  }, saveInterval);
  
  sessionItem._metricsAutoSave = metricsAutoSave;
  
  // Send the prompt
  await sessionItem.harness.sendPrompt(userPrompt);
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
  
  events.on("accumulated_thinking", ({ text }) => {
    sendWithSession(ws, { type: "plan", content: text }, sessionId);
    sendWithSession(ws, { type: "reasoning_update", content: text }, sessionId);
  });
  
  events.on("tool_call_start", ({ id, name, arguments: args }) => {
    const argsStr = JSON.stringify(args || {});
    sendLog(ws, `[Tool Call] ${name} ${argsStr}`);
    
    metricsManager.startToolCall(sessionId, id, name);
    metricsManager.setToolCallArgs(sessionId, id, args);
    
    sendWithSession(ws, { type: "tool_start", toolCallId: id, name, arguments: args }, sessionId);
    
    // Track subagent spawns
    if (name === "subagent") {
      const saPrompt = (args && (args.prompt || args.task)) || "Task execution";
      const saName = "Subagent (" + saPrompt.substring(0, 24) + (saPrompt.length > 24 ? "..." : "") + ")";
      const inheritedMode = mode || "chat";
      
      subagentTracker.spawnAgent(id, saName, null, inheritedMode, saPrompt);
      subagentTracker.setStatus(id, STATUS.WORKING);
      
      sendLog(ws, `[Subagent Spawn] Mode="${inheritedMode}" inherited by subagent "${saName}".`, false);
    }
    
    // Mode enforcement
    const isMutating = isMutatingTool(name);
    
    if (!mode || mode === "chat") {
      const suggestedMode = isMutating ? "edit" : "plan";
      sendLog(ws, `[Mode Enforcement] Blocked "${name}" in Chat mode. Suggest: ${suggestedMode}`, false);
      sendWithSession(ws, {
        type: "mode_suggestion",
        mode: suggestedMode,
        reason: `The agent needs ${suggestedMode.toUpperCase()} mode to use "${name}".`
      }, sessionId);
      
      const ses = activeSessions.get(sessionId);
      if (ses?.harness) ses.harness.cancel();
      sendStatus(ws, "done", sessionId);
      return;
    }
    
    if (mode === "plan" && isMutating) {
      sendLog(ws, `[Mode Enforcement] Blocked "${name}" in Plan mode. Suggest: edit`, false);
      sendWithSession(ws, {
        type: "mode_suggestion",
        mode: "edit",
        reason: `The agent tried to use "${name}" (a write tool) in Plan mode. Switch to EDIT mode.`
      }, sessionId);
      
      const ses = activeSessions.get(sessionId);
      if (ses?.harness) ses.harness.cancel();
      sendStatus(ws, "done", sessionId);
      return;
    }
    
    // Edit mode directory permission check
    if (mode === "edit") {
      const toolPaths = extractPathsFromArgs(args);
      if (toolPaths.length > 0) {
        const sessionPerms = sessionAllowedPaths.get(sessionId) || new Set();
        const outsidePaths = toolPaths.filter(p => !isPathAllowed(p));
        
        if (outsidePaths.length > 0) {
          const unresolvedPaths = outsidePaths.filter(p => {
            const resolved = resolveTargetPath(p);
            return !sessionPerms.has(resolved);
          });
          
          if (unresolvedPaths.length > 0) {
            sendLog(ws, `[Edit Mode] Tool "${name}" accessing path(s) outside safe zone: ${unresolvedPaths.join(", ")}`, false);
            sendWithSession(ws, {
              type: "edit_permission_request",
              toolCallId: id,
              toolName: name,
              paths: unresolvedPaths,
              outsidePaths: unresolvedPaths,
              safeZone: require("./ws/session-helpers").PROJECT_ROOT,
            }, sessionId);
          }
        }
      }
    }
  });
  
  events.on("tool_call_end", ({ id, name, result }) => {
    sendLog(ws, `[Tool Done] Finished ${name}`);
    
    const resultStr = typeof result === "string" ? result : JSON.stringify(result || "");
    const latencyMs = metricsManager.endToolCall(sessionId, id, name, resultStr);
    
    sendWithSession(ws, { type: "tool_end", toolCallId: id, name, result }, sessionId);
    
    // Handle subagent tool calls
    if (subagentTracker.getAgent(id)) {
      subagentTracker.endToolCall(id, id, resultStr);
    }
    
    // Subagent completion
    if (name === "subagent") {
      subagentTracker.markCompleted(id, resultStr);
      
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
      subagents: subagentTracker.toFrontendSummary(),
      ...metricsManager.toFrontendUpdate(sessionId),
    }, sessionId);
  });
  
  events.on("subagent_reasoning", ({ subagentId, delta, tokens }) => {
    subagentTracker.addReasoning(subagentId, delta, tokens);
    metricsManager.addSubagentReasoning(sessionId, subagentId, delta, tokens);
    
    sendWithSession(ws, {
      type: "subagent_metrics",
      subagents: subagentTracker.toFrontendSummary(),
      ...metricsManager.toFrontendUpdate(sessionId),
    }, sessionId);
  });
  
  events.on("subagent_status", ({ subagentId, status }) => {
    subagentTracker.setStatus(subagentId, status);
    
    sendWithSession(ws, {
      type: "subagent_metrics",
      subagents: subagentTracker.toFrontendSummary(),
      ...metricsManager.toFrontendUpdate(sessionId),
    }, sessionId);
  });
  
  events.on("agent_end", async ({ accumulatedText, accumulatedThinking }) => {
    sendLog(ws, "Agent prompt turn completed.");
    
    const cleanFinalText = (accumulatedText || "")
      .replace(/<tts>[\s\S]*?<\/tts>/gi, "")
      .trim();
    
    sendWithSession(ws, { type: "message", role: "assistant", content: cleanFinalText }, sessionId);
    
    // TTS
    const ttsMatch = (accumulatedText || "").match(/<tts>([\s\S]*?)<\/tts>/i);
    const ttsText = ttsMatch ? ttsMatch[1].trim() : cleanFinalText;
    
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
        db.saveSession({ ...existingSession, metrics: persistable });
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
      if (existing) db.saveSession({ ...existing, metrics: persistable });
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
  await mcpClient.disconnect().catch(() => {});
  
  console.log("[Shutdown] Cleanup complete. Exiting.");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ── Start ───────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`AegisAgent Backend Server listening on port ${PORT}`);
});
