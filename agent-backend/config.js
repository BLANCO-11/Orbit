// agent-backend/config.js
// Load/save security-config.json

const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "security-config.json");
const EXAMPLE_PATH = path.join(__dirname, "security-config.example.json");

// security-config.json is gitignored (it holds the user's API key). On a fresh
// clone it won't exist — seed it from the committed example so `git clone && run`
// works instead of crashing. LLM creds can also come from env (.env), which
// override the file at spawn time.
function ensureConfig() {
  if (!fs.existsSync(CONFIG_PATH) && fs.existsSync(EXAMPLE_PATH)) {
    fs.copyFileSync(EXAMPLE_PATH, CONFIG_PATH);
    console.log("[Config] Seeded security-config.json from security-config.example.json — edit it or set LLM creds in .env.");
  }
}

function loadConfig() {
  ensureConfig();
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

module.exports = { loadConfig, saveConfig, CONFIG_PATH };
