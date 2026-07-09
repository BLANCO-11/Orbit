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
app.use(express.json());
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
          content: `🔔 Proactive Notify [${(severity || "info").toUpperCase()}]: ${title} - ${message}`,
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

// Active WebSocket helper
const sendLog = (ws, content, isSystem = true) => {
  console.log(`[Log] ${ws ? "" : "[Global] "}${content}`);
  if (ws) {
    ws.send(JSON.stringify({ type: "log", content, isSystem }));
  }
};

const sendStatus = (ws, status) => {
  if (ws) {
    ws.send(JSON.stringify({ type: "status", status }));
  }
};

// Spawn a persistent, long-running agent session in RPC mode mapped by sessionId
async function spawnAgentSession(ws, sessionId) {
  try {
    const normalModel = securityConfig.litellm.selectedNormalModel;
    const apiKey = securityConfig.litellm.apiKey;
    const promptFile = "standard.md";
    const selectedPromptPath = path.join(__dirname, "../prompts", promptFile);

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
      OPENAI_API_KEY: apiKey
    };

    const piArgs = [
      "--session-id", sessionId,
      "--provider", "litellm",
      "--model", `litellm/${normalModel}`,
      "--mode", "rpc",
      "--system-prompt", `@${selectedPromptPath}`
    ];

    const nodePath = "/home/blanco/.local/share/pi-node/node-v22.22.3-linux-x64/bin/node";
    const piPath = "/home/blanco/.local/share/pi-node/node-v22.22.3-linux-x64/bin/pi";
    const spawnArgs = [piPath, ...piArgs];

    console.log(`[Spawn] Spawning persistent agent session for ${sessionId}: ${nodePath} ${spawnArgs.join(" ")}`);
    const piProcess = spawn(nodePath, spawnArgs, {
      env: childEnv,
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe']
    });

    activeSessions.set(sessionId, { piProcess, ws });
    ws.activeSessionId = sessionId;

    piProcess.on("error", (err) => {
      sendLog(ws, `[Pi Spawning Failed] ${err.message}`, false);
    });

    let accumulatedText = "";
    let accumulatedThinking = "";
    let stdoutBuffer = "";

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
              ws.send(JSON.stringify({ type: "message", role: "assistant", content: cleanStreamText }));
            } 
            else if (ev.type === "thinking_delta") {
              accumulatedThinking += ev.delta;
              ws.send(JSON.stringify({ type: "plan", content: accumulatedThinking }));
            }
          } 
          else if (item.type === "tool_call_start" || item.type === "tool_execution_start") {
            const tc = item.toolCall || item;
            sendLog(ws, `[Tool Call] ${tc.name || tc.toolName} ${JSON.stringify(tc.arguments || {})}`);
            ws.send(JSON.stringify({
              type: "tool_start",
              toolCallId: tc.id || tc.toolCallId,
              name: tc.name || tc.toolName,
              arguments: tc.arguments
            }));
          } 
          else if (item.type === "tool_call_end" || item.type === "tool_execution_end") {
            const tc = item.toolCall || item;
            sendLog(ws, `[Tool Done] Finished ${tc.name || tc.toolName}`);
            ws.send(JSON.stringify({
              type: "tool_end",
              toolCallId: tc.id || tc.toolCallId,
              name: tc.name || tc.toolName,
              result: item.result
            }));
          }
          else if (item.type === "agent_end") {
            sendLog(ws, "Agent prompt turn completed.");

            // Parse TTS tags from accumulated text
            const ttsMatch = accumulatedText.match(/<tts>([\s\S]*?)<\/tts>/i);
            let ttsText = "";
            let cleanFinalText = accumulatedText;
            
            if (ttsMatch) {
              ttsText = ttsMatch[1].trim();
              cleanFinalText = accumulatedText.replace(/<tts>[\s\S]*?<\/tts>/gi, "").trim();
            } else {
              cleanFinalText = accumulatedText;
              ttsText = accumulatedText;
            }

            ws.send(JSON.stringify({ type: "message", role: "assistant", content: cleanFinalText }));
            
            const userPrompt = ws.currentPrompt || "General assistant query";
            if (ttsText && ttsText.length > 150) {
              generateIntelligentSpeech(userPrompt, cleanFinalText).then(summary => {
                if (summary) {
                  ws.send(JSON.stringify({ type: "intelligent_speech", content: summary }));
                } else {
                  ws.send(JSON.stringify({ type: "intelligent_speech", content: ttsText }));
                }
              });
            } else if (ttsText) {
              ws.send(JSON.stringify({ type: "intelligent_speech", content: ttsText }));
            }

            accumulatedText = "";
            accumulatedThinking = "";

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

    piProcess.on("close", (code) => {
      console.log(`Pi CLI session for ${sessionId} exited with code ${code}`);
      activeSessions.delete(sessionId);
      sendStatus(ws, "done");
    });

  } catch (error) {
    sendStatus(ws, "error");
    sendLog(ws, `Fatal error spawning agent session: ${error.message}`, false);
  }
}

