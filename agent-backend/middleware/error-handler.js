// agent-backend/middleware/error-handler.js
// Express error handling middleware

function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  const message = err.expose ? err.message : "Internal server error";
  
  console.error(`[Error][${req.id || "no-id"}] ${statusCode}: ${err.stack || err.message}`);
  
  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
}

module.exports = errorHandler;
