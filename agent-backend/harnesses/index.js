// agent-backend/harnesses/index.js
// Harness loader — returns the appropriate harness for a given name

const PiCodeHarness = require("./picode");

function loadHarness(name, options) {
  switch (name) {
    case "picode":
      return new PiCodeHarness(options);
    case "opencode":
      // Stub — OpenCodeHarness not yet implemented
      console.warn(`[Harness] '${name}' harness not yet implemented. Try: npm install opencode`);
      throw new Error(`Harness '${name}' is not yet supported.`);
    case "claude-code":
      console.warn(`[Harness] '${name}' harness not yet implemented.`);
      throw new Error(`Harness '${name}' is not yet supported.`);
    default:
      throw new Error(`Unknown harness: '${name}'. Supported: picode.`);
  }
}

module.exports = { loadHarness };
