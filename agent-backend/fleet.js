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
  // Local agent TYPES the lead can delegate to on this host (each is a harness
  // id that handleStartTask routes locally). This is what enables mixing agents
  // — e.g. run one subtask on pi and another on OpenCode from the same chat.
  const LOCAL_AGENTS = {
    local: { name: "pi-code (this host)", agent: "pi" },
    opencode: { name: "OpenCode (this host)", agent: "opencode" },
  };

  // Targets the lead can delegate to: local agent types + every connected remote
  // device (which runs whatever agent that device's adapter hosts).
  function listDevices() {
    const locals = Object.entries(LOCAL_AGENTS).map(([id, v]) => ({
      id, name: v.name, machine: "local", transport: "local", agent: v.agent, status: "connected",
    }));
    const remotes = harnessRegistry.list().map((h) => ({
      id: h.id,
      name: h.name || h.id,
      machine: h.machine || h.id,
      transport: "remote",
      status: h.status || "connected",
    }));
    return [...locals, ...remotes];
  }

  /**
   * Run `prompt` on `device` and resolve with its final text. `device` is a
   * target id from listDevices: a local agent type ("local" = pi, "opencode")
   * or a connected remote device id.
   */
  async function dispatchToDevice({ device, prompt, mode, effort, source = "fleet", titlePrefix = "⇢" }) {
    if (!prompt || !prompt.trim()) throw new Error("a task/prompt is required");
    const harnessId = device || "local";
    const isLocalAgent = Object.prototype.hasOwnProperty.call(LOCAL_AGENTS, harnessId);
    if (!isLocalAgent && !harnessRegistry.get(harnessId)) {
      const ids = listDevices().map((d) => d.id).join(", ");
      throw new Error(`target "${harnessId}" is not available. Valid targets: ${ids}`);
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

    // Delegates run headless and can't answer an approval prompt, so they need a
    // mode that actually lets them work. Default to "edit" (shell/read/network
    // allowed; each delegate is isolated in its own session workspace) — "chat"
    // blocks shell, which made delegates finish silently with 0 tool calls.
    await handleStartTask(
      socket, prompt, sessionId,
      mode || "edit", "standard", [], effort || "balanced",
      harnessId, noRedelegate,
    );

    // handleStartTask returns once the run is DRIVEN, not finished (harnesses
    // stream asynchronously). Wait for the run to actually complete so the lead
    // gets the delegate's real answer — with a ceiling so a hung delegate can't
    // block the lead forever.
    const TIMEOUT_MS = 5 * 60 * 1000;
    await Promise.race([
      socket.whenDone(),
      new Promise((res) => setTimeout(res, TIMEOUT_MS)),
    ]);

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
