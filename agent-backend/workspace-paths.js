// agent-backend/workspace-paths.js
//
// Per-session directory layout — the isolation + tracking backbone. Every
// session gets its own tree under Orbit's home, OFF the source repo, so the
// agent never writes into Orbit's own code and sessions can't see each other.
//
//   ~/.orbit/
//   └── sessions/<sessionId>/        ← one session = one boundary (the SAFE ZONE)
//       ├── workspace/               ← agent cwd + default writes (all task work)
//       ├── artifacts/               ← deliverables to keep (never auto-wiped)
//       └── tmp/                     ← scratch (wipeable)
//
// The whole session root is the writable safe zone; the workspace/artifacts/tmp
// split is semantic (the agent is told what each is for). Writes outside the
// root require the user's consent; blocklisted paths are refused outright.

const fs = require("fs");
const path = require("path");
const os = require("os");

const ORBIT_HOME = process.env.ORBIT_HOME || path.join(os.homedir(), ".orbit");
const SESSIONS_DIR = path.join(ORBIT_HOME, "sessions");

/** Filesystem-safe session id (defensive — ids are server-generated, but never trust a path segment). */
function safeId(sessionId) {
  const id = String(sessionId || "unknown").replace(/[^A-Za-z0-9._-]/g, "_");
  // Guard against empty / dot-only ids that could resolve to the parent dir.
  return /^[.]*$/.test(id) ? "unknown" : id.slice(0, 128);
}

function sessionRoot(sessionId) {
  return path.join(SESSIONS_DIR, safeId(sessionId));
}

/** The three canonical dirs for a session. */
function sessionDirs(sessionId) {
  const root = sessionRoot(sessionId);
  return {
    root,
    workspace: path.join(root, "workspace"),
    artifacts: path.join(root, "artifacts"),
    tmp: path.join(root, "tmp"),
  };
}

/** Create the session tree if missing. Idempotent; returns the dirs. Safe to call on every connect. */
function ensureSessionDirs(sessionId) {
  const dirs = sessionDirs(sessionId);
  for (const d of [dirs.root, dirs.workspace, dirs.artifacts, dirs.tmp]) {
    try { fs.mkdirSync(d, { recursive: true }); } catch (e) { /* best-effort */ }
  }
  return dirs;
}

/** Remove a session's whole tree (used when a session is deleted). */
function removeSessionDirs(sessionId) {
  try { fs.rmSync(sessionRoot(sessionId), { recursive: true, force: true }); } catch (e) {}
}

module.exports = {
  ORBIT_HOME, SESSIONS_DIR,
  safeId, sessionRoot, sessionDirs, ensureSessionDirs, removeSessionDirs,
};
