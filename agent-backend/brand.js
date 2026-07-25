// agent-backend/brand.js
//
// Every product-name-bearing IDENTIFIER the backend uses, in one place.
//
// This exists because names here are matched as literal strings by code that
// makes security decisions, and a missed rename does not raise an error — the
// check simply stops matching. Routing them through one module turns "find
// every literal spelling of the tool name" into "edit one file".
//
// ── Why these are literals, not `` `${SLUG}-fleet` `` ──────────────────────
// Deriving them from a slug would make the rebrand a one-character edit, but it
// would also make `grep tether-fleet` return nothing — and grep is how both the
// rebrand drift gate and a human debugging a tool call find these. So: one
// module (cheap to edit), explicit literals (greppable). Both properties matter.
//
// A rebrand edits this file and then runs the drift gate in docs/rebranding.md.

/** Display name. UI chrome, log prefixes, prose. */
const BRAND = "Tether";

/** Lowercase identifier slug. Data paths, docker identity, storage keys. */
const SLUG = "tether";

/**
 * Provider id registered with the pi CLI and written into OpenCode's config.
 *
 * NOTE: this leaks into stored data — pi resolves models as `<PROVIDER_ID>/<model>`,
 * so config rows hold model ids prefixed with it. Changing it invalidates those.
 */
const PROVIDER_ID = "tether";
const PROVIDER_NAME = BRAND;

/**
 * Built-in MCP servers, by role. The values are the names the agent sees, and
 * the keys are what code should reference.
 *
 * Registered in server.js; a server added there MUST be added here too, or the
 * name-matching below silently stops covering it.
 */
const MCP = {
  fleet: "tether-fleet",
  notify: "tether-notify",
  ask: "tether-ask",
  build: "tether-build",
  search: "tether-search",
  transcript: "tether-transcript",
  registry: "tether-registry",
  backend: "tether-agent-backend",
};

// ── Tool-name manglings ──────────────────────────────────────────────
// The same MCP tool is spelled three different ways depending on who is doing
// the matching, and each spelling used to be written out by hand at a different
// call site. That is exactly how a rename goes half-done.
//
//   pi prefixes MCP tools:            mcp_<server>_<tool>
//   some policy configs use a flat:   <server-with-underscores>_<tool>
//   the registry itself uses:         <server>

/** How pi names a tool provided by an MCP server: `mcp_tether-fleet_dispatch_to_device`. */
function mcpToolName(server, tool) {
  return `mcp_${server}_${tool}`;
}

/** Flat underscore form used by policy allowlists: `tether_notify`. */
function flatToolName(server, tool) {
  const base = String(server).replace(/-/g, "_");
  return tool ? `${base}_${tool}` : base;
}

/**
 * Every spelling of the fleet dispatch tool. The anti-recursion guard in
 * fleet.js matches against this — a delegate that could re-delegate loops.
 */
const FLEET_DISPATCH_TOOL = "dispatch_to_device";
const FLEET_DISPATCH_NAMES = [
  FLEET_DISPATCH_TOOL,
  mcpToolName(MCP.fleet, FLEET_DISPATCH_TOOL),
  flatToolName(MCP.fleet, FLEET_DISPATCH_TOOL),
];

/** True if a tool-call name is the fleet dispatch tool, in any spelling. */
function isFleetDispatch(name) {
  if (!name) return false;
  const n = String(name);
  return FLEET_DISPATCH_NAMES.some((candidate) => n === candidate || n.endsWith(candidate));
}

/**
 * The notify tool, in the spellings the policy engine treats as meta tools.
 *
 * ⚠ Deliberately does NOT include pi's prefixed spelling
 * (`mcp_<notify-server>_notify`). That spelling is classified as a `network`
 * capability today, and the same was true before this constant existed —
 * adding it here would LOOSEN policy, not preserve it. That is a product
 * decision, not part of a rename. See NOTIFY_MCP_TOOL below.
 */
const NOTIFY_TOOL = "notify";
const NOTIFY_NAMES = [
  NOTIFY_TOOL,
  flatToolName(MCP.notify),
];

/**
 * How pi actually names the notify tool. Currently classified as `network`
 * rather than as a meta tool — see the note on NOTIFY_NAMES. Exported so the
 * inconsistency is at least visible and greppable instead of implicit.
 */
const NOTIFY_MCP_TOOL = mcpToolName(MCP.notify, NOTIFY_TOOL);

/** All registered built-in MCP server names. */
function builtinMcpNames() {
  return Object.values(MCP);
}

module.exports = {
  BRAND,
  SLUG,
  PROVIDER_ID,
  PROVIDER_NAME,
  MCP,
  mcpToolName,
  flatToolName,
  FLEET_DISPATCH_TOOL,
  FLEET_DISPATCH_NAMES,
  isFleetDispatch,
  NOTIFY_TOOL,
  NOTIFY_NAMES,
  NOTIFY_MCP_TOOL,
  builtinMcpNames,
};
