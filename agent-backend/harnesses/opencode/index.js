// agent-backend/harnesses/opencode/index.js
//
// OpenCodeHarness — drives the OpenCode CLI (https://opencode.ai) as an Orbit
// harness, proving the harness-agnostic contract with a second real agent.
//
// OpenCode differs from pi: it has no persistent rpc stdin loop. Instead each
// turn is `opencode run --format json …`, which streams newline-delimited JSON
// events to stdout and exits. We spawn per prompt, translate OpenCode's events
// to Orbit's standardized events, and reuse the SAME session across turns via
// OpenCode's own session id (--session).
//
// OpenCode uses its own provider config; we point it at the user's LiteLLM
// endpoint (OpenAI-compatible) by writing an opencode.json into the session
// workspace, so it runs on the user's own model — no proprietary dependency.
//
// Isolation note: OpenCode executes its tools INTERNALLY (we only observe the
// resulting events), so Orbit's per-tool policy gate can't block them mid-flight
// the way it can advise for pi. Isolation therefore comes from cwd = the session
// workspace (and, ideally, the container sandbox). We pass --auto so it doesn't
// hang waiting for permission in headless mode.

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const HarnessInterface = require("../interface");
const workspacePaths = require("../../workspace-paths");

// OpenCode's built-in tool set (for the tools manager; observed tools are added
// by the catalog as they're used).
const OPENCODE_TOOLS = ["read", "write", "edit", "bash", "ls", "grep", "glob", "webfetch", "task", "todowrite", "todoread"];

class OpenCodeHarness extends HarnessInterface {
  constructor(options) {
    super(options);
    this.proc = null;
    this._ocSession = null;      // OpenCode's session id, captured to continue across turns
    this._buf = "";
    this._textByPart = {};        // partID → last emitted text length (for deltas)
    this._toolSeen = new Set();   // callID → started, so we emit start/end once
    this._binaryPath = options.opencodePath || process.env.OPENCODE_PATH || "opencode";
  }

  getMetadata() {
    return { name: "OpenCode", version: "1.0.0", capabilities: ["chat", "plan", "edit", "yolo", "tools"], transport: "local" };
  }

  async listTools() {
    const { getObserved } = require("../../tool-catalog");
    const builtins = OPENCODE_TOOLS.map((t) => ({ id: t, name: t, source: "opencode", description: `OpenCode built-in: ${t}` }));
    const known = new Set(builtins.map((t) => t.name));
    const observed = getObserved("opencode")
      .filter((n) => !known.has(n) && !n.startsWith("mcp_"))
      .map((n) => ({ id: n, name: n, source: "observed", description: "Tool observed in use" }));
    return [...builtins, ...observed].map((t) => ({ ...t, enabledByDefault: true }));
  }

  // OpenCode has no persistent process; connect() just prepares the workspace +
  // provider config. The process is spawned per prompt in sendPrompt().
  async connect() {
    const dirs = workspacePaths.ensureSessionDirs(this.sessionId);
    this._workspaceDir = dirs.workspace;
    this._writeProviderConfig(this._workspaceDir);
    this.events.emit("ready", {});
  }

  /**
   * Write opencode.json into the session workspace: point OpenCode at the user's
   * LiteLLM (OpenAI-compatible) model, and give it the SAME MCP servers Orbit
   * runs (translated from .pi/mcp.json) so it's a real peer of pi — same search,
   * notify, plan, transcript, browser tools.
   */
  _writeProviderConfig(dir) {
    const llm = this.config.litellm || {};
    const model = this.model || llm.selectedNormalModel || "gpt-4o";
    this._model = `litellm/${model}`;
    const cfg = {
      $schema: "https://opencode.ai/config.json",
      provider: {
        litellm: {
          npm: "@ai-sdk/openai-compatible",
          name: "LiteLLM",
          options: { baseURL: (llm.baseURL || "http://127.0.0.1:5000/v1"), apiKey: llm.apiKey || "sk-none" },
          models: { [model]: { name: model } },
        },
      },
      mcp: this._orbitMcpForOpenCode(),
    };
    try { fs.writeFileSync(path.join(dir, "opencode.json"), JSON.stringify(cfg, null, 2)); }
    catch (e) { console.error("[OpenCodeHarness] Could not write opencode.json:", e.message); }
  }

