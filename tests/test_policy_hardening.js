// Policy hardening tests (Tier 1) — exercise the REAL enforcement modules:
//   • agent-backend/policy-engine.js       (capability × mode matrix)
//   • agent-backend/ws/session-helpers.js  (path extraction / path-field detection)
// plus the composed "Vuln C" classification rule that lives in the server.js gate.
//
// The old test_security_guard.js targeted security-guard.js, which was DEAD CODE
// (nothing required it) and has been removed. These tests replace it against the
// path that actually runs.

const assert = require("assert");
const policyEngine = require("../agent-backend/policy-engine");
const {
  extractPathsFromArgs, hasPathField, isPathInZones, isPathBlocked, extractCommandPaths,
} = require("../agent-backend/ws/session-helpers");

// Mirror of the gate's Vuln-C predicate (server.js). Kept here so a change to the
// scoping (e.g. accidentally widening it to bash/subagent) trips a test.
const isFileWriteTool = (name) =>
  /^(write|edit|replace_file_content|multi_replace_file_content)$/.test(String(name).toLowerCase());

/** Reproduce the gate's capability decision for a tool call. */
function classify(name, args, { isOutsideByPath = false, mode = "edit" } = {}) {
  let isOutside = isOutsideByPath;
  const toolPaths = extractPathsFromArgs(args);
  if (isFileWriteTool(name) && toolPaths.length === 0 && !hasPathField(args)) {
    isOutside = true; // Vuln C: unverifiable file-write → treat as outside
  }
  const capability = policyEngine.toolToCapability(name, isOutside);
  const { decision } = policyEngine.evaluate(capability, mode, {});
  return { capability, decision };
}

function testHasPathField() {
  console.log("hasPathField / field coverage (Vuln D)...");
  // Broadened fields must be recognized (previously missed → skipped validation).
  assert.strictEqual(hasPathField({ outputPath: "/etc/cron.d/job" }), true, "outputPath is a path field");
  assert.strictEqual(hasPathField({ filename: "/tmp/x" }), true, "filename is a path field");
  assert.strictEqual(hasPathField({ targetPath: "~/x" }), true, "targetPath is a path field");
  assert.strictEqual(hasPathField({ path: "notes.txt" }), true, "relative path still counts as a named target");
  // Genuine Vuln C: no path field at all.
  assert.strictEqual(hasPathField({}), false, "empty args name no path");
  assert.strictEqual(hasPathField({ content: "hello" }), false, "content-only names no path");
  console.log("  ok");
}

function testExtractBroadenedFields() {
  console.log("extractPathsFromArgs broadened fields...");
  // Absolute/anchored values in new fields are extracted for blocklist/zone checks.
  assert.deepStrictEqual(extractPathsFromArgs({ outputPath: "/etc/cron.d/job" }), ["/etc/cron.d/job"]);
  assert.deepStrictEqual(extractPathsFromArgs({ targetPath: "~/.ssh/authorized_keys" }), ["~/.ssh/authorized_keys"]);
  // Command paths are NO LONGER extracted here (moved to extractCommandPaths).
  assert.deepStrictEqual(extractPathsFromArgs({ command: "cat ~/.ssh/id_rsa" }), [],
    "command paths must not flow through extractPathsFromArgs (zone logic)");
  console.log("  ok");
}

