// agent-backend/lightpanda.js
//
// Keeps the Lightpanda headless-browser container alive. Lightpanda is the
// MANDATORY default browser for every agent — if it's down, agents lose web
// access entirely and fall back to nonsense (grepping the codebase with
// code_search, hallucinating). It runs as a Docker container on CDP port 9222;
// nothing used to (re)start it, so a single crash left it dead for days.
//
// This module makes it an always-on essential service:
//   - on boot, ensure the container exists and is running;
//   - always apply `--restart unless-stopped` so Docker itself revives it after
//     a crash or host reboot — no dependence on this process staying up.
//
// Everything is best-effort and non-fatal: no Docker / no image just logs a
// warning (the operator can still enable the web-access fallback in Settings).

const { execFile } = require("child_process");

const CONTAINER = "lightpanda-browser";
const IMAGE = "lightpanda/browser:nightly";
const PORT = 9222;
const RESTART_POLICY = "unless-stopped";

function docker(args, timeoutMs = 20000) {
  return new Promise((resolve) => {
    execFile("docker", args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: (stdout || "").trim(), stderr: (stderr || "").trim(), err });
    });
  });
}

async function dockerAvailable() {
  const r = await docker(["version", "--format", "{{.Server.Version}}"], 8000);
  return r.ok;
}

/** '' if no such container, else its state ("running" | "exited" | ...). */
async function containerState() {
  const r = await docker(["inspect", "-f", "{{.State.Status}}", CONTAINER], 8000);
  return r.ok ? r.stdout : "";
}

/**
 * Ensure the Lightpanda browser container is up with an auto-restart policy.
 * Idempotent and safe to call on every boot.
 */
async function ensureLightpandaRunning({ log = console } = {}) {
  if (!(await dockerAvailable())) {
    log.warn?.(
      "[Lightpanda] Docker not available — the mandatory browser can't be auto-started. " +
      "Start it manually or enable the web-access fallback in Settings."
    );
    return { ok: false, reason: "no-docker" };
  }

  const state = await containerState();

  if (!state) {
    // No container yet — create it with the restart policy baked in.
    log.log?.(`[Lightpanda] Container missing — creating ${CONTAINER} from ${IMAGE}…`);
    const run = await docker([
      "run", "-d",
      "--name", CONTAINER,
      "--restart", RESTART_POLICY,
      "-p", `127.0.0.1:${PORT}:${PORT}`,
      IMAGE,
    ], 60000);
    if (!run.ok) {
      log.error?.(`[Lightpanda] Could not create container: ${run.stderr || run.err?.message}. ` +
        `Pull it once with: docker pull ${IMAGE}`);
      return { ok: false, reason: "run-failed" };
    }
    log.log?.(`[Lightpanda] Browser container started on 127.0.0.1:${PORT} (restart=${RESTART_POLICY}).`);
    return { ok: true, created: true };
  }

  // Container exists — always (re)assert the restart policy, then start if down.
  await docker(["update", "--restart", RESTART_POLICY, CONTAINER], 8000);

  if (state === "running") {
    log.log?.(`[Lightpanda] Browser already running (restart=${RESTART_POLICY}).`);
    return { ok: true, alreadyRunning: true };
  }

  const start = await docker(["start", CONTAINER], 20000);
  if (!start.ok) {
    log.error?.(`[Lightpanda] Container exists but failed to start: ${start.stderr || start.err?.message}`);
    return { ok: false, reason: "start-failed" };
  }
  log.log?.(`[Lightpanda] Revived stopped browser container (was "${state}").`);
  return { ok: true, revived: true };
}

module.exports = { ensureLightpandaRunning, containerState, CONTAINER, IMAGE, PORT };
