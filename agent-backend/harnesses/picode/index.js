// agent-backend/harnesses/picode/index.js
// PiCodeHarness — wraps the Pi CLI agent process
// Implements HarnessInterface and emits standardized events

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const EventEmitter = require("events");
const HarnessInterface = require("../interface");
const { stripTuiChars, isMutatingTool, isReadOnlyTool, isConversationalPrompt } = require("./parser");
const workspacePaths = require("../../workspace-paths");

// pi "web-access" extension (npm:pi-web-access) tools, split by capability:
//   - native SEARCH: only autonomous with a backend key, else prompts a browser
//     sign-in — excluded unless a key is configured (orbit-search covers search).
//   - native BROWSE fallback: superseded by the Lightpanda MCP browser.
const WEB_NATIVE_SEARCH_TOOLS = ["web_search", "get_search_content"];
const WEB_BROWSE_FALLBACK_TOOLS = ["fetch_content", "browser", "web"];

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

    // Always inject Orbit's self-knowledge (who it is, its modes + capability
    // matrix, connectors, the fleet + notify tools) so the agent answers
    // questions about itself and picks the notify tool over bash — instead of
    // grepping its own source at runtime.
    try {
      const systemDocs = fs.readFileSync(path.join(promptsDir, "orbit-system.md"), "utf-8");
      combinedPrompt = combinedPrompt + "\n\n" + systemDocs;
    } catch (e) {
      console.error("[PiCodeHarness] orbit-system.md not found:", e.message);
    }

    // Static operating manual — HOW to operate (file mgmt, planning, tracking,
    // rules). Separated from orbit-system.md (WHAT Orbit is) per Workstream D1.
    try {
      const behavior = fs.readFileSync(path.join(promptsDir, "orbit-behavior.md"), "utf-8");
      combinedPrompt = combinedPrompt + "\n\n" + behavior;
    } catch (e) {
      console.error("[PiCodeHarness] orbit-behavior.md not found:", e.message);
    }

    // Live capability × mode matrix, generated FROM the enforced policy config so
    // the prompt can never drift from what the backend actually enforces (D1).
    try {
      const matrix = PiCodeHarness._renderPolicyMatrix(this.config);
      if (matrix) combinedPrompt = combinedPrompt + "\n\n" + matrix;
    } catch (e) { /* non-fatal */ }

    // Dynamic capability manifest — "what's configured right now" — laid in fresh
    // each session start so the agent knows what it can use vs what needs setup
    // (Workstream D2). Rendered by the backend and passed via capabilitiesBlock.
    if (this.capabilitiesBlock) {
      combinedPrompt = combinedPrompt + "\n\n" + this.capabilitiesBlock;
    }

    // Per-session workspace: create the session's dir tree and tell the agent
    // exactly where it may work, so it never dumps files at random (and never
    // into Orbit's source). This is dynamic — the paths are session-specific.
    const dirs = workspacePaths.ensureSessionDirs(this.sessionId);
    this._workspaceDir = dirs.workspace;

    // CRITICAL: pi's MCP extension loads <cwd>/.pi/mcp.json. Since we run pi in
    // the session workspace (for isolation), mirror the repo's MCP config into
    // <workspace>/.pi/mcp.json — otherwise pi loads NO MCP servers (no orbit
    // notify/search/plan, no lightpanda) and the agent falls back to bash.
    try {
      const { MCP_CONFIG_PATH } = require("../../mcp-registry");
      const piDir = path.join(this._workspaceDir, ".pi");
      fs.mkdirSync(piDir, { recursive: true });
      // Inject this session's id into each Orbit MCP server's env so session-blind
      // MCP tools (e.g. fleet dispatch) can identify the LEAD session — used to
      // inherit its execution rights, not hardcode them.
      const cfg = JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, "utf-8"));
      for (const [name, s] of Object.entries(cfg.mcpServers || {})) {
        if (name.startsWith("orbit-")) s.env = { ...(s.env || {}), ORBIT_SESSION_ID: this.sessionId };
      }
      fs.writeFileSync(path.join(piDir, "mcp.json"), JSON.stringify(cfg, null, 2) + "\n");
    } catch (e) {
      console.error("[PiCodeHarness] Could not mirror .pi/mcp.json to workspace:", e.message);
    }
    combinedPrompt = combinedPrompt +
      `\n\n## Your workspace (this session)\n` +
      `You are running in an isolated per-session workspace sandboxed under a single session directory. Layout of the session:\n` +
      `- \`${dirs.workspace}\` (current working directory): Do all standard coding, scripting, and file creation here. Relative paths land here by default.\n` +
      `- \`${dirs.artifacts}\` (accessible relatively via \`../artifacts/\`): Put finished deliverables, reports, build outputs, and export files here so they are preserved and shown on the dashboard.\n` +
      `- \`${dirs.tmp}\` (accessible relatively via \`../tmp/\`): Use for temporary downloads, intermediate cache, or scratch files.\n` +
      `RULES:\n` +
      `- Use relative paths from your current working directory to access these folders (e.g. write code files to \`my_script.py\` and write finished deliverables to \`../artifacts/my_report.pdf\`). Do NOT use absolute paths like \`~/...\` or \`/home/...\`.\n` +
      `- Do not create a folder named \`artifacts\` or \`tmp\` inside your working directory; write to the sibling directories (\`../artifacts/\` and \`../tmp/\`) instead.\n` +
      `- Prefer the \`write\` tool over \`bash\` redirects/heredocs for creating files.\n` +
      `- Accessing folders outside the session root directory is blocked or requires manual user approval.\n` +
      `Keep things tidy — this layout is how the user tracks and manages your work.`;

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
      ORBIT_MODE: activeMode || "chat"
    };
    
    const piArgs = [
      "--session-id", this.sessionId,
      "--provider", "litellm",
      "--model", `litellm/${normalModel}`,
      "--mode", "rpc",
      "--system-prompt", combinedPrompt,
    ];

    // Disable selected tools this session. Precedence: explicit per-session
    // excludeTools (from a profile / composer) > config default > nothing.
    let excludeTools = this.excludeTools
      || this.config.excludeTools
      || [];

    // ── Web capability policy ──────────────────────────────────────────
    // SEARCH and BROWSE are separate capabilities:
    //   • SEARCH (native pi web_search/get_search_content) is PREFERRED when the
    //     user has configured a real backend key — otherwise pi falls back to a
    //     Google/Gemini browser SIGN-IN prompt (not autonomous), so we EXCLUDE it
    //     and let our keyless `orbit-search` MCP tool be the default retriever.
    //   • BROWSE fallback (native fetch_content/browser/web) is off by default —
    //     the Lightpanda MCP browser reads pages; enable via config.webAccess.
    const webAccessEnabled =
      this.webAccessEnabled === true ||
      (this.webAccessEnabled === undefined && this.config.webAccess?.enabled === true);

    if (!webAccessEnabled) {
      excludeTools = Array.from(new Set([...excludeTools, ...WEB_BROWSE_FALLBACK_TOOLS]));
    }
    // Native search stays only if a real (autonomous) backend key is set; else
    // exclude it so it never triggers the browser sign-in — orbit-search covers it.
    if (!PiCodeHarness._hasNativeSearchConfigured()) {
      excludeTools = Array.from(new Set([...excludeTools, ...WEB_NATIVE_SEARCH_TOOLS]));
    }

    if (Array.isArray(excludeTools) && excludeTools.length > 0) {
      piArgs.push("--exclude-tools", excludeTools.join(","));
    }
    this._excludeTools = excludeTools;

    const nodePath = (this.binaries && this.binaries.nodePath) || "node";
    const piPath = (this.binaries && this.binaries.piPath) || "pi";

    // A subclass (ContainerHarness) can wrap this to run pi inside a sandbox.
    const { command, args, spawnEnv, cwd } = this._buildSpawnCommand({ nodePath, piPath, piArgs, childEnv });

    console.log(`[PiCodeHarness] Spawning: ${command} (mode=${activeMode}, model=${normalModel})`);

    // `detached: true` makes pi its OWN process-group leader, so the tools it
    // spawns (bash → curl, etc.) join pi's group. cancel() can then signal the
    // WHOLE group and actually kill an in-flight command — signalling just pi's
    // PID (the old behaviour) left long curls/bash running and the Stop button
    // did nothing.
    this.piProcess = spawn(command, args, {
      env: spawnEnv,
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
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
  
  /**
   * Build the process to spawn. Default: run pi directly on the host.
   * Overridden by ContainerHarness to wrap it in `docker run`.
   */
  _buildSpawnCommand({ nodePath, piPath, piArgs, childEnv }) {
    // Run pi IN the session workspace so its default writes and relative paths
    // land there — not in Orbit's source (the backend's cwd).
    return { command: nodePath, args: [piPath, ...piArgs], spawnEnv: childEnv, cwd: this._workspaceDir || process.cwd() };
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
        isError: item.isError === true || tc.isError === true,
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
    if (!this.piProcess) return;
    const pid = this.piProcess.pid;
    // Best-effort graceful turn-abort first (harmless if pi ignores it).
    try { this.piProcess.stdin.write(JSON.stringify({ type: "cancel" }) + "\n"); } catch {}
    // Then signal pi's whole PROCESS GROUP so any in-flight bash/curl child dies
    // too — not just the pi PID. Escalate to SIGKILL if it doesn't exit.
    this._killGroup(pid, "SIGTERM");
    setTimeout(() => {
      // Still the same live process? Force-kill the group.
      if (this.piProcess && this.piProcess.pid === pid && !this.piProcess.killed) {
        this._killGroup(pid, "SIGKILL");
      }
    }, 2500);
  }

  /** Signal pi's process group (negative pid). Falls back to the bare pid. */
  _killGroup(pid, signal) {
    try {
      process.kill(-pid, signal); // negative pid → the whole group (detached leader)
    } catch (e) {
      try { process.kill(pid, signal); } catch {}
    }
  }

  async disconnect() {
    if (this.piProcess) {
      const pid = this.piProcess.pid;
      try { this._killGroup(pid, "SIGTERM"); } catch (e) {
        console.error("[PiCodeHarness] Error disconnecting:", e);
      }
      this.piProcess = null;
    }
  }

  // ── Tool enumeration (harness contract) ─────────────────────────────
  // Composes pi's tools from three sources so the console can render a
  // tools/extensions manager: (1) built-in tools, statically known; (2) pi
  // extension packages from ~/.pi/agent/settings.json, with a curated
  // tool-name map for the ones we know provide agent tools; (3) tool names the
  // agent has actually used (from the observed-tools catalog), which catches
  // anything the first two miss. MCP connector tools are added by the route,
  // not here (they're shared across harnesses).
  async listTools() {
    const { getObserved } = require("../../tool-catalog");

    const builtins = [
      { id: "read", name: "read", source: "built-in", description: "Read file contents" },
      { id: "bash", name: "bash", source: "built-in", description: "Execute bash commands" },
      { id: "edit", name: "edit", source: "built-in", description: "Edit files with find/replace" },
      { id: "write", name: "write", source: "built-in", description: "Write files (create/overwrite)" },
      { id: "grep", name: "grep", source: "built-in", description: "Search file contents" },
      { id: "find", name: "find", source: "built-in", description: "Find files by glob pattern" },
    ];

    // Curated map of known pi extension packages → the agent tools they provide.
    const EXTENSION_TOOLS = {
      "npm:pi-web-access": ["web_search", "fetch_content", "get_search_content", "browser", "web"],
      "npm:pi-subagents": ["subagent"],
    };
    const extensionTools = [];
    for (const pkg of PiCodeHarness._listPiExtensions()) {
      const short = pkg.replace(/^npm:/, "");
      const tools = EXTENSION_TOOLS[pkg];
      if (tools) {
        for (const t of tools) {
          extensionTools.push({ id: t, name: t, source: short, description: `Provided by ${short}` });
        }
      } else {
        // Unknown extension — surface the package so the user knows it exists;
        // its individual tools appear once observed.
        extensionTools.push({ id: `ext:${short}`, name: short, source: short, description: "pi extension package", isExtensionPackage: true });
      }
    }

    const known = new Set([...builtins, ...extensionTools].map((t) => t.name));
    const observedTools = getObserved("picode")
      .filter((name) => !known.has(name) && !name.startsWith("mcp_")) // mcp_* handled as connectors
      .map((name) => ({ id: name, name, source: "observed", description: "Tool observed in use" }));

    const excluded = new Set(this._excludeTools || this.config.excludeTools || []);
    return [...builtins, ...extensionTools, ...observedTools].map((t) => ({
      ...t,
      enabledByDefault: !excluded.has(t.name),
    }));
  }

  /**
   * True if a real (autonomous) native search backend is configured — an API
   * key in env or ~/.pi/web-search.json. When false, pi's web_search would fall
   * back to a browser sign-in, so we exclude it and rely on orbit-search.
   */
  /**
   * Render config.policyMatrix as a markdown table for the system prompt. This
   * is the SINGLE authoritative matrix — generated from the enforced config so
   * it can never disagree with what the backend actually gates (Workstream D1).
   */
  static _renderPolicyMatrix(config) {
    const matrix = config && config.policyMatrix;
    if (!matrix || typeof matrix !== "object") return "";
    const modes = ["chat", "plan", "edit", "yolo"];
    const rows = Object.entries(matrix).map(([cap, byMode]) => {
      const cells = modes.map((m) => String((byMode && byMode[m]) || "—").padEnd(5));
      return `| ${cap.padEnd(15)} | ${cells.join(" | ")} |`;
    });
    if (!rows.length) return "";
    return [
      "## Capability × mode policy (live)",
      "Authoritative, generated from the backend's enforced policy config:",
      "",
      `| ${"capability".padEnd(15)} | ${modes.map((m) => m.padEnd(5)).join(" | ")} |`,
      `|-${"-".repeat(15)}-|${modes.map(() => "-------").join("|")}|`,
      ...rows,
    ].join("\n");
  }

  static _hasNativeSearchConfigured() {
    if (process.env.EXA_API_KEY || process.env.PERPLEXITY_API_KEY || process.env.GEMINI_API_KEY) return true;
    try {
      const cfgPath = path.join(os.homedir(), ".pi", "web-search.json");
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
      return !!(cfg.exaApiKey || cfg.perplexityApiKey || cfg.geminiApiKey || cfg.apiKey);
    } catch { return false; }
  }

  /** Installed pi extension packages from ~/.pi/agent/settings.json. */
  static _listPiExtensions() {
    try {
      const settingsPath = path.join(os.homedir(), ".pi", "agent", "settings.json");
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      return Array.isArray(settings.packages) ? settings.packages : [];
    } catch {
      return [];
    }
  }
}

module.exports = PiCodeHarness;
