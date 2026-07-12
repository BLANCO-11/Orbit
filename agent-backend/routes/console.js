// agent-backend/routes/console.js
// A minimal operator console: run a shell command in the agent runtime's own
// working directory (the project root) and return its output. This is the
// OPERATOR's shell, not the agent's — it is deliberately NOT gated by the agent
// security policy (the operator outranks the agent). It is still authed and
// bound to loopback like the rest of the API; do not expose :6800 publicly with
// this enabled without an API key.

const { Router } = require("express");
const { exec } = require("child_process");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const TIMEOUT_MS = 20000;
const MAX_OUTPUT = 200 * 1024; // 200KB cap per stream

function createConsoleRouter() {
  const router = Router();

  router.get("/cwd", (req, res) => res.json({ success: true, cwd: PROJECT_ROOT }));

  router.post("/exec", (req, res) => {
    const command = (req.body && req.body.command || "").trim();
    if (!command) return res.status(400).json({ success: false, error: "command required" });
    exec(command, { cwd: PROJECT_ROOT, timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, shell: "/bin/bash" }, (err, stdout, stderr) => {
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
