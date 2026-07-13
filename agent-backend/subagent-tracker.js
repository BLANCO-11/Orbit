// ═══════════════════════════════════════════════════════════════════════
// SubagentTracker — end-to-end subagent lifecycle tracking
// ═══════════════════════════════════════════════════════════════════════
// Tracks every subagent with full reasoning steps, tool calls, 
// latency, and nested child relationships.

const { estimateTokens } = require("./metrics.js");

// ── Status Constants ────────────────────────────────────────────────
const STATUS = {
  SPAWNING: "spawning",
  REASONING: "reasoning",
  WORKING: "working",
  BLOCKED: "blocked",
  COMPLETED: "completed",
  FAILED: "failed",
};

class SubagentTracker {
  constructor(sessionId) {
    this.sessionId = sessionId;
    /** Map<agentId, SubagentNode> */
    this._agents = new Map();
    /** Array of root-level agent IDs (main agent + direct subagents) */
    this._roots = [];
    /** Observers: callback(sessionId, event) for WebSocket emit */
    this._observers = [];
    /** Tracking active tool call timers per agent */
    this._toolTimers = new Map();
  }

  /**
   * Register a callback for subagent lifecycle events.
   * Callback receives (sessionId, event):
   *   { type: "subagent_spawned" | "subagent_reasoning" | "subagent_tool_start" |
   *     "subagent_tool_end" | "subagent_completed" | "subagent_failed" | 
   *     "subagent_update", data: {...} }
   */
  onEvent(callback) {
    this._observers.push(callback);
  }

  _emit(type, data) {
    const event = { type, data: { ...data, sessionId: this.sessionId } };
    for (const cb of this._observers) {
      try { cb(this.sessionId, event); } catch (e) { console.error("[SubagentTracker] Observer error:", e); }
    }
  }

  // ── Agent Lifecycle ───────────────────────────────────────────────

  /**
   * Register a subagent spawn.
   * @param {string} agentId - unique subagent identifier
   * @param {string} name - subagent name/role
   * @param {string} [parentId] - parent subagent ID (null = main agent)
   * @param {string} [mode] - inherited mode
   * @param {string} [task] - the task/instruction given to the subagent
   * @returns {object} the subagent node
   */
  spawnAgent(agentId, name, parentId = null, mode = "", task = "") {
    const node = {
      id: agentId,
      name,
      parentId,
      status: STATUS.SPAWNING,
      mode,
      task,
      timeStart: new Date().toISOString(),
      timeEnd: null,
      toolCalls: [],
      reasoning: [],
      tokens: { input: 0, output: 0, reasoning: 0, total: 0 },
      results: "",
      children: [],
    };
    this._agents.set(agentId, node);

    // Link to parent
    if (parentId) {
      const parent = this._agents.get(parentId);
      if (parent) {
        parent.children.push(agentId);
      }
    } else {
      this._roots.push(agentId);
    }

    this._emit("subagent_spawned", node);
    return node;
  }

  /**
   * Credit a FLEET-delegated lane with the stats its delegate racked up in its
   * own session (a dispatched agent runs elsewhere, so its tool calls/tokens
   * never flow through this tracker). Matches the most recent uncredited lane
   * named `⇢ <device>`.
   */
  creditDelegate(device, { toolCalls = 0, tokens = 0, childSessionId } = {}) {
    const laneName = `⇢ ${device}`;
    let lane = Array.from(this._agents.values())
      .filter((a) => a.name === laneName && !a._credited)
      .sort((a, b) => new Date(b.timeStart) - new Date(a.timeStart))[0];
    if (!lane) {
      // Fallback: match any uncredited lane starting with "⇢"
      lane = Array.from(this._agents.values())
        .filter((a) => a.name.startsWith("⇢") && !a._credited)
        .sort((a, b) => new Date(b.timeStart) - new Date(a.timeStart))[0];
    }
    if (!lane) return;
    lane._credited = true;
    lane._delegatedToolCalls = toolCalls;
    lane.tokens.total = (lane.tokens.total || 0) + tokens;
    lane.childSessionId = childSessionId || null;
    if (lane.name === "⇢ device") {
      lane.name = `⇢ ${device}`;
    }
    this._emit("subagent_update", { agentId: lane.id, status: lane.status });
  }

  /**
   * Get a subagent node by ID.
   */
  getAgent(agentId) {
    return this._agents.get(agentId) || null;
  }

