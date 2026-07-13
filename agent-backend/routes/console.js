// agent-backend/routes/console.js
// A minimal operator console: run a shell command in the CURRENT session's own
// workspace directory (~/.orbit/sessions/<id>/workspace) — the same cwd the
// agent's shell uses — and return its output. This is the OPERATOR's shell, not
// the agent's — it is deliberately NOT gated by the agent security policy (the
// operator outranks the agent). It is still authed and bound to loopback like
// the rest of the API; do not expose :6800 publicly with this enabled without
// an API key.
//
// Soft guard (per NEXT-ITERATION-PLAN Workstream B1): the cwd is pinned to the
// session workspace and commands that reference a hard-blocklisted path
// (blockedPaths / writeBlockedPaths from security-config) are refused. This is
// NOT a jail — a shell can still `cd /` — it just makes the default safe and
// keeps casual mistakes inside the session sandbox. A true jail routes exec
// through the container harness (later opt-in).

const { Router } = require("express");
const { exec } = require("child_process");
const path = require("path");
const workspacePaths = require("../workspace-paths");
const { loadConfig } = require("../config");

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const TIMEOUT_MS = 20000;
const MAX_OUTPUT = 200 * 1024; // 200KB cap per stream

// Resolve the cwd for a request: the session workspace when a session id is
// given (created if missing), else the Orbit project root (legacy behavior for
// operator sessions with no active session).
function cwdFor(session) {
  if (session) {
    const dirs = workspacePaths.ensureSessionDirs(session);
    return dirs.workspace;
  }
  return PROJECT_ROOT;
}

// Best-effort: reject a command that names a hard-blocklisted absolute path.
// Soft — a determined shell can construct paths dynamically — but it catches
// the obvious `cat /home/blanco/.ssh/id_rsa` class of mistakes.
function blockedReason(command) {
  let blocked = [];
  try {
    const fsCfg = (loadConfig() || {}).fileSystem || {};
    blocked = [...(fsCfg.blockedPaths || []), ...(fsCfg.writeBlockedPaths || [])];
  } catch { /* config unreadable — no extra guard */ }
  for (const p of blocked) {
    if (!p) continue;
    const resolved = path.resolve(p);
    // Match the literal path or any child reference in the command string.
    if (command.includes(resolved) || command.includes(p)) {
      return `Blocked: command references a restricted path (${p}).`;
    }
  }
  return null;
}

function createConsoleRouter() {
  const router = Router();

  router.get("/cwd", (req, res) => {
    const session = (req.query.session || "").trim();
    res.json({ success: true, cwd: cwdFor(session) });
  });

  router.post("/exec", (req, res) => {
    const command = (req.body && req.body.command || "").trim();
    const session = (req.body && req.body.session || "").trim();
    if (!command) return res.status(400).json({ success: false, error: "command required" });

    const reason = blockedReason(command);
    if (reason) {
      return res.json({ success: true, command, stdout: "", stderr: reason, code: 126, timedOut: false });
    }

    const cwd = cwdFor(session);
    exec(command, { cwd, timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, shell: "/bin/bash" }, (err, stdout, stderr) => {
      res.json({
        success: true,
        command,
        stdout: String(stdout || "").slice(0, MAX_OUTPUT),
        stderr: String(stderr || "").slice(0, MAX_OUTPUT),
        code: err ? (typeof err.code === "number" ? err.code : 1) : 0,
        timedOut: Boolean(err && err.killed),
      });
    });
  });

  return router;
}

module.exports = createConsoleRouter;
