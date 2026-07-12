// agent-backend/policy-engine.js
// Capability × mode policy matrix — the single source of truth for what the
// agent may do in each permission mode. Replaces the hardcoded mode gates that
// used to live inline in server.js. A decision is one of: allow | ask | block.
//
// Per-device overrides can only TIGHTEN (allow → ask → block), never loosen —
// a paired phone can be given a stricter matrix than the owner's default, but
// never a looser one.

const CAPABILITIES = [
  "read_workspace",
  "write_workspace",
  "write_outside",
  "shell",
  "network",
  "spawn_subagent",
];

const MODES = ["chat", "plan", "edit", "yolo"];

// Default matrix — matches the approved Policies mock. `chat` is read/answer
// only (no tools); `yolo` is unrestricted; `plan` reads and researches but
// doesn't write; `edit` writes in the workspace and asks before writing out.
const DEFAULT_MATRIX = {
  read_workspace: { chat: "block", plan: "allow", edit: "allow", yolo: "allow" },
  write_workspace: { chat: "block", plan: "block", edit: "allow", yolo: "allow" },
  write_outside: { chat: "block", plan: "block", edit: "ask", yolo: "allow" },
  shell: { chat: "block", plan: "block", edit: "allow", yolo: "allow" },
  // Network is allowed in chat: "look this up for me" is a core assistant use,
  // and the mandatory browser (Lightpanda) is a network capability — gating it
  // in chat forced needless mode-changes for plain web reads.
  network: { chat: "allow", plan: "allow", edit: "allow", yolo: "allow" },
  spawn_subagent: { chat: "block", plan: "allow", edit: "allow", yolo: "allow" },
};

const RANK = { allow: 0, ask: 1, block: 2 };
const byRank = (a, b) => (RANK[a] >= RANK[b] ? a : b); // strictest wins

/**
 * Map a tool call to the capability it exercises. `isOutsideWorkspace` is true
 * when the tool's target path resolves outside the workspace safe zone.
 */
function toolToCapability(toolName, isOutsideWorkspace = false) {
  const name = String(toolName || "");
  if (name === "subagent") return "spawn_subagent";
  if (name === "bash") return "shell";
  if (/^(write|edit|replace_file_content|multi_replace_file_content)$/.test(name)) {
    return isOutsideWorkspace ? "write_outside" : "write_workspace";
  }
  if (/^(read|find|grep|ls|code_search)$/.test(name)) return "read_workspace";
  if (name.startsWith("mcp_") || /^(web_search|fetch_content|get_search_content)$/.test(name)) {
    return "network";
  }
  // Unknown tool: treat as workspace write (the conservative choice — it will
  // be gated in chat/plan and allowed in edit/yolo like any other action).
  return "write_workspace";
}

/**
 * Merge a stored matrix over the defaults, keeping only valid decisions.
 */
function resolveMatrix(stored) {
  const matrix = {};
  for (const cap of CAPABILITIES) {
    matrix[cap] = {};
    for (const mode of MODES) {
      const v = stored?.[cap]?.[mode];
      matrix[cap][mode] = RANK[v] !== undefined ? v : DEFAULT_MATRIX[cap][mode];
    }
  }
  return matrix;
}

/**
 * Evaluate a capability in a mode against the resolved matrix, then apply the
 * device override (tighten-only). Returns { decision, capability }.
 */
function evaluate(capability, mode, config, deviceOverrides) {
  const activeMode = MODES.includes(mode) ? mode : "chat";
  const matrix = resolveMatrix(config?.policyMatrix);
  let decision = matrix[capability]?.[activeMode] ?? "block";

  const override = deviceOverrides?.[capability]?.[activeMode];
  if (RANK[override] !== undefined) {
    decision = byRank(decision, override); // override may only tighten
  }
  return { decision, capability };
}

module.exports = {
  CAPABILITIES,
  MODES,
  DEFAULT_MATRIX,
  toolToCapability,
  resolveMatrix,
  evaluate,
};
