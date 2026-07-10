// agent-backend/env.js
// Startup environment validation + Pi binary path discovery

const fs = require("fs");
const os = require("os");

const REQUIRED_VARS = ["LITELLM_KEY"];
const RECOMMENDED_VARS = ["LOCAL_TTS_KEY", "LIGHTPANDA_WS"];

function discoverPiBinaries() {
  const nodePath = process.env.PI_NODE_PATH || process.env.NODE_PATH;
  const piPath = process.env.PI_CLI_PATH;
  
  if (!nodePath || !piPath) {
    const homeDir = os.homedir();
    const candidates = [
      `${homeDir}/.local/share/pi-node/node-v22.22.3-linux-x64/bin/node`,
      `${homeDir}/.local/share/pi-node/node-v22.22.3-linux-x64/bin/pi`,
    ];
    return {
      nodePath: nodePath || (fs.existsSync(candidates[0]) ? candidates[0] : "node"),
      piPath: piPath || (fs.existsSync(candidates[1]) ? candidates[1] : "pi"),
    };
  }
  
  return { nodePath, piPath };
}

function validateEnv() {
  const missing = REQUIRED_VARS.filter(v => !process.env[v]);
  if (missing.length > 0) {
    console.error(`[FATAL] Missing required environment variables: ${missing.join(", ")}`);
    console.error("Set them in .env or your shell environment.");
    process.exit(1);
  }
  
  const missingRecommended = RECOMMENDED_VARS.filter(v => !process.env[v]);
  if (missingRecommended.length > 0) {
    console.warn(`[WARN] Recommended environment variables not set: ${missingRecommended.join(", ")}`);
    console.warn("Some features may be unavailable.");
  }
  
  console.log("[Env] Validation passed. Required vars are set.");
}

module.exports = { validateEnv, discoverPiBinaries };
