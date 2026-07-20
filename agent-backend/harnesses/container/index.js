// agent-backend/harnesses/container/index.js
// ContainerHarness — runs pi inside an ephemeral Docker container for real
// filesystem isolation (stronger than the host policy gate's path denylist).
// It reuses PiCodeHarness entirely and only wraps the spawn in `docker run`.
//
// Approach: rather than build/publish a pi image, we bind-mount the host's pi
// runtime and config into a stock python+node image at their same absolute
// paths, so the same node/pi binaries run inside the container (and generated
// python/node scripts run without an install step). The workspace is mounted
// read-write; everything else on the host is invisible to the agent — file
// writes outside the mounted workspace stay in the throwaway container and
// vanish when it exits (--rm).
//
// Isolation levers (env-gated; DEFAULTS preserve the original behavior exactly,
// so an existing container run is byte-identical unless an operator opts in):
//   • ORBIT_SANDBOX_PI_CONFIG_RO=1  — mount the host ~/.pi READ-ONLY instead of
//     rw. Tightens the review-flagged hole (a container agent could otherwise
//     write/tamper with the host's pi auth/config). Leave OFF if your pi build
//     writes lock/session files under ~/.pi and errors on a read-only mount.
//   • ORBIT_SANDBOX_NETWORK=<mode>  — docker --network mode (default "host").
//     Set to e.g. "bridge" to stop re-exposing the host network; when non-host,
//     we add --add-host=host.docker.internal:host-gateway and rewrite a loopback
//     ORBIT_LLM_BASE_URL to host.docker.internal so the child still reaches the
//     app's LLM gateway. NOTE: the non-host path needs a Docker-equipped test on
//     your platform before relying on it.
// Honest limitation that remains: MCP servers with host-absolute paths may not
// resolve inside the container. Requires Docker.

const { execSync } = require("child_process");
const os = require("os");
const path = require("path");
const PiCodeHarness = require("../picode");

// Default sandbox image ships BOTH python + node so generated scripts (the run
// API's smoke tests) execute without an install step. Override with
// ORBIT_SANDBOX_IMAGE. `docker run` below uses `--pull missing`, so an image
// that isn't local yet is fetched once on first use (then cached); no manual
// pre-pull is required. Air-gapped hosts can set ORBIT_SANDBOX_PULL=never and
// pre-load the image themselves.
const IMAGE = process.env.ORBIT_SANDBOX_IMAGE || "nikolaik/python-nodejs:python3.12-nodejs22-slim";
const PI_RUNTIME_DIR = path.join(os.homedir(), ".local", "share", "pi-node");
const PI_CONFIG_DIR = path.join(os.homedir(), ".pi");

const truthy = (v) => ["1", "true", "yes", "on"].includes(String(v || "").toLowerCase());

class ContainerHarness extends PiCodeHarness {
  getMetadata() {
    return { name: "PiCode (container)", version: "1.0.0", transport: "container", sandbox: "container" };
  }

  /** True if Docker is usable. Cheap preflight so we fail with a clear message. */
  static dockerAvailable() {
    try { execSync("docker info", { stdio: "ignore", timeout: 5000 }); return true; }
    catch { return false; }
  }

  _buildSpawnCommand({ nodePath, piPath, piArgs, childEnv }) {
    const home = "/root";
    // Mount ONLY this session's dir (set by the inherited connect()), so the
    // container is filesystem-isolated from the host and from other sessions.
    const sessionRoot = require("../../workspace-paths").sessionRoot(this.sessionId);
    const workspace = this._workspaceDir || sessionRoot;
    const piConfigMode = truthy(process.env.ORBIT_SANDBOX_PI_CONFIG_RO) ? "ro" : "rw";
    const mounts = [
      "-v", `${PI_RUNTIME_DIR}:${PI_RUNTIME_DIR}:ro`,        // pi/node binaries (immutable)
      "-v", `${PI_CONFIG_DIR}:${home}/.pi:${piConfigMode}`,  // pi settings/auth (rw by default; ro via ORBIT_SANDBOX_PI_CONFIG_RO)
      "-v", `${sessionRoot}:${sessionRoot}:rw`,              // this session's tree (workspace/artifacts/tmp)
    ];
    // The `orbit` provider extension (`-e <path>`) lives in the backend source,
    // outside every other mount — bind-mount its dir read-only at the same
    // absolute path so pi resolves it inside the container.
    if (this._providerExtPath) {
      const extDir = path.dirname(this._providerExtPath);
      mounts.push("-v", `${extDir}:${extDir}:ro`);
    }
    // Network mode: "host" (default) lets the child reach the app's LLM gateway
    // on loopback. A non-host mode isolates the network; we then publish the host
    // gateway as host.docker.internal and rewrite a loopback base URL to match.
    const network = process.env.ORBIT_SANDBOX_NETWORK || "host";
    const useHostNet = network === "host";
    // Forward only the gateway-provider env + mode the agent needs. The real
    // upstream key stays in the app (never entering this container).
    const envArgs = [];
    // Provider/gateway env the agent needs, plus this session's injected tenant
    // secrets (names set by the inherited connect() in `_secretNames`). Only the
    // secret NAMES are enumerated here; values ride in `childEnv`, never logged.
    const forward = ["ORBIT_MODE", "ORBIT_LLM_BASE_URL", "ORBIT_LLM_KEY", "ORBIT_LLM_MODEL", ...(this._secretNames || [])];
    for (const k of forward) {
      if (!childEnv[k]) continue;
      let v = childEnv[k];
      if (!useHostNet && k === "ORBIT_LLM_BASE_URL") {
        v = v.replace(/\/\/(127\.0\.0\.1|localhost)(?=[:\/]|$)/, "//host.docker.internal");
      }
      envArgs.push("-e", `${k}=${v}`);
    }
    const netArgs = useHostNet
      ? ["--network", "host"]                                              // reach the gateway on loopback
      : ["--network", network, "--add-host", "host.docker.internal:host-gateway"];
    const dockerArgs = [
      "run", "--rm", "-i",
      ...netArgs,
      // "missing": pull ONLY when the image isn't already local (one-time, e.g.
      // the first run after changing ORBIT_SANDBOX_IMAGE), then cache it. Keeps
      // the security intent of "never silently re-pull a tag you already have"
      // while removing the first-run failure that "never" caused. Override with
      // ORBIT_SANDBOX_PULL (e.g. "never" for fully air-gapped hosts).
      "--pull", (process.env.ORBIT_SANDBOX_PULL || "missing"),
      ...mounts,
      "-w", workspace,
      "-e", `HOME=${home}`,
      ...envArgs,
      IMAGE,
      nodePath, piPath, ...piArgs,      // same absolute paths, now mounted
    ];
    return { command: "docker", args: dockerArgs, spawnEnv: process.env, cwd: workspace };
  }
}

module.exports = ContainerHarness;
