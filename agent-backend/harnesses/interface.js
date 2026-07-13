// agent-backend/harnesses/interface.js
// Abstract harness interface — documentation + contract reference
// All harnesses must implement this shape.

/**
 * HarnessInterface — contract for agent harness adapters.
 *
 * Lifecycle: connect() → sendPrompt() → [emits events] → disconnect()
 *
 * Standard Events (emitted on `events` EventEmitter passed at construction):
 *
 *   'text_delta'          { delta: string }
 *     — Streaming text from the agent.
 *
 *   'thinking_delta'      { delta: string }
 *     — Streaming reasoning/thinking from the agent.
 *
 *   'tool_call_start'     { id, name, arguments }
 *     — Agent began executing a tool.
 *
 *   'tool_call_end'       { id, name, result }
 *     — Agent completed a tool execution.
 *
 *   'subagent_spawned'    { subagentId, name, mode, task }
 *     — A sub-agent was spawned.
 *
 *   'subagent_reasoning'  { subagentId, delta, tokens }
 *     — Streaming reasoning from a sub-agent.
 *
 *   'subagent_text'       { subagentId, delta }
 *     — Streaming text output from a sub-agent.
 *
 *   'subagent_tool_start' { subagentId, toolCallId, name, arguments }
 *     — Sub-agent began executing a tool.
 *
 *   'subagent_tool_end'   { subagentId, toolCallId, name, result }
 *     — Sub-agent completed a tool execution.
 *
 *   'subagent_completed'  { subagentId, summary, results }
 *     — Sub-agent finished its task.
 *
 *   'agent_end'           {}
 *     — Agent completed the current prompt turn.
 *
 *   'error'               { message }
 *     — Error from the agent process.
 *
 *   'close'               { code }
 *     — Agent process exited.
 */

class HarnessInterface {
  /**
   * @param {object} options
   * @param {import('events').EventEmitter} options.events — harness emits standardized events here
   * @param {object} options.config — the full security-config.json
   * @param {string} options.sessionId
   * @param {string} options.mode — 'chat' | 'plan' | 'edit' | 'yolo'
   * @param {string} options.systemPromptType — prompt library id (e.g. 'standard', 'claude-fable-5')
   * @param {string[]} [options.skills] — attached skill ids, appended to the system prompt
   * @param {object} [options.binaries] — { nodePath, piPath } from env discovery
   */
  constructor(options) {
    this.events = options.events;
    this.config = options.config;
    this.sessionId = options.sessionId;
    this.mode = options.mode;
    this.systemPromptType = options.systemPromptType;
    this.skills = options.skills || [];
    this.model = options.model || null; // effort-profile-resolved model (overrides config default)
    this.excludeTools = options.excludeTools || null; // tool names to disable this session (null = harness default)
    this.binaries = options.binaries || {};
    this.capabilitiesBlock = options.capabilitiesBlock || ""; // dynamic "what's configured now" prompt block (Workstream D2)
  }

  /**
   * Enumerate the tools this harness can offer, so the console can render a
   * tools/extensions manager without knowing anything harness-specific.
   * Returns [{ id, name, source, description, enabledByDefault }].
   * Base implementation: none.
   */
  async listTools() {
    return [];
  }

  /** Spawn and initialize the agent. Must resolve when agent is ready to receive prompts. */
  async connect() {
    throw new Error("connect() not implemented");
  }

  /** Send a user prompt to the running agent. */
  async sendPrompt(prompt) {
    throw new Error("sendPrompt() not implemented");
  }

  /** Interrupt/cancel the current operation without killing the process. */
  async cancel() {
    throw new Error("cancel() not implemented");
  }

  /** Kill the agent process and clean up resources. */
  async disconnect() {
    throw new Error("disconnect() not implemented");
  }

  /** Returns metadata about this harness for the dashboard. */
  getMetadata() {
    return {
      name: "unknown",
      version: "0.0.0",
      capabilities: [],
    };
  }
}

module.exports = HarnessInterface;
