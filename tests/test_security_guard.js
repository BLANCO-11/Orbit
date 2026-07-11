process.env.ORBIT_MODE = "edit"; // default for legacy tests

const { validatePath, validateCommand } = require("../agent-backend/security-guard");
const assert = require("assert");
const path = require("path");

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
  
  // Test Read Allowed (Edit mode)
  let res = validatePath("read", "/home/blanco/builds/LLM-OS-AGENT/package.json", mockConfig.fileSystem);
  assert.strictEqual(res.allowed, true, "Should allow read inside workspace in edit mode");
  
  // Test Read Blocked (outer path)
  res = validatePath("read", "/home/blanco/documents", mockConfig.fileSystem);
  assert.strictEqual(res.allowed, false, "Should deny read outside allowed directories in edit mode");
  
  // Test Read Explicitly Blocked
  res = validatePath("read", "/home/blanco/.ssh/id_rsa", mockConfig.fileSystem);
  assert.strictEqual(res.allowed, false, "Should deny read in blocked directory in edit mode");

  // Test Write Allowed
  res = validatePath("write", "/home/blanco/builds/LLM-OS-AGENT/workspace/file.txt", mockConfig.fileSystem);
  assert.strictEqual(res.allowed, true, "Should allow write inside allowed workspace write directory in edit mode");

  // Test Write Denied (Read-only workspace root)
  res = validatePath("write", "/home/blanco/builds/LLM-OS-AGENT/package.json", mockConfig.fileSystem);
  assert.strictEqual(res.allowed, false, "Should deny write outside allowed write directories in edit mode");

  // Test YOLO mode path validation
  res = validatePath("read", "/home/blanco/documents", mockConfig.fileSystem, "yolo");
  assert.strictEqual(res.allowed, true, "YOLO mode should bypass read path restrictions");
  res = validatePath("write", "/etc/hosts", mockConfig.fileSystem, "yolo");
  assert.strictEqual(res.allowed, true, "YOLO mode should bypass write path restrictions");

  // Test Plan mode path validation
  const planDir = path.resolve(path.join(__dirname, "../plan"));
  res = validatePath("write", path.join(planDir, "test.md"), mockConfig.fileSystem, "plan");
  assert.strictEqual(res.allowed, true, "Plan mode should allow access under plan directory");
  res = validatePath("read", "/home/blanco/builds/LLM-OS-AGENT/package.json", mockConfig.fileSystem, "plan");
  assert.strictEqual(res.allowed, false, "Plan mode should block access outside plan directory");

  // Test Chat mode path validation
  res = validatePath("read", "/home/blanco/builds/LLM-OS-AGENT/package.json", mockConfig.fileSystem, "chat");
  assert.strictEqual(res.allowed, false, "Chat mode should block all read access");
  res = validatePath("write", "/home/blanco/builds/LLM-OS-AGENT/workspace/test.txt", mockConfig.fileSystem, "chat");
  assert.strictEqual(res.allowed, false, "Chat mode should block all write access");

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

  // Test Allowed Prefix but Requires Approval (Edit mode)
  res = validateCommand("npm install express", mockConfig.shellCommands, "edit");
  assert.strictEqual(res.allowed, true, "Should allow with approval");
  assert.strictEqual(res.action, "approve", "Action should be 'approve' in edit mode");

  // Test Disallowed Prefix (Edit mode)
  res = validateCommand("apt-get update", mockConfig.shellCommands, "edit");
  assert.strictEqual(res.allowed, false, "Should block disallowed command");
  assert.strictEqual(res.action, "block", "Action should be 'block' in edit mode");

  // Test YOLO mode command execution
  res = validateCommand("apt-get update", mockConfig.shellCommands, "yolo");
  assert.strictEqual(res.allowed, true, "YOLO mode should allow any command utility");
  assert.strictEqual(res.action, "allow", "Action should be 'allow' in YOLO mode");

  // Test Plan mode command execution
  res = validateCommand("git status", mockConfig.shellCommands, "plan");
  assert.strictEqual(res.allowed, true, "Plan mode should allow commands with approval");
  assert.strictEqual(res.action, "approve", "Action should be 'approve' in Plan mode");

  // Test Chat mode command execution
  res = validateCommand("git status", mockConfig.shellCommands, "chat");
  assert.strictEqual(res.allowed, false, "Chat mode should block all commands");
  assert.strictEqual(res.action, "block", "Action should be 'block' in Chat mode");

  // Test Dangerous Pattern
  res = validateCommand("rm -rf /", mockConfig.shellCommands, "edit");
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
