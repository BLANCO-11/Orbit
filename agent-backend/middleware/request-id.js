// agent-backend/middleware/request-id.js
// X-Request-ID header + req.id for tracing

const { randomUUID } = require("crypto");

function requestIdMiddleware(req, res, next) {
  req.id = req.headers["x-request-id"] || randomUUID();
  res.setHeader("x-request-id", req.id);
  next();
}

module.exports = requestIdMiddleware;
