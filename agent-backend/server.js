const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { exec, spawn } = require("child_process");
const { OpenAI } = require("openai");
require("dotenv").config();

const { validatePath, validateCommand } = require("./security-guard");
const LightpandaMcpClient = require("./mcp-client");
const db = require("./db");
const { metricsManager, migrateLegacyMetrics, estimateTokens } = require("./metrics");
const { SubagentTracker, STATUS } = require("./subagent-tracker");

const PORT = process.env.PORT || 6800;

// Summarize long agent responses relative to the user query using LiteLLM
async function generateIntelligentSpeech(query, responseText) {
  try {
    const apiKey = process.env.LITELLM_KEY || "sk-7QU3mNiOzn3Wpgy_qwPn0Q";
    const baseURL = (securityConfig && securityConfig.litellm && securityConfig.litellm.baseURL) || "http://127.0.0.1:5000/v1";
    const model = (securityConfig && securityConfig.litellm && securityConfig.litellm.selectedNormalModel) || "litellm/deepseek-v4-flash";

    console.log(`[Intelligent TTS] Requesting summary from LiteLLM: ${model}...`);
    
    const response = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: "system",
            content: "You are a concise voice assistant. Summarize what the agent completed in one simple, natural sentence to answer the user's query. Avoid any markdown formatting, bullet points, headers, or code blocks. Speak directly and conversationally."
          },
          {
            role: "user",
            content: `User query: "${query}"\n\nAgent response:\n${responseText}`
          }
        ],
        max_tokens: 80,
        temperature: 0.3
      })
    });

    if (!response.ok) {
      throw new Error(`LiteLLM returned status ${response.status}`);
    }

    const data = await response.json();
    const summary = data.choices[0].message.content.trim();
    console.log(`[Intelligent TTS] Generated summary: "${summary}"`);
    return summary;
  } catch (err) {
    console.error("[Intelligent TTS] Summary generation failed:", err.message);
    return null;
  }
}
const activeSessions = new Map();

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use("/screenshots", express.static(path.join(__dirname, "../workspace/screenshots")));

const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

// Load security config
const configPath = path.join(__dirname, "security-config.json");
let securityConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));

// Initialize MCP Client for Lightpanda
const mcpClient = new LightpandaMcpClient();

// Connect to MCP on startup
mcpClient.connect().catch((err) => {
  console.error("Failed to connect to Lightpanda MCP server:", err.message);
});

// Map to track pending user approvals
const pendingApprovals = new Map();

// Session-level directory permissions (paths allowed for the session)
const sessionAllowedPaths = new Map(); // sessionId -> Set of paths allowed for duration of session

// Project safe zone — the root directory the agent is allowed to operate in without permission
const PROJECT_ROOT = path.resolve(__dirname, "..");

// Extract file/directory paths from tool call arguments
function extractPathsFromArgs(args) {
  const paths = [];
  if (!args) return paths;
  if (typeof args === "string") {
    try { args = JSON.parse(args); } catch(e) { return paths; }
  }
  // Common path fields in tool call arguments
  const pathFields = ["path", "filePath", "dir", "directory", "target", "destination", "source", "location", "folder"];
  for (const field of pathFields) {
    if (args[field] && typeof args[field] === "string") {
      // Check if it's a filesystem path (starts with / or ~ or ./ or ../ or a letter on Windows)
      if (/^([~\/.\\]|[a-zA-Z]:\\)/.test(args[field])) {
        paths.push(args[field]);
      }
    }
  }
  // Also check for path in command arguments (bash tool)
  if (args.command && typeof args.command === "string") {
    // Extract paths from command (cd, cat, ls, etc.)
    const cmdPaths = args.command.match(/(?:^|\s)(?:cd\s+|cat\s+|ls\s+|rm\s+|cp\s+|mv\s+|mkdir\s+|touch\s+|chmod\s+|chown\s+)([~\/][^\s;|&]+)/gi);
    if (cmdPaths) {
      cmdPaths.forEach(cp => {
        const p = cp.replace(/^\s*\w+\s+/, "").trim();
        if (p) paths.push(p);
      });
    }
  }
  return paths;
}

// Resolve a path to its absolute form
function resolveTargetPath(inputPath) {
  if (inputPath.startsWith("~")) {
    return inputPath.replace(/^~/, os.homedir());
  }
  return path.resolve(inputPath);
}

