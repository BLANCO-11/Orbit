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
function validatePath(action, targetPath, config) {
  const resolved = path.resolve(targetPath);
  
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
 * Validates a shell command string against security rules.
 * @param {string} commandString - The full command execution request
 * @param {object} config - The security configuration
 * @returns {object} { allowed: boolean, action: 'allow' | 'approve' | 'block', reason?: string }
 */
function validateCommand(commandString, config) {
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

  // 4. Default approval level
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