  /**
   * Get all registered agents for this session.
   */
  getAllAgents() {
    return Array.from(this._agents.values());
  }

  /**
   * Get root-level agents (no parent).
   */
  getRootAgents() {
    return this._roots.map(id => this._agents.get(id)).filter(Boolean);
  }

  /**
   * Build a nested tree structure for UI rendering.
   */
  getAgentTree() {
    const buildTree = (agentIds) => {
      return agentIds.map(id => {
        const node = this._agents.get(id);
        if (!node) return null;
        return {
          ...node,
          children: node.children.length > 0 ? buildTree(node.children) : [],
        };
      }).filter(Boolean);
    };
    return buildTree(this._roots);
  }

  /**
   * Set agent status.
   */
  setStatus(agentId, status, detail = "") {
    const agent = this._agents.get(agentId);
    if (!agent) return;
    agent.status = status;
    if (status === STATUS.REASONING) {
      agent.status = STATUS.REASONING;
    } else if (status === STATUS.WORKING) {
      agent.status = STATUS.WORKING;
    } else if (status === STATUS.BLOCKED) {
      agent.status = STATUS.BLOCKED;
    } else if (status === STATUS.COMPLETED || status === "done" || status === "completed") {
      agent.status = STATUS.COMPLETED;
      agent.timeEnd = new Date().toISOString();
    } else if (status === STATUS.FAILED || status === "error" || status === "failed") {
      agent.status = STATUS.FAILED;
      agent.timeEnd = new Date().toISOString();
    }
    this._emit("subagent_update", { agentId, status: agent.status, detail });
  }

  /**
   * Mark agent as reasoning (thinking phase).
   */
  markReasoning(agentId) {
    this.setStatus(agentId, STATUS.REASONING);
  }

  /**
   * Mark agent as executing tools.
   */
  markWorking(agentId) {
    this.setStatus(agentId, STATUS.WORKING);
  }

  /**
   * Mark agent as completed with optional results summary.
   */
  markCompleted(agentId, results = "") {
    this.setStatus(agentId, STATUS.COMPLETED);
    const agent = this._agents.get(agentId);
    if (agent && results) {
      agent.results = String(results).substring(0, 1000);
    }
    this._emit("subagent_completed", { agentId, results: agent?.results });
  }

  /**
   * Mark agent as failed with error message.
   */
  markFailed(agentId, error) {
    this.setStatus(agentId, STATUS.FAILED, String(error));
    this._emit("subagent_failed", { agentId, error: String(error) });
  }

  // ── Reasoning Tracking ────────────────────────────────────────────

  /**
   * Record a reasoning step for an agent.
   */
  addReasoning(agentId, content, tokens) {
    const agent = this._agents.get(agentId);
    if (!agent) return;
    const tok = tokens || estimateTokens(content);
    agent.reasoning.push({
      content,
      timestamp: new Date().toISOString(),
      tokens: tok,
    });
    agent.tokens.reasoning += tok;
    agent.tokens.total += tok;

    this._emit("subagent_reasoning", {
      agentId,
      delta: tok,
      contentSnippet: String(content).substring(0, 200),
    });
  }

  // ── Tool Call Tracking ────────────────────────────────────────────

  /**
   * Record a tool call start for an agent.
   */
  startToolCall(agentId, toolCallId, toolName, args) {
    const agent = this._agents.get(agentId);
    if (!agent) return;

    // Track latency
    if (!this._toolTimers.has(agentId)) {
      this._toolTimers.set(agentId, new Map());
    }
    this._toolTimers.get(agentId).set(toolCallId, Date.now());

    agent.toolCalls.push({
      name: toolName,
      toolCallId,
      args: args ? (typeof args === "string" ? args.substring(0, 300) : JSON.stringify(args).substring(0, 300)) : "",
      result: "",
      startTime: new Date().toISOString(),
      endTime: null,
      latencyMs: 0,
    });

    this._emit("subagent_tool_start", {
      agentId,
      toolName,
      toolCallId,
      args,
    });
  }