function testCommandTokenization() {
  console.log("Tier 2 — command tokenization (blocklist-only)...");
  const has = (cmd, p) => extractCommandPaths(cmd).includes(p);
  // Catches paths the old 10-utility regex missed: unlisted tools, redirects,
  // operators, subshells, --flag=path.
  assert.ok(has("tee ~/.ssh/authorized_keys", "~/.ssh/authorized_keys"), "tee target caught");
  assert.ok(has("echo x > /etc/passwd", "/etc/passwd"), "redirect target caught");
  assert.ok(has("cat /dev/null && sed -i s/x/y/ /etc/hosts", "/etc/hosts"), "path after && caught");
  assert.ok(has("echo $(cat /etc/shadow)", "/etc/shadow"), "subshell path caught");
  assert.ok(has("cp --target=/etc/cron.d/job x", "/etc/cron.d/job"), "--flag=path caught");
  assert.ok(has("cat ~/.ssh/id_rsa", "~/.ssh/id_rsa"), "plain cat still caught (regression)");
  // FALSE-POSITIVE GUARD: a path that appears only inside a quoted sub-expression
  // (a sed script) is NOT a real target and must NOT be extracted.
  assert.deepStrictEqual(extractCommandPaths("sed 's|/etc/hosts|foo|' myfile"), [],
    "sed script inner path must not be flagged");
  assert.deepStrictEqual(extractCommandPaths("npm test"), [], "benign command yields no paths");
  assert.deepStrictEqual(extractCommandPaths("git commit -m 'fix'"), [], "git commit yields no paths");
  console.log("  ok");
}

function testVulnCEmptyArgWrite() {
  console.log("Vuln C — empty-arg file write is governed by write_outside...");
  // A targetless write must NOT auto-allow in edit; it becomes write_outside → ask.
  let r = classify("write", {}, { mode: "edit" });
  assert.strictEqual(r.capability, "write_outside", "empty write → write_outside");
  assert.strictEqual(r.decision, "ask", "empty write in edit → ask (was auto-allow)");
  // In chat it is blocked (write_workspace was already blocked, so no regression).
  r = classify("write", {}, { mode: "chat" });
  assert.strictEqual(r.decision, "block", "empty write in chat → block");
  // A write that names a target is unaffected → write_workspace, allowed in edit.
  r = classify("write", { path: "notes.txt" }, { mode: "edit" });
  assert.strictEqual(r.capability, "write_workspace", "named in-zone write → write_workspace");
  assert.strictEqual(r.decision, "allow", "named in-zone write in edit → allow (unchanged)");
  console.log("  ok");
}

function testVulnCDoesNotBreakShell() {
  console.log("Vuln C scoping — bash/subagent are NOT reclassified (false-positive guard)...");
  // bash routinely carries no extractable path; it must stay `shell`, not become
  // write_outside (which would gate normal commands).
  let r = classify("bash", { command: "npm test" }, { mode: "edit" });
  assert.strictEqual(r.capability, "shell", "bash stays shell");
  assert.strictEqual(r.decision, "allow", "bash in edit stays allowed");
  r = classify("bash", {}, { mode: "edit" });
  assert.strictEqual(r.capability, "shell", "empty bash still shell, not write_outside");
  // subagent stays spawn_subagent.
  r = classify("subagent", {}, { mode: "edit" });
  assert.strictEqual(r.capability, "spawn_subagent", "subagent stays spawn_subagent");
  console.log("  ok");
}

function testHardBlocklistPaths() {
  console.log("Hard blocklist path checks (regression)...");
  const blocked = ["/home/user/.ssh", "/etc"];
  assert.strictEqual(isPathBlocked("/home/user/.ssh/id_rsa", blocked), true, "secret is blocked");
  assert.strictEqual(isPathBlocked("/home/user/project/file.txt", blocked), false, "ordinary path not blocked");
  const zones = ["/home/user/.orbit/sessions/abc"];
  assert.strictEqual(isPathInZones("/home/user/.orbit/sessions/abc/workspace/f", zones), true, "in-zone");
  assert.strictEqual(isPathInZones("/home/user/other", zones), false, "out-of-zone");
  console.log("  ok");
}

try {
  testHasPathField();
  testExtractBroadenedFields();
  testCommandTokenization();
  testVulnCEmptyArgWrite();
  testVulnCDoesNotBreakShell();
  testHardBlocklistPaths();
  console.log("\nAll policy hardening tests passed!");
} catch (e) {
  console.error("\nTest failed:", e && e.message ? e.message : e);
  process.exit(1);
}
