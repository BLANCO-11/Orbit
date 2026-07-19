// agent-backend/ws/session-helpers.js
// WebSocket + path helper functions extracted from server.js

const path = require("path");
const os = require("os");
const { parse: shellParse } = require("shell-quote");

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
  // NOTE: command-string paths are intentionally NOT extracted here anymore.
  // They are handled separately by extractCommandPaths() and fed ONLY to the
  // hard blocklist (see the gate) — never to the zone/capability logic that
  // uses this function's result. This keeps shell path tokens from ever soft-
  // gating an allowed command.
  return paths;
}

const CMD_PATH_RE = /^(~|\/|\.\.?\/|[a-zA-Z]:\\)/;

/**
 * Tokenize a shell command and return every argv token that looks like a
 * filesystem path — across operators (`&& || ; |`), redirects (`> >> <`), and
 * subshells (`$()`, backticks). Used ONLY to feed the hard blocklist (secrets +
 * Orbit source); it never drives zone/capability decisions, so a stray token can
 * hard-block a protected path but can never soft-gate an otherwise-allowed shell
 * command.
 *
 * shell-quote yields real argv tokens, so a path that appears only INSIDE a
 * quoted sub-expression (e.g. `sed 's|/etc/hosts|x|'`) stays one non-path token
 * and is correctly NOT extracted — avoiding false blocks. Honest limits (defense-
 * in-depth, not a guarantee): it cannot model `eval`, env-var expansion, or
 * interpreter-embedded paths (`python -c "open('/etc/x')"`). Containment is the
 * real guarantee for shell.
 */
function extractCommandPaths(command) {
  if (!command || typeof command !== "string") return [];
  const out = new Set();
  const consider = (tok) => {
    if (typeof tok !== "string" || !tok) return;
    if (CMD_PATH_RE.test(tok)) out.add(tok);
    // `--flag=/path` / `KEY=/path` — the path rides after an `=`.
    const eq = tok.lastIndexOf("=");
    if (eq >= 0) {
      const rhs = tok.slice(eq + 1);
      if (CMD_PATH_RE.test(rhs)) out.add(rhs);
    }
  };
  let tokens;
  try { tokens = shellParse(command); } catch { return []; }
  for (const t of tokens) {
    if (typeof t === "string") consider(t);
    else if (t && typeof t === "object" && typeof t.pattern === "string") consider(t.pattern); // glob
  }
  return [...out];
}

module.exports = {
  getActiveSessionId, sendLog, sendStatus, sendWithSession,
  PROJECT_ROOT, resolveTargetPath, isPathAllowed, extractPathsFromArgs,
  isUnder, isPathInZones, isPathBlocked,
  PATH_FIELDS, hasPathField, extractCommandPaths,
};
