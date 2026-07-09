const { validatePath, validateCommand } = require("../agent-backend/security-guard");
const assert = require("assert");

const mockConfig = {
  fileSystem: {
    allowedReadPaths: ["/home/blanco/builds/LLM-OS-AGENT", "/tmp"],
    allowedWritePaths: ["/home/blanco/builds/LLM-OS-AGENT/workspace", "/tmp"],
    blockedPaths: ["/home/blanco/.ssh", "/etc"]
  },
  shellCommands: {
    autoApprove: ["git status", "git diff", "ls -la"],
    allowedPrefixes: ["git", "npm", "node", "python3", "docker"],
    blockedCommands: ["rm -rf /", "dd", "mkfs"],
    requireApproval: true
  }
};

function testFileSystem() {
  console.log("Running filesystem security tests...");
  
  // Test Read Allowed
  let res = validatePath("read", "/home/blanco/builds/LLM-OS-AGENT/package.json", mockConfig.fileSystem);
  assert.strictEqual(res.allowed, true, "Should allow read inside workspace");
  
  // Test Read Blocked (outer path)
  res = validatePath("read", "/home/blanco/documents", mockConfig.fileSystem);
  assert.strictEqual(res.allowed, false, "Should deny read outside allowed directories");
  
  // Test Read Explicitly Blocked
  res = validatePath("read", "/home/blanco/.ssh/id_rsa", mockConfig.fileSystem);
  assert.strictEqual(res.allowed, false, "Should deny read in blocked directory");

  // Test Write Allowed
  res = validatePath("write", "/home/blanco/builds/LLM-OS-AGENT/workspace/file.txt", mockConfig.fileSystem);
  assert.strictEqual(res.allowed, true, "Should allow write inside allowed workspace write directory");

  // Test Write Denied (Read-only workspace root)
  res = validatePath("write", "/home/blanco/builds/LLM-OS-AGENT/package.json", mockConfig.fileSystem);
  assert.strictEqual(res.allowed, false, "Should deny write outside allowed write directories");

  console.log("FileSystem security tests passed!");
}

function testCommands() {
  console.log("Running shell command security tests...");

  // Test Auto-Approve Command
  let res = validateCommand("git status", mockConfig.shellCommands);
  assert.strictEqual(res.allowed, true, "Should allow auto-approved command");
  assert.strictEqual(res.action, "allow", "Action should be 'allow'");

  // Test Auto-Approve prefix match
  res = validateCommand("git status --porcelain", mockConfig.shellCommands);
  assert.strictEqual(res.allowed, true);
  assert.strictEqual(res.action, "allow");

  // Test Allowed Prefix but Requires Approval
  res = validateCommand("npm install express", mockConfig.shellCommands);
  assert.strictEqual(res.allowed, true, "Should allow with approval");
  assert.strictEqual(res.action, "approve", "Action should be 'approve'");

  // Test Disallowed Prefix
  res = validateCommand("apt-get update", mockConfig.shellCommands);
  assert.strictEqual(res.allowed, false, "Should block disallowed command");
  assert.strictEqual(res.action, "block", "Action should be 'block'");

  // Test Dangerous Pattern
  res = validateCommand("rm -rf /", mockConfig.shellCommands);
  assert.strictEqual(res.allowed, false, "Should block dangerous patterns");
  assert.strictEqual(res.action, "block", "Action should be 'block'");

  console.log("Shell command security tests passed!");
}

try {
  testFileSystem();
  testCommands();
  console.log("\nAll security guard tests completed successfully!");
} catch (e) {
  console.error("Test failed:", e);
  process.exit(1);
}