  /**
   * Record a tool call completion for an agent.
   */
  endToolCall(agentId, toolCallId, result, resultTokens) {
    const agent = this._agents.get(agentId);
    if (!agent) return;

    const timerMap = this._toolTimers.get(agentId);
    let latencyMs = 0;
    if (timerMap) {
      const start = timerMap.get(toolCallId);
      if (start) {
        latencyMs = Date.now() - start;
        timerMap.delete(toolCallId);
      }
    }

    // Find the tool call in the agent's list
    const tc = agent.toolCalls.find(t => t.toolCallId === toolCallId);
    if (tc) {
      tc.result = result ? String(result).substring(0, 500) : "";
      tc.endTime = new Date().toISOString();
      tc.latencyMs = latencyMs;
    }

    const tok = resultTokens || (result ? estimateTokens(String(result)) : 0);
    agent.tokens.output += tok;
    agent.tokens.total += tok;

    this._emit("subagent_tool_end", {
      agentId,
      toolName: tc?.name || "unknown",
      toolCallId,
      latencyMs,
      tokens: tok,
    });

    return latencyMs;
  }

  // ── Mode Inheritance ──────────────────────────────────────────────

  /**
   * Depth of an agent in the spawn tree. A root sub-agent (parentId=null) is
   * depth 1; its children are depth 2; etc. Used to enforce maxSubagentDepth.
   * `parentId` may reference an agent not yet spawned — treat as root.
   */
  depthOf(parentId) {
    let depth = 1;
    let cur = parentId;
    const seen = new Set();
    while (cur && this._agents.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      depth++;
      cur = this._agents.get(cur).parentId;
    }
    return depth;
  }

  /**
   * Get the effective mode for an agent, walking up to parent if not set.
   */
  getEffectiveMode(agentId) {
    const agent = this._agents.get(agentId);
    if (!agent) return "";
    if (agent.mode) return agent.mode;
    if (agent.parentId) {
      return this.getEffectiveMode(agent.parentId);
    }
    return "";
  }

  // ── Serialization ─────────────────────────────────────────────────

  /**
   * Serialize the full agent tree for persistence.
   */
  toJSON() {
    return {
      sessionId: this.sessionId,
      agents: Array.from(this._agents.values()),
    };
  }

  /**
   * Load serialized agent data.
   */
  fromJSON(data) {
    if (!data || !data.agents) return;
    this._agents.clear();
    this._roots = [];
    for (const agent of data.agents) {
      this._agents.set(agent.id, agent);
      // Rebuild tool timers map
      this._toolTimers.set(agent.id, new Map());
    }
    // Rebuild roots
    for (const [id, agent] of this._agents) {
      if (!agent.parentId) {
        this._roots.push(id);
      }
    }
  }

  /**
   * Get a compact summary for the frontend metrics display.
   */
  toFrontendSummary() {
    return Array.from(this._agents.values()).map(agent => {
      const lastTc = agent.toolCalls.length > 0 ? agent.toolCalls[agent.toolCalls.length - 1] : null;
      const allReasoning = agent.reasoning.map(r => r.content).join("\n");
      const isActive = agent.status === STATUS.WORKING || agent.status === STATUS.SPAWNING || agent.status === STATUS.REASONING;
      
      // Derive currentAction from last tool call or reasoning state
      let currentAction = "";
      if (lastTc) {
        currentAction = lastTc.name;
      } else if (agent.status === STATUS.REASONING) {
        currentAction = "reasoning";
      } else if (agent.status === STATUS.BLOCKED) {
        currentAction = "ask_permission";
      }
      
      // Get recent tool calls (last 5) for the UI
      const recentToolCalls = agent.toolCalls.slice(-5).map(tc => ({
        name: tc.name,
        status: tc.endTime ? "done" : "running",
        latencyMs: tc.latencyMs,
      }));
      
      return {
        id: agent.id,
        name: agent.name,
        status: agent.status,
        mode: agent.mode,
        inheritedMode: this.getEffectiveMode(agent.id),
        parentId: agent.parentId,
        toolCalls: agent.toolCalls.length + (agent._delegatedToolCalls || 0),
        tokens: agent.tokens.total,
        childSessionId: agent.childSessionId || null,
        reasoning: allReasoning,
        currentAction,
        recentToolCalls,
        time: agent.timeStart ? new Date(agent.timeStart).toLocaleTimeString() : "",
        timeEnd: agent.timeEnd ? new Date(agent.timeEnd).toLocaleTimeString() : "",
        timeStart: agent.timeStart,
        lastToolName: lastTc ? lastTc.name : null,
        task: agent.task ? agent.task.substring(0, 100) : "",
      };
    });
  }

  /**
   * Clean up resources.
   */
  release() {
    this._agents.clear();
    this._roots = [];
    this._toolTimers.clear();
    this._observers = [];
  }
}

module.exports = {
  SubagentTracker,
  STATUS,
};
