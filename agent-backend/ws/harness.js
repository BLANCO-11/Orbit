// agent-backend/ws/harness.js
// Remote-harness transport. An `orbit-adapter` process (see
// agent-backend/adapter/orbit-adapter.js), running on any machine, dials in
// here over an authenticated WebSocket. Once registered it becomes a harness
// the console can run sessions on, exactly like the local pi child process —
// the RemoteHarness (harnesses/remote/index.js) bridges over this socket.
//
// Adapter → backend messages:
//   { type: 'register', name, machine, capabilities }
//   { type: 'event', sessionId, event, data }   // relayed harness events
// Backend → adapter messages:
//   { type: 'spawn', sessionId, mode, systemPromptType, skills, model }
//   { type: 'prompt', sessionId, message }
//   { type: 'cancel', sessionId } | { type: 'disconnect', sessionId }

const WebSocket = require("ws");

function createHarnessRegistry() {
  const wss = new WebSocket.Server({ noServer: true });

  /** Map<harnessId, { id, name, machine, capabilities, ws, device, sessions:Set }> */
  const harnesses = new Map();
  let seq = 0;

  wss.on("connection", (ws, request, device) => {
    const harnessId = `remote-${device.id.slice(0, 8)}-${++seq}`;
    let entry = null;

    ws.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      if (msg.type === "register") {
        entry = {
          id: harnessId,
          name: msg.name || device.label || "remote harness",
          machine: msg.machine || "unknown",
          capabilities: Array.isArray(msg.capabilities) ? msg.capabilities : [],
          // Remote's bring-your-own LLM, reported for read-only display only.
          model: typeof msg.model === "string" ? msg.model : "",
          provider: typeof msg.provider === "string" ? msg.provider : "",
          ws,
          device,
          sessions: new Set(),
        };
        harnesses.set(harnessId, entry);
        console.log(`[Harness] Remote harness registered: ${entry.name} (${harnessId}) on ${entry.machine}`);
        ws.send(JSON.stringify({ type: "registered", harnessId }));
        return;
      }

      // Relay a harness event to whichever RemoteHarness is listening for this
      // session. The listener is attached by RemoteHarness.connect().
      if (msg.type === "event" && entry) {
        const handler = entry._eventHandlers?.get(msg.sessionId);
        if (handler) handler(msg.event, msg.data);
      }

      // Reply to a listTools() request (RemoteHarness.listTools).
      if (msg.type === "tools_list" && entry) {
        const waiter = entry._toolListWaiters?.get(msg.reqId);
        if (waiter) waiter(msg.tools);
      }
    });

    ws.on("close", () => {
      if (entry) {
        console.log(`[Harness] Remote harness disconnected: ${entry.name} (${harnessId})`);
        // Notify any live RemoteHarness bound to this adapter.
        if (entry._eventHandlers) {
          for (const handler of entry._eventHandlers.values()) {
            try { handler("close", { code: 1006 }); } catch {}
          }
        }
        harnesses.delete(harnessId);
      }
    });
  });

  /** Public snapshot of connected remote harnesses (no sockets). */
  function list() {
    return Array.from(harnesses.values()).map((h) => ({
      id: h.id,
      name: h.name,
      machine: h.machine,
      capabilities: h.capabilities,
      model: h.model || "",
      provider: h.provider || "",
      transport: "remote",
      status: "connected",
      activeSessions: h.sessions.size,
    }));
  }

  function get(harnessId) {
    return harnesses.get(harnessId);
  }

  /**
   * Operator-initiated disconnect of a connected remote harness (from the UI).
   * Asks the adapter to stop, closes the socket (the 'close' handler above then
   * notifies any bound RemoteHarness and removes it from the registry), and
   * drops it immediately so it disappears from the list even if the socket lingers.
   * Returns true if a harness with that id existed.
   */
  function disconnect(harnessId) {
    const entry = harnesses.get(harnessId);
    if (!entry) return false;
    try { entry.ws.send(JSON.stringify({ type: "disconnect" })); } catch {}
    try { entry.ws.close(1000, "disconnected by operator"); } catch {}
    if (entry._eventHandlers) {
      for (const handler of entry._eventHandlers.values()) {
        try { handler("close", { code: 1000 }); } catch {}
      }
    }
    harnesses.delete(harnessId);
    return true;
  }

  return { wss, list, get, harnesses, disconnect };
}

module.exports = createHarnessRegistry;
