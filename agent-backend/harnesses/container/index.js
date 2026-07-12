// agent-backend/harnesses/container/index.js
// ContainerHarness — runs pi inside an ephemeral Docker container for real
// filesystem isolation (stronger than the host security-guard's denylist).
// It reuses PiCodeHarness entirely and only wraps the spawn in `docker run`.
//
// Approach: rather than build/publish a pi image, we bind-mount the host's pi
// runtime and config into a stock node image at their same absolute paths, so
// the same node/pi binaries run inside the container. The workspace is mounted
// read-write; everything else on the host is invisible to the agent — file
// writes outside the mounted workspace stay in the throwaway container and
// vanish when it exits (--rm).
//
// Honest limitations (surfaced to the user): uses --network host so the agent
// can reach LiteLLM (so network isn't isolated yet); MCP servers with
// host-absolute paths may not resolve inside the container. Requires Docker.

const { execSync } = require("child_process");
const os = require("os");
const path = require("path");
const PiCodeHarness = require("../picode");

const IMAGE = process.env.ORBIT_SANDBOX_IMAGE || "node:22-slim";
const PI_RUNTIME_DIR = path.join(os.homedir(), ".local", "share", "pi-node");
const PI_CONFIG_DIR = path.join(os.homedir(), ".pi");

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
    const mounts = [
      "-v", `${PI_RUNTIME_DIR}:${PI_RUNTIME_DIR}:ro`,       // pi/node binaries (immutable)
      "-v", `${PI_CONFIG_DIR}:${home}/.pi:rw`,              // pi settings/auth + session/lock files (pi writes here)
      "-v", `${sessionRoot}:${sessionRoot}:rw`,             // this session's tree (workspace/artifacts/tmp)
    ];
    // Forward only the LLM creds + mode the agent needs.
    const envArgs = [];
    for (const k of ["LITELLM_KEY", "OPENAI_API_KEY", "ORBIT_MODE", "LITELLM_BASE_URL"]) {
      if (childEnv[k]) envArgs.push("-e", `${k}=${childEnv[k]}`);
    }
    const dockerArgs = [
      "run", "--rm", "-i",
      "--network", "host",              // reach the local LiteLLM endpoint
      "--pull", "never",
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
