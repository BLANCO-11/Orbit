// agent-backend/harnesses/picode/index.js
// PiCodeHarness — wraps the Pi CLI agent process
// Implements HarnessInterface and emits standardized events

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const EventEmitter = require("events");
const HarnessInterface = require("../interface");
const { stripTuiChars, isMutatingTool, isReadOnlyTool, isConversationalPrompt } = require("./parser");

class PiCodeHarness extends HarnessInterface {
  constructor(options) {
    super(options);
    this.piProcess = null;
    this.accumulatedText = "";
    this.accumulatedThinking = "";
    this.stdoutBuffer = "";
    this.ttsAccumulator = "";
  }

  getMetadata() {
    return {
      name: "PiCode",
      version: "1.0.0",
      capabilities: ["chat", "plan", "edit", "yolo", "subagents", "tools", "browser"],
    };
  }

  async connect() {
    const activeMode = this.mode;
    const activePromptType = this.systemPromptType || this.config.systemPromptType || "standard";
    const normalModel = this.config.litellm.selectedNormalModel;
    const apiKey = this.config.litellm.apiKey;
    
    // Select and combine prompt files
    const basePromptFile = (activePromptType === "fable-5") ? "claude-fable-5.md" : "standard.md";
    
    let modePromptFile = null;
    if (activeMode === "plan") modePromptFile = "plan-mode.md";
    else if (activeMode === "edit") modePromptFile = "edit-mode.md";
    else if (activeMode === "yolo") modePromptFile = "yolo-mode.md";
    
    const promptsDir = path.join(__dirname, "../../../prompts");
    const basePrompt = fs.readFileSync(path.join(promptsDir, basePromptFile), "utf-8");
    let combinedPrompt = basePrompt;
    
    if (modePromptFile) {
      const modePrompt = fs.readFileSync(path.join(promptsDir, modePromptFile), "utf-8");
      combinedPrompt = combinedPrompt + "\n\n" + modePrompt;
    }
    
    // Write combined prompt to temp file
    const tempPromptDir = path.join(__dirname, "../../../workspace/temp");
    if (!fs.existsSync(tempPromptDir)) {
      fs.mkdirSync(tempPromptDir, { recursive: true });
    }
    const tempPromptPath = path.join(tempPromptDir, `system-prompt-${this.sessionId}.md`);
    fs.writeFileSync(tempPromptPath, combinedPrompt, "utf-8");
    
    const childEnv = {
      ...process.env,
      LITELLM_KEY: apiKey,
      OPENAI_API_KEY: apiKey,
      AEGIS_MODE: activeMode || "chat"
    };
    
    const piArgs = [
      "--session-id", this.sessionId,
      "--provider", "litellm",
      "--model", `litellm/${normalModel}`,
      "--mode", "rpc",
      "--system-prompt", combinedPrompt,
    ];
    
    const nodePath = (this.binaries && this.binaries.nodePath) || "node";
    const piPath = (this.binaries && this.binaries.piPath) || "pi";
    const spawnArgs = [piPath, ...piArgs];
    
    console.log(`[PiCodeHarness] Spawning: ${nodePath} ${spawnArgs.join(" ")}`);
    
    this.piProcess = spawn(nodePath, spawnArgs, {
      env: childEnv,
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    this.piProcess.on("error", (err) => {
      console.error(`[PiCodeHarness] Spawn failed: ${err.message}`);
      this.events.emit("error", { message: `Failed to spawn Pi: ${err.message}` });
    });
    
    this._setupStdout();
    this._setupStderr();
    
    this.piProcess.on("close", (code) => {
      console.log(`[PiCodeHarness] Process exited with code ${code}`);
      // Clean up temp prompt file
      fs.unlink(tempPromptPath, () => {});
      this.events.emit("close", { code });
    });
  }
  
  _setupStdout() {
    this.piProcess.stdout.on("data", (data) => {
      this.stdoutBuffer += data.toString();
      const lines = this.stdoutBuffer.split("\n");
      this.stdoutBuffer = lines.pop();
      
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const item = JSON.parse(line);
          this._handleStdoutItem(item);
        } catch (e) {
          // Non-JSON line — ignore gracefully
        }
      }
    });
  }
  
  _handleStdoutItem(item) {
    if (item.type === "message_update") {
      const ev = item.assistantMessageEvent;
      if (ev.type === "text_delta") {
        this.accumulatedText += ev.delta;
        this.events.emit("text_delta", { delta: ev.delta });
        this.events.emit("accumulated_text", { text: this.accumulatedText });
      } else if (ev.type === "thinking_delta") {
        this.accumulatedThinking += ev.delta;
        const cleanThinking = stripTuiChars(this.accumulatedThinking);
        this.events.emit("thinking_delta", { delta: ev.delta });
        this.events.emit("accumulated_thinking", { text: cleanThinking });
      }
      return;
    }
    
    if (item.type === "tool_call_start" || item.type === "tool_execution_start") {
      const tc = item.toolCall || item;
      this.events.emit("tool_call_start", {
        id: tc.id || tc.toolCallId,
        name: tc.name || tc.toolName || "",
        arguments: tc.arguments || {},
        subagentId: item.subagentId || null,
      });
      return;
    }
    
    if (item.type === "tool_call_end" || item.type === "tool_execution_end") {
      const tc = item.toolCall || item;
      this.events.emit("tool_call_end", {
        id: tc.id || tc.toolCallId,
        name: tc.name || tc.toolName || "",
        result: item.result || null,
        subagentId: item.subagentId || null,
      });
      return;
    }
    
    if (item.type === "subagent_update") {
      if (item.reasoning) {
        this.events.emit("subagent_reasoning", {
          subagentId: item.subagentId,
          delta: item.reasoning,
          tokens: item.tokens || 0,
        });
      }
      if (item.status) {
        this.events.emit("subagent_status", {
          subagentId: item.subagentId,
          status: item.status,
        });
      }
      return;
    }
    
    if (item.type === "agent_end") {
      this.events.emit("agent_end", {
        accumulatedText: this.accumulatedText,
        accumulatedThinking: this.accumulatedThinking,
      });
      this.accumulatedText = "";
      this.accumulatedThinking = "";
      this.ttsAccumulator = "";
      return;
    }
    
    // Pass through other events directly
    this.events.emit(item.type, item);
  }
  
  _setupStderr() {
    this.piProcess.stderr.on("data", (data) => {
      const errStr = data.toString().trim();
      if (errStr) {
        this.events.emit("stderr", { text: errStr });
      }
    });
  }
  
  async sendPrompt(prompt) {
    if (!this.piProcess) {
      throw new Error("Pi process not running. Call connect() first.");
    }
    this.piProcess.stdin.write(JSON.stringify({ type: "prompt", message: prompt }) + "\n");
  }
  
  async cancel() {
    if (this.piProcess) {
      try {
        this.piProcess.kill("SIGINT");
      } catch (e) {
        console.error("[PiCodeHarness] Error cancelling:", e);
      }
    }
  }
  
  async disconnect() {
    if (this.piProcess) {
      try {
        this.piProcess.kill("SIGTERM");
        this.piProcess = null;
      } catch (e) {
        console.error("[PiCodeHarness] Error disconnecting:", e);
      }
    }
  }
}

module.exports = PiCodeHarness;