  /** Translate Orbit's .pi/mcp.json (stdio servers) → OpenCode's `mcp` config. */
  _orbitMcpForOpenCode() {
    const out = {};
    try {
      const { MCP_CONFIG_PATH } = require("../../mcp-registry");
      const cfg = JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, "utf-8"));
      for (const [name, s] of Object.entries(cfg.mcpServers || {})) {
        if (s.command && Array.isArray(s.args)) {
          out[name] = { type: "local", command: [s.command, ...s.args], enabled: true, ...(s.env ? { environment: s.env } : {}) };
        }
      }
    } catch (e) { /* no MCP config yet — fine */ }
    return out;
  }

  async sendPrompt(prompt) {
    const args = [
      "run",
      "--dir", this._workspaceDir,
      "--model", this._model,
      "--format", "json",
      "--auto",
      "--log-level", "ERROR",
    ];
    if (this._ocSession) args.push("--session", this._ocSession);
    args.push(prompt);

    console.log(`[OpenCodeHarness] Spawning: ${this._binaryPath} run (model=${this._model}, session=${this._ocSession || "new"})`);
    this._buf = "";
    this._textByPart = {};
    this._toolSeen = new Set();

    this.proc = spawn(this._binaryPath, args, {
      cwd: this._workspaceDir,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true, // own process group so cancel() kills the whole tree
    });

    this.proc.stdout.on("data", (chunk) => this._onStdout(chunk));
    this.proc.stderr.on("data", (d) => {
      const s = d.toString();
      if (/error/i.test(s)) console.error("[OpenCodeHarness stderr]", s.trim().slice(0, 300));
    });
    this.proc.on("error", (err) => this.events.emit("error", { message: `Failed to spawn OpenCode: ${err.message}` }));
    this.proc.on("close", (code) => {
      // Flush any trailing buffered line, then end the turn.
      if (this._buf.trim()) { this._handleEvent(this._buf.trim()); this._buf = ""; }
      this.events.emit("agent_end", { accumulatedText: this._accumulated || "", accumulatedThinking: "" });
      this.events.emit("close", { code });
      this.proc = null;
    });
  }

  _onStdout(chunk) {
    this._buf += chunk.toString();
    let nl;
    while ((nl = this._buf.indexOf("\n")) >= 0) {
      const line = this._buf.slice(0, nl).trim();
      this._buf = this._buf.slice(nl + 1);
      if (line) this._handleEvent(line);
    }
  }

  /** Translate one OpenCode JSON event → Orbit standardized events. */
  _handleEvent(line) {
    let evt;
    try { evt = JSON.parse(line); } catch { return; }
    if (evt.sessionID && !this._ocSession) this._ocSession = evt.sessionID; // capture for --session continuity
    const part = evt.part || {};

    switch (evt.type) {
      case "text": {
        const full = part.text || "";
        const prevLen = this._textByPart[part.id] || 0;
        if (full.length > prevLen) {
          const delta = full.slice(prevLen);
          this._textByPart[part.id] = full.length;
          this._accumulated = full;
          this.events.emit("text_delta", { delta });
          this.events.emit("accumulated_text", { text: full });
        }
        break;
      }
      case "reasoning": {
        if (part.text) this.events.emit("thinking_delta", { delta: part.text });
        break;
      }
      case "tool_use": {
        const st = part.state || {};
        const id = part.callID || part.id;
        if (!id) break;
        if (!this._toolSeen.has(id)) {
          this._toolSeen.add(id);
          this.events.emit("tool_call_start", { id, name: part.tool || "tool", arguments: st.input || {} });
        }
        if (st.status === "completed" || st.status === "error") {
          this.events.emit("tool_call_end", { id, name: part.tool || "tool", result: st.output || "", isError: st.status === "error" });
        }
        break;
      }
      case "step_finish": {
        const t = part.tokens || {};
        const cache = t.cache || {};
        this.events.emit("usage", {
          input: t.input || 0,
          output: t.output || 0,
          reasoning: t.reasoning || 0,
          cacheRead: cache.read || 0,
        });
        break;
      }
      default:
        break; // step_start and others: no-op
    }
  }

  async cancel() {
    if (!this.proc) return;
    const pid = this.proc.pid;
    try { process.kill(-pid, "SIGTERM"); } catch { try { process.kill(pid, "SIGTERM"); } catch {} }
    setTimeout(() => {
      if (this.proc && this.proc.pid === pid && !this.proc.killed) {
        try { process.kill(-pid, "SIGKILL"); } catch {}
      }
    }, 2000);
  }

  async disconnect() {
    await this.cancel();
    this.proc = null;
  }
}

module.exports = OpenCodeHarness;
