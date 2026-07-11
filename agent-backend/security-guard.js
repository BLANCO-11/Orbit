const path = require("path");

/**
 * Checks if a target path is under a parent directory.
 */
function isUnderDirectory(parent, target) {
  const relative = path.relative(parent, target);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/**
 * Validates a filesystem path against read/write configs.
 * @param {string} action - 'read' or 'write'
 * @param {string} targetPath - The path being accessed
 * @param {object} config - The security configuration
 * @returns {object} { allowed: boolean, reason?: string, resolvedPath: string }
 */
function validatePath(action, targetPath, config, mode) {
  const resolved = path.resolve(targetPath);
  const activeMode = mode || process.env.ORBIT_MODE || (config && config.defaultMode) || "chat";

  // YOLO mode: full access (bypasses all allowed/blocked restrictions)
  if (activeMode === "yolo") {
    return { allowed: true, resolvedPath: resolved };
  }

  // Check explicit blocklist first
  if (config.blockedPaths) {
    for (const blocked of config.blockedPaths) {
      const resolvedBlocked = path.resolve(blocked);
      if (resolved === resolvedBlocked || isUnderDirectory(resolvedBlocked, resolved)) {
        return {
          allowed: false,
          reason: `Access explicitly blocked to path: ${blocked}`,
          resolvedPath: resolved
        };
      }
    }
  }

  // Plan mode: only reading and writing plans (under plan/ directory)
  if (activeMode === "plan") {
    const planDir = path.resolve(path.join(__dirname, "../plan"));
    const isPlanPath = resolved === planDir || isUnderDirectory(planDir, resolved);
    if (!isPlanPath) {
      return {
        allowed: false,
        reason: `Plan mode restriction: reading and writing is restricted to the plans directory only (${planDir}). Path: ${targetPath}`,
        resolvedPath: resolved
      };
    }
    return { allowed: true, resolvedPath: resolved };
  }

  // Chat mode: no OS filesystem access
  if (activeMode === "chat") {
    return {
      allowed: false,
      reason: `Access denied: Chat mode does not allow filesystem access. Please switch to PLAN, EDIT, or YOLO mode.`,
      resolvedPath: resolved
    };
  }

  // Check read permissions
  if (action === "read") {
    if (!config.allowedReadPaths || config.allowedReadPaths.length === 0) {
      return { allowed: false, reason: "No read paths are allowed in security config", resolvedPath: resolved };
    }
    
    let isAllowed = false;
    for (const allowed of config.allowedReadPaths) {
      const resolvedAllowed = path.resolve(allowed);
      if (resolved === resolvedAllowed || isUnderDirectory(resolvedAllowed, resolved)) {
        isAllowed = true;
        break;
      }
    }
    
    if (!isAllowed) {
      return {
        allowed: false,
        reason: `Read access denied for path outside of allowed directories. Path: ${targetPath}`,
        resolvedPath: resolved
      };
    }
  }

  // Check write permissions
  if (action === "write") {
    if (!config.allowedWritePaths || config.allowedWritePaths.length === 0) {
      return { allowed: false, reason: "No write paths are allowed in security config", resolvedPath: resolved };
    }
    
    let isAllowed = false;
    for (const allowed of config.allowedWritePaths) {
      const resolvedAllowed = path.resolve(allowed);
      if (resolved === resolvedAllowed || isUnderDirectory(resolvedAllowed, resolved)) {
        isAllowed = true;
        break;
      }
    }
    
    if (!isAllowed) {
      return {
        allowed: false,
        reason: `Write access denied for path outside of allowed write directories. Path: ${targetPath}`,
        resolvedPath: resolved
      };
    }
  }

  return { allowed: true, resolvedPath: resolved };
}

/**
 * Read-only command patterns used in Edit mode to auto-approve reads.
 */
const READ_ONLY_COMMANDS = [
  /^\s*(ls|pwd|echo|cat|head|tail|less|more|wc|sort|uniq|grep|find|which|stat|du|df|file|type|whereis|locate|strings|diff|cmp)\b/,
  /^\s*git\s+(status|diff|log|show|branch|remote|ls-files|ls-tree|describe|rev-parse|config|help|version)/,
  /^\s*npm\s+(list|view|search|pack|help|version)/,
  /^\s*docker\s+(ps|images|logs|inspect|stats|info|version)/,
  /^\s*node\s+(-[evp]|--version|--help)/
];

/**
 * Check if a command is read-only (safe for auto-approval in Edit mode).
 */
function isReadOnlyCommand(commandString) {
  const cmd = commandString.trim();
  for (const pattern of READ_ONLY_COMMANDS) {
    if (pattern.test(cmd)) {
      return true;
    }
  }
  return false;
}

/**
 * Validates a shell command string against security rules.
 * @param {string} commandString - The full command execution request
 * @param {object} config - The security configuration
 * @param {string} [mode] - The session mode: 'plan', 'edit', 'yolo', or undefined
 * @returns {object} { allowed: boolean, action: 'allow' | 'approve' | 'block', reason?: string }
 */
function validateCommand(commandString, config, mode) {
  const activeMode = mode || process.env.ORBIT_MODE || (config && config.defaultMode) || "chat";
  const cmd = commandString.trim();
  const tokens = cmd.split(/\s+/);
  const primaryCommand = tokens[0];

  // 1. Strict pattern blocklist (e.g. rm -rf, dd, etc.)
  const dangerousPatterns = [
    /rm\s+-(rf|fr|r|f)\s+\//,
    /chmod\s+.*-R/,
    /chown\s+.*-R/,
    /mkfs/,
    /dd\s+if=/,
    />\s*\/dev\//,
    /:\(\)\{\s*:\s*\|\s*:\s*&\s*\};:/ // fork bomb
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(cmd)) {
      return {
        allowed: false,
        action: "block",
        reason: "Command matches a blocked high-risk execution pattern."
      };
    }
  }

  // Check against config blockedCommands
  if (config.blockedCommands) {
    for (const blocked of config.blockedCommands) {
      if (cmd.startsWith(blocked) || primaryCommand === blocked) {
        return {
          allowed: false,
          action: "block",
          reason: `Command matches explicitly blocked instruction: "${blocked}"`
        };
      }
    }
  }

  // YOLO mode check: bypass remaining whitelists/blocklists
  if (activeMode === "yolo") {
    return {
      allowed: true,
      action: "allow"
    };
  }

  // Chat mode check: block all command execution
  if (activeMode === "chat") {
    return {
      allowed: false,
      action: "block",
      reason: "Command execution blocked: Chat mode does not allow executing commands. Please switch to PLAN, EDIT, or YOLO mode."
    };
  }

  // Plan mode check: require approval for all command execution
  if (activeMode === "plan") {
    return {
      allowed: true,
      action: "approve",
      reason: "Command requires human approval (Plan mode)."
    };
  }

  // 2. Check for auto-approve whitelist
  if (config.autoApprove) {
    for (const approved of config.autoApprove) {
      if (cmd === approved || cmd.startsWith(approved + " ")) {
        return {
          allowed: true,
          action: "allow"
        };
      }
    }
  }

  // 3. Check for allowed prefixes / commands
  if (config.allowedPrefixes) {
    let isAllowedPrefix = false;
    for (const prefix of config.allowedPrefixes) {
      if (cmd.startsWith(prefix) || primaryCommand === prefix) {
        isAllowedPrefix = true;
        break;
      }
    }

    if (!isAllowedPrefix) {
      return {
        allowed: false,
        action: "block",
        reason: `Command execution forbidden: primary utility "${primaryCommand}" is not in the allowed prefixes list.`
      };
    }
  }

  // 4. Edit mode check
  if (activeMode === "edit") {
    // Edit mode: read-only commands auto-approved, writes need approval
    if (isReadOnlyCommand(cmd)) {
      return {
        allowed: true,
        action: "allow"
      };
    }
    // Everything else needs approval
    return {
      allowed: true,
      action: "approve",
      reason: "Write command requires human approval (Edit mode)."
    };
  }

  // 5. Fallback: use config-level requireApproval
  if (config.requireApproval) {
    return {
      allowed: true,
      action: "approve",
      reason: "Command is valid but requires human approval."
    };
  }

  return {
    allowed: true,
    action: "allow"
  };
}

module.exports = {
  validatePath,
  validateCommand
};