// Send prompt to the persistent background agent session
async function sendPromptToAgent(ws, userPrompt, sessionId) {
  let sessionItem = activeSessions.get(sessionId);
  if (!sessionItem || !sessionItem.piProcess) {
    sendLog(ws, `No active agent session for ${sessionId}. Spawning now...`, false);
    await spawnAgentSession(ws, sessionId);
    sessionItem = activeSessions.get(sessionId);
  }

  try {
    const reasoningModel = securityConfig.litellm.selectedReasoningModel;
    const taskMode = securityConfig.litellm.taskMode;

    ws.currentPrompt = userPrompt;
    sendStatus(ws, "thinking");
    sendLog(ws, `Processing prompt: "${userPrompt}"`);

    // 1. Orchestrate planning if hybrid mode is active
    if (taskMode === "hybrid") {
      sendLog(ws, `Asking Reasoning Model (${reasoningModel}) to construct a TUI execution plan...`);
      
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
        
        const executionPlan = planCompletion.choices[0].message.content;
        sendLog(ws, `TUI execution plan generated successfully.`);
        ws.send(JSON.stringify({ type: "plan", content: executionPlan }));
      } catch (planError) {
        sendLog(ws, `Plan generation failed: ${planError.message}. Proceeding without plan.`, false);
      }
    }

    sendStatus(ws, "executing");
    sessionItem.piProcess.stdin.write(JSON.stringify({ type: "prompt", message: userPrompt }) + "\n");

  } catch (error) {
    sendStatus(ws, "error");
    sendLog(ws, `Error sending prompt to agent: ${error.message}`, false);
  }
}

// Active WebSocket connections
wss.on("connection", (ws) => {
  console.log("Dashboard client connected to WebSocket.");

  ws.on("message", async (messageStr) => {
    try {
      const data = JSON.parse(messageStr);
      
      if (data.type === "start_task") {
        const { prompt, sessionId } = data;
        sendPromptToAgent(ws, prompt, sessionId || "default-session");
      }
      
      if (data.type === "approval_response") {
        const { toolCallId, approved } = data;
        const resolve = pendingApprovals.get(toolCallId);
        if (resolve) {
          pendingApprovals.delete(toolCallId);
          resolve(approved);
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

      if (data.type === "cancel") {
        const sessionItem = activeSessions.get(data.sessionId || ws.activeSessionId);
        if (sessionItem && sessionItem.piProcess) {
          console.log(`[RPC] Cancelling/Interrupting session ${data.sessionId || ws.activeSessionId}...`);
          try {
            sessionItem.piProcess.kill("SIGINT");
          } catch (e) {
            console.error("Error cancelling process:", e);
          }
        }
      }
    } catch (err) {
      console.error("WebSocket message error:", err);
      ws.send(JSON.stringify({ type: "error", message: err.message }));
    }
  });

  ws.on("close", () => {
    console.log("Dashboard client disconnected.");
    if (ws.activeSessionId) {
      const sessionItem = activeSessions.get(ws.activeSessionId);
      if (sessionItem && sessionItem.piProcess) {
        console.log(`Killing active agent process for session ${ws.activeSessionId} on close...`);
        try {
          sessionItem.piProcess.kill("SIGINT");
        } catch (e) {
          console.error("Error killing agent process on close:", e);
        }
        activeSessions.delete(ws.activeSessionId);
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
