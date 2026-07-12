// agent-backend/fleet.js
//
// Orchestrated-lead fleet dispatch. The lead agent (the local pi you talk to)
// delegates a self-contained task to another device via the `orbit-fleet` MCP
// tools; the backend runs a headless turn on that device's harness and hands
// the final answer back as the tool result, which the lead then merges into its
// own reasoning. One agent to drive; N devices doing work underneath.
//
// A delegated run is a real session (visible in the session list, replayable in
// the timeline) tagged source:"fleet" so the UI can group it under its lead.

const HeadlessSocket = require("./ws/headless-socket");

/**
 * @param {object} deps
 * @param {object} deps.db                 session store
 * @param {object} deps.harnessRegistry    connected remote adapters (ws/harness)
 * @param {Function} deps.handleStartTask   server.js turn runner (drives any harness)
 */
function createFleet({ db, harnessRegistry, handleStartTask }) {
  // Devices the lead can delegate to: the local host is always present; every
  // connected remote adapter is a candidate too.
  function listDevices() {
    const remotes = harnessRegistry.list().map((h) => ({
      id: h.id,
      name: h.name || h.id,
      machine: h.machine || h.id,
      transport: "remote",
      status: h.status || "connected",
    }));
    return [
      { id: "local", name: "this host", machine: "local", transport: "local", status: "connected" },
      ...remotes,
    ];
  }

  /**
   * Run `prompt` on `device` and resolve with its final text. `device` is a
   * harness id from listDevices ("local" or a connected remote id).
   */
  async function dispatchToDevice({ device, prompt, mode, effort, source = "fleet", titlePrefix = "⇢" }) {
    if (!prompt || !prompt.trim()) throw new Error("a task/prompt is required");
    const harnessId = device || "local";
    if (harnessId !== "local" && !harnessRegistry.get(harnessId)) {
      const ids = listDevices().map((d) => d.id).join(", ");
      throw new Error(`device "${harnessId}" is not connected. Available: ${ids}`);
    }

    const sessionId = `${source}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const title = `${titlePrefix} ${harnessId}: ${prompt.slice(0, 48)}${prompt.length > 48 ? "…" : ""}`;
    try {
      db.saveSession({
        id: sessionId,
        title,
        messages: [{ role: "user", content: prompt }],
        logs: [],
        executionPlan: "",
        mode: mode || "",
        metrics: {},
        subagentTree: {},
        timestamp: Date.now(),
      });
    } catch (e) {
      console.error("[Fleet] initial save failed:", e.message);
    }

    const socket = new HeadlessSocket(sessionId, db, { title, source });
    socket.addUserMessage(prompt);

    // Recursion guard (best-effort): a delegate must not re-delegate, or a
    // typo'd loop could fan out forever. Exclude the fleet dispatch tool from
    // the delegate's toolset by every name pi might expose it under.
    const noRedelegate = ["dispatch_to_device", "mcp_orbit-fleet_dispatch_to_device", "orbit-fleet_dispatch_to_device"];

    await handleStartTask(
      socket, prompt, sessionId,
      mode || "", "standard", [], effort || "balanced",
      harnessId, noRedelegate,
    );

    return {
      sessionId,
      device: harnessId,
      status: socket._status || "done",
      output: socket.getResult(),
    };
  }

  return { listDevices, dispatchToDevice };
}

module.exports = createFleet;
