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
    // Effort-profile-resolved model wins; falls back to the config default.
    const normalModel = this.model || this.config.litellm.selectedNormalModel;
    const apiKey = this.config.litellm.apiKey;
    
    // Select and combine prompt files. The base prompt comes from the prompt
    // library (any prompts/<id>.md, e.g. frontier-style prompts); the mode
    // directive is appended on top of it.
    const { resolvePromptFile } = require("../../routes/prompts");
    const basePromptFile = resolvePromptFile(activePromptType);
    
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

    // Append attached skills (reusable instruction packs). Inherited by
    // sub-agents because they share this session's system prompt.
    try {
      const { resolveSkills } = require("../../routes/skills");
      const skillsText = resolveSkills(this.skills || this.config.skills || []);
      if (skillsText) combinedPrompt = combinedPrompt + skillsText;
    } catch (e) {
      console.error("[PiCodeHarness] Skill resolution failed:", e.message);
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

    // Disable pi's native web/browser extension tools so the agent uses ONLY
    // the Lightpanda MCP browser (fast, headless, pre-approved) instead of pi's
    // native browser, which is slow and pops its own approval dialog. Applies
    // to extension tools too (per `pi --help`). Configurable/extensible.
    const excludeTools = (this.config.excludeTools) || ["web_search", "fetch_content", "get_search_content", "browser", "web"];
    if (Array.isArray(excludeTools) && excludeTools.length > 0) {
      piArgs.push("--exclude-tools", excludeTools.join(","));
    }

    const nodePath = (this.binaries && this.binaries.nodePath) || "node";
    const piPath = (this.binaries && this.binaries.piPath) || "pi";
    const spawnArgs = [piPath, ...piArgs];
    
    console.log(`[PiCodeHarness] Spawning: ${nodePath} ${spawnArgs[0]} (mode=${activeMode}, model=${normalModel})`);
    
    this.piProcess = spawn(nodePath, spawnArgs, {
      env: childEnv,
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    console.log(`[PiCodeHarness] Process spawned, PID: ${this.piProcess.pid}`);
    
    this.piProcess.on("error", (err) => {
      console.error(`[PiCodeHarness] Spawn error: ${err.message}`);
      this.events.emit("error", { message: `Failed to spawn Pi: ${err.message}` });
    });
    
    this._setupStdout();
    this._setupStderr();
    
    const pid = this.piProcess.pid;

    this.piProcess.on("close", (code) => {
      console.log(`[PiCodeHarness] Process ${pid} exited with code ${code}`);
      // Clean up temp prompt file
      fs.unlink(tempPromptPath, () => {});
      this.events.emit("close", { code });
    });
  }
  
  _setupStdout() {
    this.piProcess.stdout.on("data", (data) => {
      const str = data.toString();
      this.stdoutBuffer += str;
      const lines = this.stdoutBuffer.split("\n");
      this.stdoutBuffer = lines.pop();
      
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const item = JSON.parse(line);
          this._handleStdoutItem(item);
        } catch (e) {
          console.error(`[PiCodeHarness] Non-JSON stdout: ${line.substring(0, 100)}`);
        }
      }
    });
  }
  
  /**
   * Normalize a provider usage object (any of the common key spellings) and
   * emit a standardized `usage` event. Providers/LiteLLM variously report
   * usage as {input_tokens, output_tokens}, {prompt_tokens, completion_tokens},
   * or already-normalized {input, output}; reasoning tokens may live under
   * completion_tokens_details. Zero-usage payloads are dropped.
   */
  _emitUsage(u, subagentId = null) {
    if (!u || typeof u !== "object") return;
    const input = u.input ?? u.input_tokens ?? u.prompt_tokens ?? 0;
    const output = u.output ?? u.output_tokens ?? u.completion_tokens ?? 0;
    const reasoning =
      u.reasoning ?? u.reasoning_tokens ??
      u.completion_tokens_details?.reasoning_tokens ?? 0;
    const cacheRead = u.cache_read ?? u.cacheRead ?? u.cache_read_input_tokens ?? 0;
    if (!input && !output && !reasoning) return;
    this.events.emit("usage", { input, output, reasoning, cacheRead, subagentId });
  }

  _handleStdoutItem(item) {
    // Provider usage can ride on any event type (message_update final chunks,
    // agent_end, turn_end, dedicated usage items) — sniff every item once.
    const usage =
      item.usage || item.message?.usage || item.assistantMessageEvent?.usage || null;
    if (usage) this._emitUsage(usage, item.subagentId || null);

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
