// agent-backend/tool-catalog.js
// Observed-tools catalog. The backend can't statically enumerate every tool a
// harness (or its extensions/MCP servers) provides, so we learn tool names the
// first time they're used: every tool_call_start records the tool against its
// harness type. listTools() merges this with the statically-known set, so the
// "available tools" list self-populates as the agent works.
//
// Runtime data, keyed by harness type. Persisted so the catalog survives
// restarts. Gitignored (like other runtime state).

const fs = require("fs");
const path = require("path");

const CATALOG_PATH = path.join(__dirname, "tool-catalog.json");

let catalog = {}; // { [harnessType]: { [toolName]: firstSeenISO } }
try {
  catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf-8"));
} catch {
  catalog = {};
}

let saveTimer = null;
function persist() {
  // Debounce writes — tool calls are frequent.
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2), "utf-8");
    } catch (e) {
      console.error("[ToolCatalog] persist failed:", e.message);
    }
  }, 2000);
}

/** Record that `toolName` was used by a harness of `harnessType`. */
function recordObserved(harnessType, toolName) {
  if (!harnessType || !toolName) return;
  if (!catalog[harnessType]) catalog[harnessType] = {};
  if (!catalog[harnessType][toolName]) {
    catalog[harnessType][toolName] = new Date().toISOString();
    persist();
  }
}

/** All tool names ever observed for a harness type. */
function getObserved(harnessType) {
  return Object.keys(catalog[harnessType] || {});
}

module.exports = { recordObserved, getObserved };
