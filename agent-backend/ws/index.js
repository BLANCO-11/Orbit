// agent-backend/ws/index.js
// WebSocket server creation + upgrade handler

const WebSocket = require("ws");
const { getSharedApiKey } = require("../middleware/auth");

function createWebSocketServer(httpServer) {
  const wss = new WebSocket.Server({ noServer: true });

  httpServer.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url, "http://internal");
    if (url.pathname !== "/api/ws") {
      socket.destroy();
      return;
    }

    // Same shared-secret stopgap as the HTTP API (see middleware/auth.js).
    // Browsers can't set custom headers on the WS upgrade request, so the key
    // travels as a query param here instead.
    const required = getSharedApiKey();
    if (required && url.searchParams.get("key") !== required) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  return wss;
}

module.exports = createWebSocketServer;
