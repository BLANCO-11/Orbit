// agent-backend/harnesses/index.js
// Harness loader — returns the appropriate harness for a given name

const PiCodeHarness = require("./picode");
const OpenCodeHarness = require("./opencode");

function loadHarness(name, options) {
  switch (name) {
    case "picode":
      return new PiCodeHarness(options);
    case "opencode":
      return new OpenCodeHarness(options);
    case "claude-code":
      console.warn(`[Harness] '${name}' harness not yet implemented.`);
      throw new Error(`Harness '${name}' is not yet supported.`);
    default:
      throw new Error(`Unknown harness: '${name}'. Supported: picode.`);
  }
}

module.exports = { loadHarness };
