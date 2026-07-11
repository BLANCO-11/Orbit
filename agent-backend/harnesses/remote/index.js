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

    this._send({
      type: "spawn",
      mode: this.mode,
      systemPromptType: this.systemPromptType,
      skills: this.skills,
      model: this.model,
      excludeTools: this.excludeTools,
    });
  }

  async sendPrompt(prompt) {
    this._send({ type: "prompt", message: prompt });
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
