// agent-backend/harnesses/remote/index.js
// RemoteHarness — a HarnessInterface implementation that drives a harness
// running inside a connected `orbit-adapter` (see ws/harness.js) instead of a
// local child process. connect/sendPrompt/cancel/disconnect become messages to
// the adapter; the adapter relays the standard harness events back over the
// same socket, and we re-emit them on our own EventEmitter so the rest of the
// backend can't tell local from remote.

const HarnessInterface = require("../interface");

class RemoteHarness extends HarnessInterface {
  constructor(options) {
    super(options);
    // The registry entry ({ ws, sessions, _eventHandlers }) for the adapter.
    this.registryEntry = options.registryEntry;
    // db handle — used to mint the scoped, budget-capped LLM token this device
    // presents to Orbit's gateway (the zero-config default brain). Optional: the
    // listTools probe constructs a RemoteHarness without it and never spawns.
    this.db = options.db || null;
  }

  getMetadata() {
    return {
      name: this.registryEntry?.name || "remote",
      version: "1.0.0",
      transport: "remote",
      capabilities: this.registryEntry?.capabilities || [],
    };
  }

  _send(obj) {
    const ws = this.registryEntry?.ws;
    if (ws && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ ...obj, sessionId: this.sessionId }));
    }
  }

  /**
   * Ask the adapter to enumerate its local harness's tools. Round-trips over
   * the adapter socket with a short timeout; falls back to [] if unanswered.
   */
  async listTools() {
    const entry = this.registryEntry;
    const ws = entry?.ws;
    if (!ws || ws.readyState !== ws.OPEN) return [];
    return new Promise((resolve) => {
      const reqId = `lt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      if (!entry._toolListWaiters) entry._toolListWaiters = new Map();
      const timer = setTimeout(() => {
        entry._toolListWaiters.delete(reqId);
        resolve([]);
      }, 5000);
      entry._toolListWaiters.set(reqId, (tools) => {
        clearTimeout(timer);
        entry._toolListWaiters.delete(reqId);
        resolve(Array.isArray(tools) ? tools : []);
      });
      ws.send(JSON.stringify({ type: "list_tools", reqId }));
    });
  }

  async connect() {
    const entry = this.registryEntry;
    if (!entry) throw new Error("remote harness is no longer connected");

    // Register an event handler for this session so relayed adapter events
    // land on our EventEmitter as if they came from a local harness.
    if (!entry._eventHandlers) entry._eventHandlers = new Map();
    entry._eventHandlers.set(this.sessionId, (event, data) => {
      this.events.emit(event, data || {});
    });
    entry.sessions.add(this.sessionId);

    // Build the FULL portable Orbit system prompt HERE (on the backend, which
    // has the prompt library, policy config, and capabilities manifest) and send
    // it down, so a remote agent behaves as a real Orbit agent — not a generic
    // coder. The ONE machine-specific piece, the per-session workspace block, is
    // omitted: the remote appends its own (only it knows its paths). Uses the
    // SAME composer as local pi, so the two prompts match. No secrets ride along
    // (no API keys). Enforcement still happens centrally on each tool_call_start.
    let systemPrompt = "";
    try {
      const { composeSystemPrompt } = require("../picode/prompt");
      systemPrompt = composeSystemPrompt({
        config: this.config,
        systemPromptType: this.systemPromptType,
        mode: this.mode,
        skills: this.skills,
        capabilitiesBlock: this.capabilitiesBlock,
        // workspaceBlock omitted — the remote adds its own.
      });
    } catch (e) {
      console.error("[RemoteHarness] Failed to compose system prompt:", e.message);
    }

    this._send({
      type: "spawn",
      mode: this.mode,
      systemPromptType: this.systemPromptType,
      systemPrompt,
      skills: this.skills,
      model: this.model,
      // The brain. By default the remote runs on Orbit's OWN LLM gateway (like
      // the container pi) via a scoped per-device token — zero config on the box.
      // A per-device bring-your-own endpoint overrides it. `null` → the connector
      // falls back to whatever OPENAI_*/LLM_* env it has locally.
      llm: await this._resolveLlm(),
      excludeTools: this.excludeTools,
      // Kept for older/pi-based adapters that build their own prompt from parts.
      capabilitiesBlock: this.capabilitiesBlock,
      policyMatrix: this.config && this.config.policyMatrix,
      webAccess: this.config && this.config.webAccess,
    });
  }

  /**
   * Decide which brain the remote runs on this spawn.
   *
   * The model (remote-agent-connect plan §3, as corrected): Orbit is the
   * ORCHESTRATING brain — it hands the remote a reasoned plan/context/task (the
   * system prompt + the prompt). The remote is an autonomous agent that does its
   * OWN LLM inference to carry that out, and MUST NOT depend on Orbit for
   * inference. So the DEFAULT is: send no `llm` block → the connector uses its
   * own OPENAI_ / LLM_ env (its own provider).
   *
   * Two central-config overrides, both still "the remote's own provider", just
   * configured from Orbit instead of the box's env (device.llmConfig, set via
   * PATCH /api/devices/:id/llm):
   *   • a bring-your-own endpoint ({baseURL,apiKey,model}) → routed to that;
   *   • the sentinel {provider:"orbit"} → an explicit, off-by-default opt-in to
   *     borrow Orbit's own gateway as the brain (scoped, budget-capped token).
   *     Only used when the operator deliberately turns it on for a device that
   *     has no provider of its own; never the default.
   */
  async _resolveLlm() {
    const entry = this.registryEntry;
    const device = entry && entry.device;
    try {
      const byo = device && device.llmConfig;
      // Bring-your-own endpoint configured centrally for this device.
      if (byo && byo.baseURL) {
        return { provider: "byo", baseURL: byo.baseURL, apiKey: byo.apiKey || "", model: byo.model || this.model || "" };
      }
      // Explicit opt-in: borrow Orbit's gateway as this device's brain. NOT the
      // default — only when the operator set provider:"orbit" for this device.
      if (byo && byo.provider === "orbit") {
        const httpOrigin = entry && entry.origin && entry.origin.httpOrigin;
        if (this.db && device && device.id && httpOrigin) {
          const budget = Number(process.env.ORBIT_DEVICE_LLM_BUDGET) || undefined;
          const token = await this.db.mintDeviceLlmToken(device.id, { budget, sessionId: this.sessionId });
          if (token) {
            const model = byo.model || this.model || (this.config && this.config.litellm && this.config.litellm.selectedNormalModel) || "";
            return { provider: "orbit", baseURL: `${httpOrigin}/llm/v1`, apiKey: token, model };
          }
        }
      }
    } catch (e) {
      console.error("[RemoteHarness] Failed to resolve LLM for spawn:", e.message);
    }
    // DEFAULT: the remote uses its own provider (env on the box). Orbit supplies
    // only the plan/context, never the inference.
    return null;
  }

  async sendPrompt(prompt) {
    this._send({ type: "prompt", message: prompt });
  }

  /**
   * Graceful turn-abort for soft policy blocks (server prefers this over
   * cancel()). On the remote, `cancel` aborts the in-flight turn — the connector
   * aborts the LLM fetch, kills any in-flight tool child, and ends the turn — but
   * keeps the session and socket alive, so the next prompt reuses it. That's
   * exactly the abortTurn contract, so it maps to the same message.
   */
  async abortTurn() {
    this._send({ type: "cancel" });
  }

  async cancel() {
    this._send({ type: "cancel" });
  }

  async disconnect() {
    this._send({ type: "disconnect" });
    const entry = this.registryEntry;
    if (entry) {
      entry._eventHandlers?.delete(this.sessionId);
      entry.sessions.delete(this.sessionId);
    }
  }
}

module.exports = RemoteHarness;
