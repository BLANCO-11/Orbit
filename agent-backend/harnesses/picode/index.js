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
    const baseURL = this.config.litellm.baseURL;

    // Per-session workspace: create the session's dir tree first, so the
    // workspace block can name the exact paths the agent may work in (and never
    // Orbit's source). This is the ONE machine-specific part of the prompt.
    const dirs = workspacePaths.ensureSessionDirs(this.sessionId);
    this._workspaceDir = dirs.workspace;

    // ── Resolve this session's TENANT + its secrets ONCE (Gap 3 + Gap 4) ──
    // The session row carries the tenant of the API key that owns it. Both the
    // per-session MCP composition (below) and the sandbox env injection (later)
    // are scoped to it. Decrypted secret VALUES stay in `tenantSecrets` and never
    // touch the prompt/transcript/logs — only names are ever logged.
    let sessionTenantId = null;
    let tenantSecrets = {};
    try {
      const db = require("../../db");
      const session = await db.getSession(this.sessionId);
      sessionTenantId = (session && session.tenantId) || null;
      const { getTenantSecrets } = require("../../secrets-resolver");
      tenantSecrets = await getTenantSecrets(sessionTenantId);
    } catch (e) {
      console.error("[PiCodeHarness] tenant/secret resolution failed:", e.message);
    }

    // CRITICAL: pi's MCP extension loads <cwd>/.pi/mcp.json. Since we run pi in
    // the session workspace (for isolation), COMPOSE that file per-session as
    // `shared Orbit servers + this tenant's registered connectors` — never the
    // whole global set (that would leak one tenant's connectors to another).
    try {
      const { MCP_CONFIG_PATH } = require("../../mcp-registry");
      const { resolveDeep } = require("../../secrets-resolver");
      const piDir = path.join(this._workspaceDir, ".pi");
      fs.mkdirSync(piDir, { recursive: true });
      // Shared servers = the global file (Orbit's own fleet/notify/search/… plus
      // any OAuth-wired provider connectors). Inject this session's id into each
      // Orbit MCP server's env so session-blind MCP tools (e.g. fleet dispatch)
      // can identify the LEAD session.
      const cfg = JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, "utf-8"));
      if (!cfg.mcpServers || typeof cfg.mcpServers !== "object") cfg.mcpServers = {};
      for (const [name, s] of Object.entries(cfg.mcpServers)) {
        if (name.startsWith("orbit-")) s.env = { ...(s.env || {}), ORBIT_SESSION_ID: this.sessionId };
      }
      // Tenant connectors = DB rows for THIS session's tenant, with ${secret:NAME}
      // in their env/args resolved to values (in-memory, on-disk in the sandbox's
      // isolated .pi only).
      try {
        const db = require("../../db");
        const connectors = await db.listConnectorsForTenant(sessionTenantId);
        for (const c of connectors) {
          const { transport, lifecycle, ...rest } = c.def || {};
          cfg.mcpServers[c.name] = {
            ...resolveDeep(rest, tenantSecrets),
            transport: transport || (c.def && c.def.url ? "http" : "stdio"),
            lifecycle: lifecycle || "eager",
          };
        }
      } catch (e) {
        console.error("[PiCodeHarness] Could not compose tenant connectors:", e.message);
      }
      fs.writeFileSync(path.join(piDir, "mcp.json"), JSON.stringify(cfg, null, 2) + "\n");
    } catch (e) {
      console.error("[PiCodeHarness] Could not mirror .pi/mcp.json to workspace:", e.message);
    }

    const workspaceBlock =
      `## Your workspace (this session)\n` +
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

    // Compose the full system prompt via the SHARED composer (same code the
    // backend uses to build a remote agent's prompt — see harnesses/picode/prompt.js).
    const { composeSystemPrompt } = require("./prompt");
    const combinedPrompt = composeSystemPrompt({
      config: this.config,
      systemPromptType: activePromptType,
      mode: activeMode,
      skills: this.skills || this.config.skills || [],
      capabilitiesBlock: this.capabilitiesBlock,
      workspaceBlock,
    });

    // Write combined prompt to temp file
    const tempPromptDir = path.join(__dirname, "../../../workspace/temp");
    if (!fs.existsSync(tempPromptDir)) {
      fs.mkdirSync(tempPromptDir, { recursive: true });
    }
    const tempPromptPath = path.join(tempPromptDir, `system-prompt-${this.sessionId}.md`);
    fs.writeFileSync(tempPromptPath, combinedPrompt, "utf-8");

    // LLM access goes through the NATIVE "orbit" OpenAI-compatible provider
    // (registered by the per-spawn `orbit-provider.mjs` extension), NOT the old
    // bespoke `--provider litellm` path. Two shapes, decided by whether the app
    // gateway is present in this process's env:
    //   • local, app-spawned pi → the backend sets ORBIT_GATEWAY_KEY/URL. Point
    //     pi at the app's internal gateway and pass ONLY the app-local key; the
    //     real upstream key never enters the child.
    //   • remote pi (run by orbit-adapter, which doesn't set those) → talk
    //     straight to the remote's own upstream with the remote's own creds
    //     (bring-your-own-LLM).
    const gatewayKey = process.env.ORBIT_GATEWAY_KEY;
    const gatewayUrl = process.env.ORBIT_GATEWAY_URL;
    const useGateway = !!(gatewayKey && gatewayUrl);
    const providerBaseUrl = useGateway ? gatewayUrl : baseURL;
    const providerKey = useGateway ? gatewayKey : apiKey;

    const childEnv = {
      ...process.env,
      ORBIT_MODE: activeMode || "chat",
      ORBIT_LLM_BASE_URL: providerBaseUrl || "",
      // Keyless local servers still need a non-empty placeholder for pi to treat
      // the models as usable (see pi models.md).
      ORBIT_LLM_KEY: providerKey || "orbit-local",
      ORBIT_LLM_MODEL: normalModel || "",
    };
    if (useGateway) {
      // Enforce the contract: the real upstream key must not leak into the child
      // via any inherited alias. Only the gateway key (as ORBIT_LLM_KEY) remains.
      delete childEnv.OPENAI_API_KEY;
      delete childEnv.LLM_API_KEY;
      delete childEnv.LITELLM_KEY;
      delete childEnv.OPENAI_BASE_URL;
      delete childEnv.LLM_BASE_URL;
      delete childEnv.LITELLM_BASE_URL;
    }

    // ── Tenant secrets → sandbox env ────────────────────────────────────
    // Inject this session's tenant-scoped secrets (resolved once, above) as env
    // vars so generated scripts read them from os.environ — the value NEVER
    // enters the prompt or transcript (the agent is told the env-var NAME only).
    // Reserved provider/gateway/system names are protected so a secret can't
    // hijack them. Runs after the gateway scrub above so injection sees the final
    // env. Names (never values) are recorded on `this` for the container sandbox
    // to forward and for redaction/telemetry.
    this._secretNames = [];
    try {
      const { injectIntoEnv } = require("../../secrets-resolver");
      const RESERVED = /^(ORBIT_|OPENAI_|LLM_|LITELLM_|PATH$|HOME$|NODE_|PWD$|SHELL$)/i;
      const { injected, skipped } = injectIntoEnv(childEnv, tenantSecrets, RESERVED);
      this._secretNames = injected;
      if (skipped.length) console.warn(`[PiCodeHarness] skipped reserved-name secret(s): ${skipped.join(", ")}`);
      if (injected.length) console.log(`[PiCodeHarness] injected ${injected.length} tenant secret(s) into sandbox env: ${injected.join(", ")}`);
    } catch (e) {
      console.error("[PiCodeHarness] secret injection failed:", e.message);
    }

    // Absolute path to the provider extension, so `-e` resolves regardless of
    // pi's cwd (the session workspace). ContainerHarness reads this to bind-mount
    // the file into the sandbox at the same path.
    this._providerExtPath = path.join(__dirname, "orbit-provider.mjs");

    const piArgs = [
      "--session-id", this.sessionId,
      "-e", this._providerExtPath,
      "--provider", "orbit",
      "--model", `orbit/${normalModel}`,
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
  
  /**
   * Abort the CURRENT turn without killing the pi process. Used for soft policy
   * blocks (e.g. a write attempted in chat mode): we stop the offending turn but
   * keep pi alive so its conversational context survives and the next prompt —
   * often the same task re-run after a mode switch — reuses the same session
   * instead of paying for a full re-spawn (Workstream A3). Only HARD blocklist
   * hits (protected paths) should fall through to the fatal cancel() below.
   */
  async abortTurn() {
    if (!this.piProcess) return;
    try { this.piProcess.stdin.write(JSON.stringify({ type: "cancel" }) + "\n"); } catch {}
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
   * The SINGLE authoritative capability×mode matrix now lives in the shared
   * prompt composer (harnesses/picode/prompt.js) so local pi and remote agents
   * render it identically. Kept as a thin delegate for any external caller.
   */
  static _renderPolicyMatrix(config) {
    return require("./prompt").renderPolicyMatrix(config);
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
