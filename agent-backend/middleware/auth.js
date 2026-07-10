// agent-backend/middleware/auth.js
// Shared-secret authentication middleware.
//
// The key comes from the AEGIS_API_KEY env var — never from security-config.json,
// since that file is writable via an (until now, unauthenticated) API route and
// must not be able to reset its own guard. This is a stopgap shared-secret check
// ahead of the full per-device token/OTP pairing model (see plan/IMPLEMENTATION-PLAN.md
// Phase 3); it protects a single deployment, not multiple distinct devices/users.

function getSharedApiKey() {
  return process.env.AEGIS_API_KEY || null;
}

function checkApiKey(req) {
  const provided = req.headers["x-api-key"] || (req.headers["authorization"] || "").replace("Bearer ", "");
  const required = getSharedApiKey();

  // No key configured: dev-mode, allow through (already logged loudly at startup).
  if (!required) return true;

  return Boolean(provided) && provided === required;
}

function createAuthMiddleware() {
  return function authMiddleware(req, res, next) {
    if (!checkApiKey(req)) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="AegisAgent"');
      return res.status(401).json({ success: false, message: "Unauthorized: invalid or missing API key." });
    }
    next();
  };
}

module.exports = createAuthMiddleware;
module.exports.getSharedApiKey = getSharedApiKey;
module.exports.checkApiKey = checkApiKey;
