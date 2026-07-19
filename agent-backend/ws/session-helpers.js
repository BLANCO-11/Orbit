// agent-backend/ws/session-helpers.js
// WebSocket + path helper functions extracted from server.js

const path = require("path");
const os = require("os");

function getActiveSessionId(ws) {
  return (ws && ws.activeSessionId) ? ws.activeSessionId : "unknown";
}

function sendLog(ws, content, isSystem = true, explicitSessionId = null) {
  const sid = explicitSessionId || getActiveSessionId(ws);
  console.log(`[Log][${sid}] ${content}`);
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "log", content, isSystem, sessionId: sid }));
  }
}

function sendStatus(ws, status, explicitSessionId = null) {
  const sid = explicitSessionId || getActiveSessionId(ws);
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "status", status, sessionId: sid }));
  }
}

function sendWithSession(ws, data, explicitSessionId = null) {
  if (!ws || ws.readyState !== 1) return;
  const sid = explicitSessionId || getActiveSessionId(ws);
  ws.send(JSON.stringify({ ...data, sessionId: sid }));
}

const PROJECT_ROOT = path.resolve(__dirname, "../..");

function resolveTargetPath(inputPath) {
  if (inputPath.startsWith("~")) {
    return inputPath.replace(/^~/, os.homedir());
  }
  return path.resolve(inputPath);
}

function isPathAllowed(targetPath, sessionId) {
  try {
    const resolved = resolveTargetPath(targetPath);
    const workspaceRoot = sessionId && sessionId !== "unknown"
      ? require("../workspace-paths").sessionRoot(sessionId)
      : PROJECT_ROOT;
    return resolved.startsWith(workspaceRoot + "/") || resolved === workspaceRoot;
  } catch (e) {
    return false;
  }
}

/** True if `targetPath` resolves inside `root` (or equals it). */
function isUnder(targetPath, root) {
  if (!root) return false;
  try {
    const resolved = resolveTargetPath(targetPath);
    const base = resolveTargetPath(root);
    return resolved === base || resolved.startsWith(base + path.sep);
  } catch { return false; }
}

/** True if the path is inside ANY of the given roots (session safe zone + durable allow-list). */
function isPathInZones(targetPath, zones = []) {
  return zones.some((z) => isUnder(targetPath, z));
}

/**
 * True if the path is hard-blocked (source, ~/.ssh, system dirs, …). Blocked
 * paths are refused for READ and WRITE alike, and user consent CANNOT override
 * them — this is the guardrail below the permission layer.
 */
function isPathBlocked(targetPath, blockedPaths = []) {
  return (blockedPaths || []).some((b) => isUnder(targetPath, b));
}

// Argument keys that carry a filesystem path. Kept as a single exported source
// of truth so the gate (server.js) can ask "does this tool name any path at all?"
// against the exact same list the extractor scans. Broadened (Vuln D) to cover
// tools that name their target with a non-standard key.
const PATH_FIELDS = [
  "path", "filePath", "dir", "directory", "target", "destination",
  "source", "location", "folder",
  "filename", "outputPath", "file", "uri", "targetPath",
];

/** True if `args` names a path in ANY known path field (regardless of whether it
 *  is absolute/relative). Used to tell a genuine no-target tool call (Vuln C)
 *  apart from one whose target is a relative string the extractor's anchor misses. */
function hasPathField(args) {
  if (!args) return false;
  if (typeof args === "string") {
    try { args = JSON.parse(args); } catch (e) { return false; }
  }
  if (typeof args !== "object") return false;
  return PATH_FIELDS.some((f) => typeof args[f] === "string" && args[f].trim() !== "");
}

function extractPathsFromArgs(args) {
  const paths = [];
  if (!args) return paths;
  if (typeof args === "string") {
    try { args = JSON.parse(args); } catch(e) { return paths; }
  }
  const pathFields = PATH_FIELDS;
  for (const field of pathFields) {
    if (args[field] && typeof args[field] === "string" && /^([~\/.\\]|[a-zA-Z]:\\)/.test(args[field])) {
      paths.push(args[field]);
    }
  }
  if (args.command && typeof args.command === "string") {
    const cmdPaths = args.command.match(/(?:^|\s)(?:cd\s+|cat\s+|ls\s+|rm\s+|cp\s+|mv\s+|mkdir\s+|touch\s+|chmod\s+|chown\s+)([~\/][^\s;|&]+)/gi);
    if (cmdPaths) {
      cmdPaths.forEach(cp => {
        const p = cp.replace(/^\s*\w+\s+/, "").trim();
        if (p) paths.push(p);
      });
    }
  }
  return paths;
}

module.exports = {
  getActiveSessionId, sendLog, sendStatus, sendWithSession,
  PROJECT_ROOT, resolveTargetPath, isPathAllowed, extractPathsFromArgs,
  isUnder, isPathInZones, isPathBlocked,
  PATH_FIELDS, hasPathField,
};
