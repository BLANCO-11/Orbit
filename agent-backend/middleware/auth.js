// agent-backend/middleware/auth.js
// API key authentication middleware

function createAuthMiddleware(getConfig) {
  return function authMiddleware(req, res, next) {
    const apiKey = req.headers["x-api-key"] || (req.headers["authorization"] || "").replace("Bearer ", "");
    const config = getConfig();
    
    // If no API key is configured, allow all (backward compat for local dev)
    if (!config.apiKey) {
      return next();
    }
    
    if (!apiKey || apiKey !== config.apiKey) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="AegisAgent"');
      return res.status(401).json({ success: false, message: "Unauthorized: invalid or missing API key." });
    }
    
    next();
  };
}

module.exports = createAuthMiddleware;
