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

    // The PUBLIC origin this harness actually reached us on (honoring an nginx
    // x-forwarded-proto). This is demonstrably routable from the harness — it
    // just dialed in over it — so it's what we hand back as the LLM gateway base
    // URL when the harness runs on Orbit's own LLM (RemoteHarness.connect).
    const origin = (() => {
      try {
        const host = (request.headers["x-forwarded-host"] || request.headers.host || "").split(",")[0].trim();
        if (!host) return null;
        const proto = (request.headers["x-forwarded-proto"] || "").split(",")[0].trim()
          || (request.socket && request.socket.encrypted ? "https" : "http");
        return { httpOrigin: `${proto === "https" || proto === "wss" ? "https" : "http"}://${host}` };
      } catch { return null; }
    })();

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
          agent: typeof msg.agent === "string" ? msg.agent : "",
          platform: typeof msg.platform === "string" ? msg.platform : "",
          osName: typeof msg.osName === "string" ? msg.osName : "",
          ws,
          device,
          origin, // public origin the harness reached us on (for the LLM gateway URL)
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

      // Reply to a workspace file-RPC request (requestFs → remote explorer).
      if (msg.type === "fs_result" && entry) {
        const waiter = entry._fsWaiters?.get(msg.reqId);
        if (waiter) waiter(msg);
      }

      // Reply to an operator-console request (requestConsole → remote shell).
      if (msg.type === "console_result" && entry) {
        const waiter = entry._consoleWaiters?.get(msg.reqId);
        if (waiter) waiter(msg);
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

  /**
   * Public snapshot of connected remote harnesses (no sockets). Tenant-scoped:
   * pass a `tenantId` to return only that tenant's harnesses (the paired device's
   * owning tenant). Pass `null`/omit for the unscoped view (superadmin only) — a
   * regular tenant must NEVER see another tenant's harnesses. Fixes a cross-tenant
   * leak where every caller saw every connected remote agent.
   */
  function list(tenantId = null) {
    return Array.from(harnesses.values())
      .filter((h) => tenantId == null ? true : ((h.device?.tenantId || null) === tenantId))
      .map((h) => ({
        id: h.id,
        name: h.name,
        machine: h.machine,
        capabilities: h.capabilities,
        model: h.model || "",
        provider: h.provider || "",
        agent: h.agent || "",
        platform: h.platform || "",
        osName: h.osName || "",
        deviceId: h.device?.id || null, // which paired device this agent authed as
        tenantId: h.device?.tenantId || null, // owning tenant (for scoping/ownership checks)
        transport: "remote",
        status: "connected",
        activeSessions: h.sessions.size,
      }));
  }

  function get(harnessId) {
    return harnesses.get(harnessId);
  }

  /**
   * Read-only workspace file RPC to a connected remote harness (the console's
   * explorer for a remote agent). Round-trips over the adapter socket with a
   * timeout. payload = { op:'list'|'read', sessionId, path }. Resolves to the
   * connector's `fs_result` ({ ok, entries|content|error, … }) or an error shape.
   */
  function requestFs(harnessId, payload) {
    const entry = harnesses.get(harnessId);
    return new Promise((resolve) => {
      if (!entry || !entry.ws || entry.ws.readyState !== entry.ws.OPEN) {
        return resolve({ ok: false, error: "harness not connected" });
      }
      if (!entry._fsWaiters) entry._fsWaiters = new Map();
      const reqId = `fs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const timer = setTimeout(() => {
        entry._fsWaiters.delete(reqId);
        resolve({ ok: false, error: "timeout" });
      }, 10000);
      entry._fsWaiters.set(reqId, (m) => {
        clearTimeout(timer);
        entry._fsWaiters.delete(reqId);
        resolve(m || { ok: false, error: "empty response" });
      });
      try { entry.ws.send(JSON.stringify({ type: "fs_request", reqId, ...payload })); }
      catch (e) { clearTimeout(timer); entry._fsWaiters.delete(reqId); resolve({ ok: false, error: e.message }); }
    });
  }

  /**
   * Operator-console RPC to a connected remote harness: run a command in the
   * session workspace ON that machine (or op:'cwd' to fetch its path). Round-trips
   * with a timeout longer than the connector's own exec timeout so a slow command
   * returns a timedOut result rather than this rejecting. payload = { op, sessionId,
   * command }.
   */
  function requestConsole(harnessId, payload) {
    const entry = harnesses.get(harnessId);
    return new Promise((resolve) => {
      if (!entry || !entry.ws || entry.ws.readyState !== entry.ws.OPEN) {
        return resolve({ ok: false, error: "harness not connected" });
      }
      if (!entry._consoleWaiters) entry._consoleWaiters = new Map();
      const reqId = `con-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const timer = setTimeout(() => {
        entry._consoleWaiters.delete(reqId);
        resolve({ ok: false, error: "timeout" });
      }, 30000);
      entry._consoleWaiters.set(reqId, (m) => {
        clearTimeout(timer);
        entry._consoleWaiters.delete(reqId);
        resolve(m || { ok: false, error: "empty response" });
      });
      try { entry.ws.send(JSON.stringify({ type: "console_request", reqId, ...payload })); }
      catch (e) { clearTimeout(timer); entry._consoleWaiters.delete(reqId); resolve({ ok: false, error: e.message }); }
    });
  }

  /**
   * Operator-initiated disconnect of a connected remote harness (from the UI).
   * This is TERMINAL: it tells the adapter to shut down entirely (kill its agent
   * child processes and exit — NOT reconnect), then closes the socket with a
   * dedicated code (4001) the adapter also treats as terminal in case the message
   * is missed. The 'close' handler above notifies any bound RemoteHarness and
   * removes it from the registry; we also drop it immediately so it disappears
   * from the list even if the socket lingers. Returns true if the harness existed.
   *
   * (Distinct from a transient network drop, which the adapter SHOULD reconnect
   * from — only this explicit operator action stops the agent for good.)
   */
  function disconnect(harnessId) {
    const entry = harnesses.get(harnessId);
    if (!entry) return false;
    try { entry.ws.send(JSON.stringify({ type: "shutdown", reason: "operator" })); } catch {}
    try { entry.ws.close(4001, "disconnected by operator"); } catch {}
    if (entry._eventHandlers) {
      for (const handler of entry._eventHandlers.values()) {
        try { handler("close", { code: 4001 }); } catch {}
      }
    }
    harnesses.delete(harnessId);
    return true;
  }

  return { wss, list, get, harnesses, disconnect, requestFs, requestConsole };
}

module.exports = createHarnessRegistry;
