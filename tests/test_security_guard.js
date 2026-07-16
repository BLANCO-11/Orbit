// security-guard is now the HARD blocklist only — no mode/permission gating
// (that lives in policy-engine.js + the tool_call gate; see policy-engine tests).
// These tests exercise the non-overridable guardrail: protected secrets, write-
// protected source, and high-risk command patterns.

const { validatePath, validateCommand } = require("../agent-backend/security-guard");
const assert = require("assert");

const REPO = "/home/user/builds/Orbit";

const mockConfig = {
  fileSystem: {
    // Secrets: no read, no write.
    blockedPaths: ["/home/user/.ssh", "/etc"],
    // Orbit source: read OK, no write.
    writeBlockedPaths: [REPO + "/agent-backend"],
  },
  shellCommands: {
    blockedCommands: ["dd", "mkfs", "shutdown"],
  },
};

function testFileSystem() {
  console.log("Running filesystem hard-blocklist tests...");

  // Ordinary paths are allowed (permission gating happens elsewhere now).
  let res = validatePath("read", REPO + "/package.json", mockConfig.fileSystem);
  assert.strictEqual(res.allowed, true, "Non-protected read should be allowed by the hard guard");

  res = validatePath("write", REPO + "/workspace/file.txt", mockConfig.fileSystem);
  assert.strictEqual(res.allowed, true, "Non-protected write should be allowed by the hard guard");

  // Secrets: blocked for both read and write.
  res = validatePath("read", "/home/user/.ssh/id_rsa", mockConfig.fileSystem);
  assert.strictEqual(res.allowed, false, "Reading a secret path must be hard-blocked");
  res = validatePath("write", "/etc/hosts", mockConfig.fileSystem);
  assert.strictEqual(res.allowed, false, "Writing a secret path must be hard-blocked");

  // Write-protected source: read OK, write blocked.
  res = validatePath("read", REPO + "/agent-backend/server.js", mockConfig.fileSystem);
  assert.strictEqual(res.allowed, true, "Reading write-protected source should be allowed");
  res = validatePath("write", REPO + "/agent-backend/server.js", mockConfig.fileSystem);
  assert.strictEqual(res.allowed, false, "Writing write-protected source must be hard-blocked");

  console.log("FileSystem hard-blocklist tests passed!");
}

function testCommands() {
  console.log("Running shell command hard-blocklist tests...");

  // Ordinary commands pass the hard guard (mode gating happens elsewhere).
  let res = validateCommand("git status", mockConfig.shellCommands);
  assert.strictEqual(res.allowed, true, "Ordinary command should pass the hard guard");
  assert.strictEqual(res.action, "allow");

  // High-risk pattern is always blocked.
  res = validateCommand("rm -rf /", mockConfig.shellCommands);
  assert.strictEqual(res.allowed, false, "rm -rf / must be hard-blocked");
  assert.strictEqual(res.action, "block");

  res = validateCommand("dd if=/dev/zero of=/dev/sda", mockConfig.shellCommands);
  assert.strictEqual(res.allowed, false, "dd if= must be hard-blocked");
  assert.strictEqual(res.action, "block");

  // Explicitly blocked command.
  res = validateCommand("shutdown -h now", mockConfig.shellCommands);
  assert.strictEqual(res.allowed, false, "Explicitly blocked command must be blocked");
  assert.strictEqual(res.action, "block");

  console.log("Shell command hard-blocklist tests passed!");
}

try {
  testFileSystem();
  testCommands();
  console.log("\nAll security guard tests completed successfully!");
} catch (e) {
  console.error("Test failed:", e);
  process.exit(1);
}
