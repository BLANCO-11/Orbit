// agent-backend/middleware/auth.js
// Authentication middleware — accepts either a per-device token (issued via
// the URL/OTP pairing flow, see routes/devices.js) or a shared-secret
// stopgap for simple single-device local setups that haven't paired
// anything. The key/token never comes from security-config.json, since
// that file is writable via an API route and must not be able to reset
// its own guard.

function getSharedApiKey() {
  // ORBIT_API_KEY is the current name; AEGIS_API_KEY kept as a fallback so
  // pre-rebrand .env files keep working.
  return process.env.ORBIT_API_KEY || process.env.AEGIS_API_KEY || null;
}

function checkApiKey(req, db) {
  const provided = req.headers["x-api-key"] || (req.headers["authorization"] || "").replace("Bearer ", "");

  if (db && provided) {
    const device = db.getDeviceByToken(provided);
    if (device) {
      req.device = device;
      db.touchDeviceLastSeen(device.id);
      return true;
    }
  }

  const required = getSharedApiKey();
  // No shared key configured and no matching device token: dev-mode, allow through.
  if (!required) return true;

  return Boolean(provided) && provided === required;
}

function createAuthMiddleware(db) {
  return function authMiddleware(req, res, next) {
    if (!checkApiKey(req, db)) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="Orbit"');
      return res.status(401).json({ success: false, message: "Unauthorized: invalid or missing API key." });
    }
    next();
  };
}

module.exports = createAuthMiddleware;
module.exports.getSharedApiKey = getSharedApiKey;
module.exports.checkApiKey = checkApiKey;