// Check if a target path is within the project safe zone
function isPathAllowed(targetPath, projectRoot) {
  try {
    const resolved = resolveTargetPath(targetPath);
    // Allow if inside project root
    if (resolved.startsWith(projectRoot + "/") || resolved === projectRoot) {
      return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

// Helper to get dynamic OpenAI client
function getOpenAIClient() {
  return new OpenAI({
    baseURL: securityConfig.litellm.baseURL,
    apiKey: securityConfig.litellm.apiKey,
  });
}

// API: Get Security & LiteLLM Config
app.get("/api/config", (req, res) => {
  res.json(securityConfig);
});

// API: Save Security & LiteLLM Config
app.post("/api/config", (req, res) => {
  try {
    securityConfig = req.body;
    fs.writeFileSync(configPath, JSON.stringify(securityConfig, null, 2), "utf-8");
    
    // Kill all active agent sessions to force them to reload the new configuration
    for (const [sessionId, session] of activeSessions.entries()) {
      if (session.piProcess) {
        console.log(`Killing active session ${sessionId} to apply new configuration...`);
        try {
          session.piProcess.kill("SIGINT");
        } catch (e) {
          console.error(`Failed to kill session ${sessionId}:`, e);
        }
      }
      activeSessions.delete(sessionId);
    }
    
    res.json({ success: true, message: "Configuration saved successfully." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// SQLite Session Persistence Endpoints
app.get("/api/sessions", (req, res) => {
  try {
    const list = db.getAllSessions();
    res.json({ success: true, sessions: list });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get("/api/sessions/:id", (req, res) => {
  try {
    const session = db.getSession(req.params.id);
    if (!session) {
      return res.status(404).json({ success: false, message: "Session not found" });
    }
    res.json({ success: true, session });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post("/api/sessions", (req, res) => {
  try {
    db.saveSession(req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.delete("/api/sessions/:id", (req, res) => {
  try {
    db.deleteSession(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Search sessions
app.get("/api/sessions/search", (req, res) => {
  try {
    const q = req.query.q;
    if (!q) {
      return res.json({ success: true, sessions: db.getAllSessions() });
    }
    const results = db.searchSessions(q);
    res.json({ success: true, sessions: results });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Export all sessions as JSON download
app.get("/api/sessions/export/all", (req, res) => {
  try {
    const all = db.getAllSessions();
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", "attachment; filename=aegis-sessions-export.json");
    res.json(all);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Import sessions from JSON
app.post("/api/sessions/import", (req, res) => {
  try {
    const sessions = req.body;
    if (!Array.isArray(sessions)) {
      return res.status(400).json({ success: false, message: "Expected an array of sessions." });
    }
    let imported = 0;
    for (const session of sessions) {
      if (session.id && session.title !== undefined) {
        db.saveSession(session);
        imported++;
      }
    }
    res.json({ success: true, imported });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// List available backups
app.get("/api/sessions/backups", (req, res) => {
  try {
    const backups = db.getBackups();
    res.json({ success: true, backups });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Proactive Notifier API (hits notify-send, Discord webhook, and WebSockets)
app.post("/api/notify", (req, res) => {
  try {
    const { title, message, severity } = req.body;
    console.log(`[Notification API] [${(severity || "info").toUpperCase()}] ${title}: ${message}`);
    
    // 1. Desktop Notification via Linux notify-send
    const escapedTitle = (title || "AegisAgent Alert").replace(/"/g, '\\"');
    const escapedMsg = (message || "").replace(/"/g, '\\"');
    const urgency = severity === "error" ? "critical" : severity === "warning" ? "normal" : "low";
    
    exec(`notify-send -u ${urgency} "${escapedTitle}" "${escapedMsg}"`, (err) => {
      if (err) console.error("Desktop notify-send failed:", err.message);
    });

    // 2. Discord Webhook integration
    if (securityConfig && securityConfig.notifications && securityConfig.notifications.discordWebhook) {
      fetch(securityConfig.notifications.discordWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: `**[${(severity || "info").toUpperCase()}] ${escapedTitle}**\n${escapedMsg}`
        })
      }).catch(e => console.error("Discord webhook delivery failed:", e.message));
    }

    // 3. Slack Webhook integration
    if (securityConfig && securityConfig.notifications && securityConfig.notifications.slackWebhook) {
      fetch(securityConfig.notifications.slackWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `*[${(severity || "info").toUpperCase()}] ${escapedTitle}*\n${escapedMsg}`
        })
      }).catch(e => console.error("Slack webhook delivery failed:", e.message));
    }

    // 4. Stream to all connected WebSocket clients
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: "log",
          content: `[Proactive Notify] [${(severity || "info").toUpperCase()}]: ${title} - ${message}`,
          isSystem: true
        }));
      }
    });

    res.json({ success: true, message: "Notification dispatched successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// API: List Available Models from LiteLLM
app.get("/api/models", async (req, res) => {
  try {
    const openai = getOpenAIClient();
    const modelsResponse = await openai.models.list();
    res.json(modelsResponse.data || []);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// API: Text-to-Speech proxy to local pocket-tts service
app.post("/api/tts", async (req, res) => {
  const { text, voice } = req.body;
  if (!text) {
    return res.status(400).json({ success: false, message: "Text is required." });
  }

  const ttsKey = process.env.LOCAL_TTS_KEY;
  if (!ttsKey) {
    return res.status(500).json({ success: false, message: "LOCAL_TTS_KEY not found in environment configurations." });
  }

  try {
    const response = await fetch("http://127.0.0.1:6767/v1/audio/speech", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${ttsKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "pocket-tts",
        input: text,
        voice: voice || "alba",
        response_format: "mp3"
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ success: false, message: `TTS service error: ${errText}` });
    }

    res.setHeader("Content-Type", "audio/mpeg");
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// API: Get available voices from local TTS service
app.get("/api/voices", async (req, res) => {
  const ttsKey = process.env.LOCAL_TTS_KEY;
  if (!ttsKey) {
    return res.json([]);
  }

  try {
    const response = await fetch("http://127.0.0.1:6767/v1/voices", {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${ttsKey}`
      }
    });

    if (!response.ok) {
      return res.json([]);
    }

    const data = await response.json();
    res.json(data.voices || []);
  } catch (error) {
    console.error("Failed to fetch voices from local TTS:", error.message);
    res.json([]);
  }
});

// WebSocket upgrade logic
server.on("upgrade", (request, socket, head) => {
  if (request.url === "/api/ws") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

// ── Session-aware WebSocket helpers ──
// Every event includes sessionId so the frontend can route it to the correct session tab

function getActiveSessionId(ws) {
  return ws && ws.activeSessionId ? ws.activeSessionId : "unknown";
}

// sendLog with optional explicit sessionId (preferred for before ws.activeSessionId is set)
const sendLog = (ws, content, isSystem = true, explicitSessionId) => {
  const sessionId = explicitSessionId || getActiveSessionId(ws);
  console.log(`[Log][${sessionId}] ${content}`);
  if (ws) {
    ws.send(JSON.stringify({ type: "log", content, isSystem, sessionId }));
  }
};

// sendStatus with optional explicit sessionId
const sendStatus = (ws, status, explicitSessionId) => {
  const sessionId = explicitSessionId || getActiveSessionId(ws);
  if (ws) {
    ws.send(JSON.stringify({ type: "status", status, sessionId }));
  }
};

// Helper: send any WebSocket payload with sessionId auto-attached
// For explicit sessionId, pass it in the data object as sessionId
const sendWithSession = (ws, data, explicitSessionId) => {
  if (!ws) return;
  const sessionId = explicitSessionId || getActiveSessionId(ws);
  ws.send(JSON.stringify({ ...data, sessionId }));
};

// ── Helper: strip TUI box-drawing characters from reasoning/plan output ──
function stripTuiChars(text) {
  // Remove all box-drawing / line-drawing characters that clutter the reasoning tab
  const lines = text
    .replace(/[╔╗╚╝║═╠╣╦╩╬┌┐└┘├┤┬┴┼─│]/g, "")
    .split("\n")
    .map(line => {
      // Strip leading/trailing decorative pipes, corners
      let cleaned = line.replace(/^[\s│├┤┌┐└┘║╠╣┬┴┼─═]*\s*/, "");
      cleaned = cleaned.replace(/[\s│├┤┌┐└┘║╠╣┬┴┼─═]*$/, "");
      return cleaned.trim();
    })
    .filter(line => {
      // Remove purely decorative lines (only dashes, spaces, brackets, TUI remnants)
      const stripped = line.replace(/[\-\=\[\]\(\)\s\.<>]/g, "").trim();
      return stripped.length > 0;
    });
  
  // Deduplicate progressive refinements:
  // When the agent outputs "The user", then "The user is", then "The user is asking",
  // only keep the most complete version of repeated thoughts.
  const deduped = [];
  for (let i = 0; i < lines.length; i++) {
    const current = lines[i];
    const next = i + 1 < lines.length ? lines[i + 1] : null;
    // Skip if next line is a continuation/expansion (current is a prefix of next)
    if (next && next.startsWith(current) && next.length > current.length + 3) {
      continue;
    }
    // Skip if current line looks like a fragment that continues on next
    if (current.length < 15 && next && next.includes(current.trim())) {
      continue;
    }
    deduped.push(current);
  }
  
  // Remove trailing fragments that look incomplete (single chars or mid-word cuts)
  while (deduped.length > 0) {
    const last = deduped[deduped.length - 1];
    if (last.length < 2) { deduped.pop(); continue; }
    // Remove short lines ending mid-word (no punctuation, no known short words)
    if (last.length < 5 && !/[.!?\)\]\"\'>]\s*$/.test(last) && !/^(No|Ok|Hi|Bye|Yes|Done|Step|File|Code|Test|Bug|Fix|Add|Run|Set|Get|Put|Try|Use|New|All|The|And|But|For|Not|Are|Was|Had|Has|Can|May|Will|Its|Let|How|Why|What|Who|When|Where)$/i.test(last)) {
      deduped.pop(); continue;
    }
    break;
  }
  
  return deduped.join("\n");
}

function isMutatingTool(toolName) {
  const mutatingTools = ["write", "edit", "replace_file_content", "multi_replace_file_content", "bash", "subagent"];
  return mutatingTools.includes(toolName);
}

function isReadOnlyTool(toolName) {
  if (toolName && toolName.startsWith("mcp_lightpanda_")) return true;
  const readOnlyTools = ["read", "find", "grep", "ls", "code_search", "web_search", "fetch_content", "get_search_content"];
  return readOnlyTools.includes(toolName);
}

// Spawn a persistent, long-running agent session in RPC mode mapped by sessionId
async function spawnAgentSession(ws, sessionId, mode, systemPromptType) {
  try {
    const normalModel = securityConfig.litellm.selectedNormalModel;
    const apiKey = securityConfig.litellm.apiKey;
    const activePromptType = systemPromptType || securityConfig.systemPromptType || "standard";
    
    // Select base prompt file
    const basePromptFile = (activePromptType === "fable-5") ? "claude-fable-5.md" : "standard.md";
    
    // Select mode-specific instructions
    let modePromptFile = null;
    if (mode === "plan") modePromptFile = "plan-mode.md";
    else if (mode === "edit") modePromptFile = "edit-mode.md";
    else if (mode === "yolo") modePromptFile = "yolo-mode.md";
    
    // Read and combine prompts
    const promptsDir = path.join(__dirname, "../prompts");
    const basePrompt = fs.readFileSync(path.join(promptsDir, basePromptFile), "utf-8");
    let combinedPrompt = basePrompt;
    
    if (modePromptFile) {
      const modePrompt = fs.readFileSync(path.join(promptsDir, modePromptFile), "utf-8");
      combinedPrompt = combinedPrompt + "\n\n" + modePrompt;
    }
    
    // Write combined prompt to a temporary file in the workspace
    const tempPromptDir = path.join(__dirname, "../workspace/temp");
    if (!fs.existsSync(tempPromptDir)) {
      fs.mkdirSync(tempPromptDir, { recursive: true });
    }
    const tempPromptPath = path.join(tempPromptDir, `system-prompt-${sessionId}.md`);
    fs.writeFileSync(tempPromptPath, combinedPrompt, "utf-8");
    
    const selectedPromptPath = tempPromptPath;

    // Terminate existing active session for this ID if any
    const existing = activeSessions.get(sessionId);
    if (existing && existing.piProcess) {
      console.log(`Terminating existing active agent session for ${sessionId}...`);
      try {
        existing.piProcess.kill("SIGINT");
      } catch (e) {
        console.error("Error killing previous process:", e);
      }
      activeSessions.delete(sessionId);
    }

    const childEnv = {
      ...process.env,
      LITELLM_KEY: apiKey,
      OPENAI_API_KEY: apiKey,
      AEGIS_MODE: mode || "chat"
    };

    const systemPromptText = fs.readFileSync(selectedPromptPath, "utf-8");

    const piArgs = [
      "--session-id", sessionId,
      "--provider", "litellm",
      "--model", `litellm/${normalModel}`,
      "--mode", "rpc",
      "--system-prompt", systemPromptText
    ];

    const nodePath = "/home/blanco/.local/share/pi-node/node-v22.22.3-linux-x64/bin/node";
    const piPath = "/home/blanco/.local/share/pi-node/node-v22.22.3-linux-x64/bin/pi";
    const spawnArgs = [piPath, ...piArgs];

    console.log(`[Spawn] Spawning persistent agent session for ${sessionId} (mode=${mode}): ${nodePath} ${spawnArgs.join(" ")}`);
    const piProcess = spawn(nodePath, spawnArgs, {
      env: childEnv,
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // ── Initialize metrics & subagent tracking ──
    // Load existing metrics from DB if available, otherwise start fresh
    let existingMetrics = null;
    try {
      const existingSession = db.getSession(sessionId);
      if (existingSession && existingSession.metrics) {
        existingMetrics = existingSession.metrics;
      }
    } catch (e) {
      // Session may not exist yet, that's fine
    }
    
    if (existingMetrics && Object.keys(existingMetrics).length > 0) {
      metricsManager.loadSession(sessionId, existingMetrics);
    } else {
      metricsManager.initSession(sessionId, mode);
    }
    
    // Initialize subagent tracker
    const subagentTracker = new SubagentTracker(sessionId);
    
    // Wire subagent tracker events to WebSocket
    subagentTracker.onEvent((sid, event) => {
      if (sid === sessionId && ws) {
        sendWithSession(ws, event.data || event, sessionId);
      }
    });
    
    activeSessions.set(sessionId, { piProcess, ws, mode, pendingModeSwitch: null, metricsManager, subagentTracker });
    ws.activeSessionId = sessionId;

    piProcess.on("error", (err) => {
      sendLog(ws, `[Pi Spawning Failed] ${err.message}`, false);
    });

    let accumulatedText = "";
    let accumulatedThinking = "";
    let stdoutBuffer = "";
    let lastSpokenTextLength = 0;
    let ttsAccumulator = "";  // Only captures content inside <tts> tags
    
    // Reference to the session entry (with metrics & subagent tracker)
    const getSessionEntry = () => activeSessions.get(sessionId);

    piProcess.stdout.on("data", (data) => {
      stdoutBuffer += data.toString();
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const item = JSON.parse(line);

          if (item.type === "message_update") {
            const ev = item.assistantMessageEvent;
            if (ev.type === "text_delta") {
              accumulatedText += ev.delta;
              let cleanStreamText = accumulatedText.replace(/<tts>[\s\S]*?$/gi, "").replace(/<tts>[\s\S]*?<\/tts>/gi, "").trim();
              sendWithSession(ws, { type: "message", role: "assistant", content: cleanStreamText });
              
              // Track output tokens via metrics manager
              metricsManager.recordInputTokens(sessionId, ev.delta);
              
              // Extract any <tts>...</tts> content or fallback to cleanStreamText
              const ttsTagMatch = accumulatedText.match(/<tts>([\s\S]*?)<\/tts>/i);
              let activeTtsContent = "";
              if (ttsTagMatch) {
                activeTtsContent = ttsTagMatch[1].trim();
              } else {
                activeTtsContent = cleanStreamText;
              }

              if (activeTtsContent && activeTtsContent !== ttsAccumulator) {
                const appended = activeTtsContent.slice(ttsAccumulator.length).trim();
                if (appended.length > 3) {
                  const sentenceRegex = /[.!?](?:\s|$)/g;
                  let match;
                  let lastEnd = 0;
                  while ((match = sentenceRegex.exec(appended)) !== null) {
                    const sentence = appended.slice(lastEnd, match.index + 1).trim();
                    if (sentence.length > 2) {
                      sendWithSession(ws, { type: "speech_sentence", content: sentence });
                    }
                    lastEnd = match.index + 1;
                  }
                }
                ttsAccumulator = activeTtsContent;
              }
            } 
            else if (ev.type === "thinking_delta") {
              accumulatedThinking += ev.delta;
              // Track reasoning tokens via metrics manager
              metricsManager.recordReasoning(sessionId, estimateTokens(ev.delta));
              const cleanThinking = stripTuiChars(accumulatedThinking);
              sendWithSession(ws, { type: "plan", content: cleanThinking });
              sendWithSession(ws, { type: "reasoning_update", content: cleanThinking });
            }
          } 
          else if (item.type === "tool_call_start" || item.type === "tool_execution_start") {
            const tc = item.toolCall || item;
            const toolName = tc.name || tc.toolName || "";
            const argsStr = JSON.stringify(tc.arguments || {});
            const toolCallId = tc.id || tc.toolCallId;
            
            sendLog(ws, `[Tool Call] ${toolName} ${argsStr}`);
            
            // Track tool call via metrics manager (for latency + counts)
            metricsManager.startToolCall(sessionId, toolCallId, toolName);
            metricsManager.setToolCallArgs(sessionId, toolCallId, tc.arguments);
            
            sendWithSession(ws, {
              type: "tool_start",
              toolCallId,
              name: toolName,
              arguments: tc.arguments
            });
            
            // Track subagent spawns
            if (toolName === "subagent") {
              const saPrompt = (tc.arguments && (tc.arguments.prompt || tc.arguments.task)) || "Task execution";
              const subagentName = "Subagent (" + (saPrompt.substring(0, 24) + (saPrompt.length > 24 ? "..." : "")) + ")";
              const saId = tc.id || tc.toolCallId;
              const inheritedMode = (mode || "chat");
              const sesEntry = getSessionEntry();
              
              sendLog(ws, `[Subagent Spawn] Mode="${inheritedMode}" inherited by subagent.`, false);
              
              // Register via subagent tracker
              if (sesEntry && sesEntry.subagentTracker) {
                sesEntry.subagentTracker.spawnAgent(
                  saId, 
                  subagentName, 
                  null, // parentId — main agent
                  inheritedMode,
                  saPrompt
                );
                sesEntry.subagentTracker.setStatus(saId, STATUS.WORKING);
              }
              
              // Also register in metrics manager
              metricsManager.addSubagent(sessionId, {
                id: saId,
                name: subagentName,
                parentId: null,
                status: "working",
                mode: inheritedMode
              });
            }
            
            // MODE ENFORCEMENT
            const isMutating = isMutatingTool(toolName);
            const isReadOnly = isReadOnlyTool(toolName);
            
            let blockTool = false;
            let suggestedMode = "";
            let blockReason = "";
            
            if (!mode || mode === "chat") {
              blockTool = true;
              suggestedMode = isMutating ? "edit" : "plan";
              blockReason = `The agent tried to use the "${toolName}" tool, but the current session is in Chat mode. Chat mode is for free conversation only. Please switch to ${suggestedMode.toUpperCase()} mode to run this tool.`;
            } else if (mode === "plan") {
              if (isMutating) {
                blockTool = true;
                suggestedMode = "edit";
                blockReason = `The agent tried to run a write/execution operation ("${toolName}"), but you are in Plan mode. Only read-only tools are allowed in Plan mode. Please switch to EDIT mode to allow modifications.`;
              }
            }
            
            if (blockTool) {
              sendLog(ws, `[Mode Enforcement] Blocked "${toolName}" tool execution in current mode "${mode || "chat"}". Suggesting switch to "${suggestedMode}".`, false);
              
              // Save pending mode switch so frontend can re-run with correct mode
              const sessionEntry = activeSessions.get(sessionId);
              if (sessionEntry) {
                sessionEntry.pendingModeSwitch = { 
                  mode: suggestedMode, 
                  reason: blockReason, 
                  toolName,
                  prompt: ws.currentPrompt || ""
                };
              }
              
              sendWithSession(ws, {
                type: "mode_suggestion",
                mode: suggestedMode,
                reason: blockReason
              });
              
              if (piProcess) {
                console.log(`Gracefully terminating agent session ${sessionId} due to mode restriction...`);
                try { piProcess.kill("SIGINT"); } catch (e) {}
                activeSessions.delete(sessionId);
              }
              sendStatus(ws, "done");
              continue;
            }
            
            // EDIT MODE DIRECTORY PERMISSION CHECK
            if (mode === "edit") {
              const toolPaths = extractPathsFromArgs(tc.arguments);
              if (toolPaths.length > 0) {
                const sessionPerms = sessionAllowedPaths.get(sessionId) || new Set();
                const outsidePaths = toolPaths.filter(p => !isPathAllowed(p, PROJECT_ROOT));
                if (outsidePaths.length > 0) {
                  const unresolvedPaths = outsidePaths.filter(p => {
                    const resolved = resolveTargetPath(p);
                    return !sessionPerms.has(resolved);
                  });
                  if (unresolvedPaths.length > 0) {
                    sendLog(ws, `[Edit Mode] Tool "${toolName}" accessing path(s) outside safe zone: ${unresolvedPaths.join(", ")}`, false);
                    sendWithSession(ws, {
                      type: "edit_permission_request",
                      toolCallId: tc.id || tc.toolCallId,
                      toolName: toolName,
                      paths: unresolvedPaths,
                      outsidePaths: unresolvedPaths,
                      safeZone: PROJECT_ROOT
                    });
                  }
                }
              }
            }
          } 
          else if (item.type === "tool_call_end" || item.type === "tool_execution_end") {
            const tc = item.toolCall || item;
            const toolName = tc.name || tc.toolName || "";
            const toolCallId = tc.id || tc.toolCallId;
            
            sendLog(ws, `[Tool Done] Finished ${toolName}`);
            
            const resultStr = typeof item.result === "string" ? item.result : JSON.stringify(item.result || "");
            
            // Track tool completion via metrics manager
            metricsManager.endToolCall(sessionId, toolCallId, toolName, resultStr);
            
            sendWithSession(ws, {
              type: "tool_end",
              toolCallId,
              name: toolName,
              result: item.result
            });
            
            // Track subagent completion via subagent tracker
            if (toolName === "subagent") {
              const sesEntry = getSessionEntry();
              if (sesEntry && sesEntry.subagentTracker) {
                sesEntry.subagentTracker.markCompleted(toolCallId, resultStr);
              }
              metricsManager.completeSubagent(sessionId, toolCallId, resultStr);
            }
            
            // Track subagent tool calls (when subagentId is present)
            if (item.subagentId) {
              const sesEntry = getSessionEntry();
              if (sesEntry && sesEntry.subagentTracker) {
                sesEntry.subagentTracker.endToolCall(item.subagentId, toolCallId, resultStr);
              }
              metricsManager.addSubagentToolCall(sessionId, item.subagentId, toolName, null, resultStr, 0);
            }
            
            // Send metrics update to frontend
            const sesEntry2 = getSessionEntry();
            if (sesEntry2 && sesEntry2.subagentTracker) {
              sendWithSession(ws, {
                type: "subagent_metrics",
                subagents: sesEntry2.subagentTracker.toFrontendSummary(),
                ...metricsManager.toFrontendUpdate(sessionId)
              });
            }
          }
          else if (item.type === "subagent_update") {
            const sesEntry = getSessionEntry();
            if (!sesEntry || !sesEntry.subagentTracker) continue;
            
            if (item.subagentId) {
              if (item.reasoning) {
                sesEntry.subagentTracker.addReasoning(item.subagentId, item.reasoning, item.tokens || 0);
                sesEntry.subagentTracker.markReasoning(item.subagentId);
              }
              if (item.tokens) {
                metricsManager.addSubagentReasoning(sessionId, item.subagentId, "", item.tokens);
              }
              if (item.status) {
                sesEntry.subagentTracker.setStatus(item.subagentId, item.status);
              }
              
              sendWithSession(ws, {
                type: "subagent_metrics",
                subagents: sesEntry.subagentTracker.toFrontendSummary(),
                ...metricsManager.toFrontendUpdate(sessionId)
              });
            }
          }
          else if (item.type === "mode_suggestion") {
            sendWithSession(ws, {
              type: "mode_suggestion",
              mode: item.mode,
              reason: item.reason || ""
            });
          }
          else if (item.type === "reasoning_update") {
            sendWithSession(ws, {
              type: "reasoning_update",
              content: stripTuiChars(item.content)
            });
          }
          else if (item.type === "agent_end") {
            sendLog(ws, "Agent prompt turn completed.");

            const ttsMatch = accumulatedText.match(/<tts>([\s\S]*?)<\/tts>/i);
            let ttsText = "";
            let cleanFinalText = accumulatedText.replace(/<tts>[\s\S]*?<\/tts>/gi, "").trim();

            sendWithSession(ws, { type: "message", role: "assistant", content: cleanFinalText });
            
            if (ttsMatch) {
              ttsText = ttsMatch[1].trim();
            } else {
              ttsText = cleanFinalText;
            }

            const userPrompt = ws.currentPrompt || "General assistant query";
            if (ttsText && (ttsText.length > 50 || ttsText.includes("`") || ttsText.includes("\n") || ttsText.includes("*") || ttsText.includes("#"))) {
              generateIntelligentSpeech(userPrompt, cleanFinalText).then(summary => {
                if (summary) {
                  sendWithSession(ws, { type: "intelligent_speech", content: summary });
                } else {
                  sendWithSession(ws, { type: "intelligent_speech", content: ttsText });
                }
              });
            } else if (ttsText) {
              sendWithSession(ws, { type: "intelligent_speech", content: ttsText });
            }

            accumulatedText = "";
            accumulatedThinking = "";
            lastSpokenTextLength = 0;
            ttsAccumulator = "";

            sendStatus(ws, "done");
          }
        } catch (e) {
          console.log(`[Pi Out Parse Error] ${line}`);
        }
      }
    });

    piProcess.stderr.on("data", (data) => {
      const errStr = data.toString().trim();
      if (errStr) {
        sendLog(ws, `[Pi Stderr] ${errStr}`, false);
      }
    });

    // ── Periodic metrics autosave ──
    const metricsAutoSave = setInterval(() => {
      const ses = activeSessions.get(sessionId);
      if (!ses) {
        clearInterval(metricsAutoSave);
        return;
      }
      try {
        const persistable = metricsManager.toPersistable(sessionId);
        const existingSession = db.getSession(sessionId);
        if (existingSession) {
          db.saveSession({ ...existingSession, metrics: persistable });
        }
      } catch (e) {
        // Silently handle - not critical
      }
    }, 30000); // Every 30 seconds

    piProcess.on("close", (code) => {
      console.log(`Pi CLI session for ${sessionId} exited with code ${code}`);
      
      // Clear autosave interval
      clearInterval(metricsAutoSave);
      
      // Persist final metrics to DB before cleanup
      try {
        const persistable = metricsManager.toPersistable(sessionId);
        const existingSession = db.getSession(sessionId);
        if (existingSession) {
          db.saveSession({ ...existingSession, metrics: persistable });
          console.log(`[Metrics] Persisted final metrics for session ${sessionId}: ${persistable.tokens.total} tokens, ${persistable.toolCalls.total} tool calls`);
        }
      } catch (e) {
        console.error(`[Metrics] Error persisting session ${sessionId} metrics:`, e.message);
      }
      
      activeSessions.delete(sessionId);
      sendStatus(ws, "done");
      
      // Release metrics resources after a short delay
      setTimeout(() => {
        metricsManager.releaseSession(sessionId);
      }, 5000);
    });

  } catch (error) {
    sendStatus(ws, "error");
    sendLog(ws, `Fatal error spawning agent session: ${error.message}`, false);
  }
}

function isConversationalPrompt(prompt) {
  if (!prompt || typeof prompt !== "string") return false;
  const conversationalPhrases = [
    /^\s*hello\s*$/i,
    /^\s*hi\s*$/i,
    /^\s*hey\s*$/i,
    /^\s*yo\s*$/i,
    /^\s*howdy\s*$/i,
    /^\s*sup\s*$/i,
    /^\s*greetings\s*$/i,
    /^\s*good\s+(morning|afternoon|evening)\s*$/i,
    /^\s*thank(s|\s*you)\s*$/i,
    /^\s*bye\s*$/i,
    /^\s*goodbye\s*$/i
  ];
  return conversationalPhrases.some(regex => regex.test(prompt));
}

// Send prompt to the persistent background agent session
async function sendPromptToAgent(ws, userPrompt, sessionId, mode, systemPromptType) {
  // Set ws.activeSessionId BEFORE any sendLog/sendStatus calls so events are properly routed
  // This must ALWAYS be set, even if switching from another session
  ws.activeSessionId = sessionId;
  
  let sessionItem = activeSessions.get(sessionId);
  if (!sessionItem || !sessionItem.piProcess) {
    sendLog(ws, `No active agent session for ${sessionId}. Spawning now...`, false, sessionId);
    await spawnAgentSession(ws, sessionId, mode, systemPromptType);
    sessionItem = activeSessions.get(sessionId);
  }

  try {
    const reasoningModel = securityConfig.litellm.selectedReasoningModel;
    const taskMode = securityConfig.litellm.taskMode;

    ws.currentPrompt = userPrompt;
    
    // ── CHAT MODE PRE-CHECK ──
    // If in Chat mode, check if the prompt likely needs tools before spawning an agent.
    // Chat mode is for free conversation only. If tools are needed, suggest switching.
    if (!mode || mode === "chat") {
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
          reason: `Your prompt "${userPrompt.substring(0, 60)}${userPrompt.length > 60 ? '...' : ''}" appears to need tool execution, but you're in Chat mode which only allows free conversation. Please switch to ${suggestedMode.toUpperCase()} mode to proceed.`
        }, sessionId);
        sendStatus(ws, "done", sessionId);
        return;
      }
    }
    
    sendStatus(ws, "thinking", sessionId);
    sendLog(ws, `Processing prompt: "${userPrompt}"`, true, sessionId);

    // 1. Orchestrate planning if hybrid mode is active AND we are not in Chat mode AND the prompt is not a simple greeting
    const isChat = !mode || mode === "chat";
    if (taskMode === "hybrid" && !isChat && !isConversationalPrompt(userPrompt)) {
      sendLog(ws, `Asking Reasoning Model (${reasoningModel}) to construct a TUI execution plan...`, true, sessionId);
      
      const planPrompt = `You are a reasoning and planning assistant.
Given the following user request, generate a detailed step-by-step plan to achieve it.
You MUST format the output to look like a retro TUI (Terminal User Interface) console dashboard.
Use box-drawing characters (e.g. ┌, ─, ┐, │, ├, ┤, └) to frame the sections nicely, and include retro status badges like [WAITING], [TODO], [RUNNING], etc.
Make it fit for display in a monospace terminal box.
Do not use tools.
User request: ${userPrompt}`;

      try {
        const openai = getOpenAIClient();
        const planCompletion = await openai.chat.completions.create({
          model: reasoningModel,
          messages: [{ role: "user", content: planPrompt }]
        });
        
        const rawPlan = planCompletion.choices[0].message.content;
        const executionPlan = stripTuiChars(rawPlan);
        sendLog(ws, `TUI execution plan generated successfully.`, true, sessionId);
        sendWithSession(ws, { type: "plan", content: executionPlan }, sessionId);
        sendWithSession(ws, { type: "reasoning_update", content: executionPlan }, sessionId);
      } catch (planError) {
        sendLog(ws, `Plan generation failed: ${planError.message}. Proceeding without plan.`, false, sessionId);
      }
    }

    sendStatus(ws, "executing", sessionId);
    sessionItem.piProcess.stdin.write(JSON.stringify({ type: "prompt", message: userPrompt }) + "\n");

  } catch (error) {
    sendStatus(ws, "error", sessionId);
    sendLog(ws, `Error sending prompt to agent: ${error.message}`, false, sessionId);
  }
}

// Active WebSocket connections
wss.on("connection", (ws) => {
  console.log("Dashboard client connected to WebSocket.");

  ws.on("message", async (messageStr) => {
    try {
      const data = JSON.parse(messageStr);
      
      if (data.type === "start_task") {
        const { prompt, sessionId, mode, systemPromptType } = data;
        const sid = sessionId || "default-session";
        
        // ── Kill ALL OTHER active sessions on THIS WebSocket before starting ──
        // This prevents session cross-contamination when user switches sessions
        for (const [existingId, session] of activeSessions.entries()) {
          if (existingId !== sid && session.ws === ws) {
            console.log(`[Session Isolation] Killing other session ${existingId} on this WebSocket before starting ${sid}...`);
            try {
              session.piProcess.kill("SIGINT");
            } catch (e) {
              console.error(`Error killing session ${existingId}:`, e);
            }
            activeSessions.delete(existingId);
          }
        }
        
        sendPromptToAgent(ws, prompt, sid, mode, systemPromptType);
      }
      
      if (data.type === "approval_response") {
        const { toolCallId, approved } = data;
        const resolve = pendingApprovals.get(toolCallId);
        if (resolve) {
          pendingApprovals.delete(toolCallId);
          resolve(approved);
        }
      }
      
      if (data.type === "edit_permission_response") {
        // User responded to an Edit mode directory permission request
        const { toolCallId, decision, path: permPath, sessionId: permSessionId } = data;
        const sid = permSessionId || ws.activeSessionId;
        sendLog(ws, `[Edit Mode] Permission for "${permPath || "unknown"}": ${decision}`, false);
        
        if (decision === "allow_session" && permPath) {
          // Add to session-level allowed paths
          if (!sessionAllowedPaths.has(sid)) {
            sessionAllowedPaths.set(sid, new Set());
          }
          sessionAllowedPaths.get(sid).add(resolveTargetPath(permPath));
          sendLog(ws, `[Edit Mode] Path saved for session: ${resolveTargetPath(permPath)}`, false);
        }
        
        // Resolve any pending approval for this tool call
        const resolve = pendingApprovals.get(toolCallId);
        if (resolve) {
          pendingApprovals.delete(toolCallId);
          resolve(decision === "allow_once" || decision === "allow_session");
        }
      }

      if (data.type === "compact") {
        const sessionItem = activeSessions.get(data.sessionId || ws.activeSessionId);
        if (sessionItem && sessionItem.piProcess) {
          console.log(`[RPC] Triggering manual context compaction on session ${data.sessionId || ws.activeSessionId}...`);
          sessionItem.piProcess.stdin.write(JSON.stringify({ id: `compact-${Date.now()}`, type: "compact" }) + "\n");
        }
      }

      if (data.type === "set_auto_compaction") {
        const sessionItem = activeSessions.get(data.sessionId || ws.activeSessionId);
        if (sessionItem && sessionItem.piProcess) {
          console.log(`[RPC] Setting auto compaction to ${data.enabled} on session ${data.sessionId || ws.activeSessionId}`);
          sessionItem.piProcess.stdin.write(JSON.stringify({ id: `autocompact-${Date.now()}`, type: "set_auto_compaction", enabled: data.enabled }) + "\n");
        }
      }

      if (data.type === "mode_switch") {
        // User switched mode mid-chat — respawn the agent with new mode
        const { sessionId, mode } = data;
        console.log(`[Mode Switch] Switching session ${sessionId || ws.activeSessionId} to mode: ${mode}`);
        // Kill existing session and spawn new one with the new mode
        const existing = activeSessions.get(sessionId || ws.activeSessionId);
        if (existing && existing.piProcess) {
          try {
            existing.piProcess.kill("SIGINT");
          } catch (e) {
            console.error("Error killing process on mode switch:", e);
          }
          activeSessions.delete(sessionId || ws.activeSessionId);
        }
        sendLog(ws, `[Mode Switch] Session switched to "${mode || "chat"}". Next prompt will use new behavior.`, false);
      }

      if (data.type === "cancel") {
        const sessionItem = activeSessions.get(data.sessionId || ws.activeSessionId);
        if (sessionItem && sessionItem.piProcess) {
          console.log(`[RPC] Cancelling/Interrupting session ${data.sessionId || ws.activeSessionId}...`);
          try {
            sessionItem.piProcess.kill("SIGINT");
          } catch (e) {
            console.error("Error cancelling process:", e);
          }
          activeSessions.delete(data.sessionId || ws.activeSessionId);
        }
      }

      if (data.type === "cancel_session") {
        // Specifically cancel a session by ID (used when user switches away from a session)
        const { sessionId } = data;
        if (!sessionId) {
          console.warn("[cancel_session] No sessionId provided");
          return;
        }
        const sessionItem = activeSessions.get(sessionId);
        if (sessionItem && sessionItem.piProcess) {
          console.log(`[Session Switch] Killing agent process for session ${sessionId}...`);
          try {
            sessionItem.piProcess.kill("SIGINT");
          } catch (e) {
            console.error(`Error killing session ${sessionId} process:`, e);
          }
          activeSessions.delete(sessionId);
          sendLog(ws, `[Session Switch] Session ${sessionId} process terminated.`, false);
        } else {
          console.log(`[Session Switch] No active process for session ${sessionId} to kill.`);
        }
      }

      if (data.type === "mode_switch_rerun") {
        // User clicked "Switch & Re-run" on a mode suggestion
        // Kill existing session, set new mode, re-send the last prompt
        const { sessionId, mode, prompt, systemPromptType } = data;
        const sid = sessionId || ws.activeSessionId;
        console.log(`[Mode Switch Rerun] Switching session ${sid} to mode: ${mode}`);
        
        // Kill existing process
        const existing = activeSessions.get(sid);
        if (existing && existing.piProcess) {
          try { existing.piProcess.kill("SIGINT"); } catch (e) {}
          activeSessions.delete(sid);
        }
        
        // Re-send prompt with new mode
        if (prompt) {
          sendLog(ws, `[Mode Switch Rerun] Re-sending prompt "${prompt.substring(0, 60)}..." with mode "${mode}"`, false);
          await sendPromptToAgent(ws, prompt, sid, mode, systemPromptType);
        } else {
          sendLog(ws, `[Mode Switch Rerun] Mode switched to "${mode || "chat"}" (no prompt to re-run).`, false);
        }
      }
    } catch (err) {
      console.error("WebSocket message error:", err);
      sendWithSession(ws, { type: "error", message: err.message });
    }
  });

  ws.on("close", () => {
    console.log("Dashboard client disconnected.");
    // Kill ALL active processes AND persist metrics for each session
    for (const [sid, session] of activeSessions.entries()) {
      if (session.ws === ws) {
        // Persist final metrics to DB
        try {
          const persistable = metricsManager.toPersistable(sid);
          const existingSession = db.getSession(sid);
          if (existingSession) {
            db.saveSession({ ...existingSession, metrics: persistable });
          }
        } catch (e) {
          console.error(`[Metrics] Error persisting session ${sid} on close:`, e.message);
        }
        
        console.log(`Killing active agent process for session ${sid} on WebSocket close...`);
        if (session.piProcess) {
          try {
            session.piProcess.kill("SIGINT");
          } catch (e) {
            console.error(`Error killing agent process for ${sid} on close:`, e);
          }
        }
        activeSessions.delete(sid);
        metricsManager.releaseSession(sid);
      }
    }
  });
});

/**
 * Runs a local shell command safely inside a Promise
 */
function runShellCommand(cmd) {
  return new Promise((resolve) => {
    // Execute command with a timeout of 60 seconds
    exec(cmd, { timeout: 60000, cwd: path.join(__dirname, "../") }, (error, stdout, stderr) => {
      let output = "";
      if (stdout) output += stdout;
      if (stderr) output += `[Stderr]\n${stderr}`;
      if (error) output += `\n[Process Exited with Code ${error.code}]`;
      resolve(output || "[Command completed with no output]");
    });
  });
}

// Start server
server.listen(PORT, () => {
  console.log(`AegisAgent Backend Server listening on port ${PORT}`);
});
