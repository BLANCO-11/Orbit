// agent-backend/ws/index.js
// WebSocket server creation + upgrade handler

const WebSocket = require("ws");

function createWebSocketServer(httpServer) {
  const wss = new WebSocket.Server({ noServer: true });
  
  httpServer.on("upgrade", (request, socket, head) => {
    if (request.url === "/api/ws") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  });
  
  return wss;
}

module.exports = createWebSocketServer;
