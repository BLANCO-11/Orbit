// agent-backend/policy-engine.js
// Capability × mode policy matrix — the single source of truth for what the
// agent may do in each permission mode. Replaces the hardcoded mode gates that
// used to live inline in server.js. A decision is one of: allow | ask | block.
//
// Per-device overrides can only TIGHTEN (allow → ask → block), never loosen —
// a paired phone can be given a stricter matrix than the owner's default, but
// never a looser one.

const { isReadOnlyTool } = require("./harnesses/picode/parser");

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
  // Reads are allowed in chat: a chat assistant that literally cannot read a
  // file to answer "what does this do?" is the surprise. Reading is not a
  // mutation, so it never warrants a mode-switch (Workstream A2).
  read_workspace: { chat: "allow", plan: "allow", edit: "allow", yolo: "allow" },
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

// Meta/utility tools that neither mutate the workspace nor touch the network,
// shell, or filesystem — skills listing, plan/todo bookkeeping, notifications.
// These are pure agent bookkeeping and must NEVER trigger a mode-switch, so we
// classify them as read_workspace (allowed everywhere except by explicit
// tightening).
const META_TOOLS = new Set([
  "litellm_skill_list", "skill_list", "list_skills",
  "task", "todowrite", "todoread", "todo_write", "todo_read",
  "plan", "update_plan", "set_plan",
  "notify", "orbit_notify",
]);

/**
 * Map a tool call to the capability it exercises. `isOutsideWorkspace` is true
 * when the tool's target path resolves outside the workspace safe zone.
 *
 * The genuine mutators (write/edit/replace/bash/subagent) are matched
 * explicitly; everything else resolves to a non-halting capability. This is the
 * core fix for the chat-friction bug: unknown tools used to fall through to
 * `write_workspace` and get blocked in chat, forcing needless mode switches.
 */
function toolToCapability(toolName, isOutsideWorkspace = false) {
  const name = String(toolName || "");
  const lower = name.toLowerCase();
  if (lower === "subagent") return "spawn_subagent";
  if (lower === "bash") return "shell";
  if (/^(write|edit|replace_file_content|multi_replace_file_content)$/.test(lower)) {
    return isOutsideWorkspace ? "write_outside" : "write_workspace";
  }
  // Network: MCP tools (incl. the Lightpanda browser), native web search/fetch,
  // and the browser/web-fetch fallbacks.
  if (
    lower.startsWith("mcp_") ||
    /^(web_search|fetch_content|get_search_content|browser|web|webfetch|web_fetch)$/.test(lower)
  ) {
    return "network";
  }
  // Reads: route through the harness parser's read-only classifier so the two
  // never drift (it covers read/find/grep/ls/code_search + web reads), plus a
  // few directory-listing aliases.
  if (isReadOnlyTool(lower) || /^(glob|list_dir|list_directory|view|tree)$/.test(lower)) {
    return "read_workspace";
  }
  // Meta/utility tools (skills, todo, planning, notify) — non-blocking.
  if (META_TOOLS.has(lower)) return "read_workspace";
  // Unknown tool: default to the conservative-but-non-halting read_workspace
  // rather than write_workspace. Every genuine mutator is matched above; a new,
  // unrecognized tool is far more likely a read/query helper, and the hard
  // blocklist still guards protected paths for anything that does mutate.
  return "read_workspace";
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
