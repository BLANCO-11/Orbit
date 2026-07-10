// agent-backend/config.js
// Load/save security-config.json

const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "security-config.json");

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

module.exports = { loadConfig, saveConfig, CONFIG_PATH };
