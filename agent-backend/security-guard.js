const path = require("path");

// ─────────────────────────────────────────────────────────────────────────────
// HARD blocklist guard — the non-overridable guardrail, and ONLY that.
//
// This module used to also gate by permission MODE (chat/plan/edit/yolo) with
// its own "switch to PLAN/EDIT/YOLO mode" copy. That was a second, drifting
// enforcement layer. The permission model is now owned entirely by
// policy-engine.js (the capability × mode matrix) evaluated at the
// `tool_call_start` gate in server.js — the single source of truth. To avoid a
// request being blocked by one layer with different wording than the other, the
// mode logic has been retired here (Workstream A4). What remains is the hard
// guardrail: protected secrets (no read/write) and protected source (no write),
// plus high-risk command patterns — guardrails that user consent cannot loosen.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Checks if a target path is under a parent directory.
 */
function isUnderDirectory(parent, target) {
  const relative = path.relative(parent, target);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/**
 * Hard-blocklist path guard. Not the permission layer — only answers whether a
 * path is a protected secret (blocked for read + write) or protected source
 * (blocked for write). Everything else is allowed here; mode/permission gating
 * happens in the policy engine.
 *
 * @param {string} action - 'read' or 'write'
 * @param {string} targetPath - The path being accessed
 * @param {object} config - fileSystem config: { blockedPaths, writeBlockedPaths }
 * @returns {{allowed: boolean, reason?: string, resolvedPath: string}}
 */
function validatePath(action, targetPath, config = {}) {
  const resolved = path.resolve(targetPath);

  // No-read + no-write: secrets (~/.ssh, ~/.aws, …).
  for (const blocked of config.blockedPaths || []) {
    const resolvedBlocked = path.resolve(blocked);
    if (resolved === resolvedBlocked || isUnderDirectory(resolvedBlocked, resolved)) {
      return {
        allowed: false,
        reason: `Access explicitly blocked to path: ${blocked}`,
        resolvedPath: resolved,
      };
    }
  }

  // No-write, read OK: Orbit's own source (the agent may read/explain it but
  // never modify it).
  if (action === "write") {
    for (const blocked of config.writeBlockedPaths || []) {
      const resolvedBlocked = path.resolve(blocked);
      if (resolved === resolvedBlocked || isUnderDirectory(resolvedBlocked, resolved)) {
        return {
          allowed: false,
          reason: `Write access explicitly blocked to path: ${blocked}`,
          resolvedPath: resolved,
        };
      }
    }
  }

  return { allowed: true, resolvedPath: resolved };
}

/**
 * High-risk command execution patterns that are always blocked, regardless of
 * mode or user consent.
 */
const DANGEROUS_PATTERNS = [
  /rm\s+-(rf|fr|r|f)\s+\//,
  /chmod\s+.*-R/,
  /chown\s+.*-R/,
  /mkfs/,
  /dd\s+if=/,
  />\s*\/dev\//,
  /:\(\)\{\s*:\s*\|\s*:\s*&\s*\};:/, // fork bomb
];

/**
 * Hard-blocklist command guard. Only blocks high-risk patterns and explicitly
 * blocked commands; it does NOT approve/gate by mode (the policy engine does).
 *
 * @param {string} commandString - The full command execution request
 * @param {object} config - shellCommands config: { blockedCommands }
 * @returns {{allowed: boolean, action: 'allow' | 'block', reason?: string}}
 */
function validateCommand(commandString, config = {}) {
  const cmd = commandString.trim();
  const primaryCommand = cmd.split(/\s+/)[0];

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(cmd)) {
      return {
        allowed: false,
        action: "block",
        reason: "Command matches a blocked high-risk execution pattern.",
      };
    }
  }

  for (const blocked of config.blockedCommands || []) {
    if (cmd.startsWith(blocked) || primaryCommand === blocked) {
      return {
        allowed: false,
        action: "block",
        reason: `Command matches explicitly blocked instruction: "${blocked}"`,
      };
    }
  }

  return { allowed: true, action: "allow" };
}

module.exports = {
  validatePath,
  validateCommand,
};
