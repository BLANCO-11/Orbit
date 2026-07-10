// agent-backend/ws/index.js
// WebSocket server creation + upgrade handler

const WebSocket = require("ws");
const { getSharedApiKey } = require("../middleware/auth");

function createWebSocketServer(httpServer, db) {
  const wss = new WebSocket.Server({ noServer: true });

  httpServer.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url, "http://internal");
    if (url.pathname !== "/api/ws") {
      socket.destroy();
      return;
    }

    // Per-device token from the URL/OTP pairing flow (routes/devices.js) takes
    // priority when presented. Falls back to the shared-secret stopgap (see
    // middleware/auth.js) for simple single-device local setups that haven't
    // paired anything. Browsers can't set custom headers on a WS upgrade
    // request, so both travel as query params instead of headers.
    const deviceToken = url.searchParams.get("deviceToken");
    let device = null;

    if (deviceToken) {
      device = db.getDeviceByToken(deviceToken);
      if (!device) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      db.touchDeviceLastSeen(device.id);
    } else {
      const required = getSharedApiKey();
      if (required && url.searchParams.get("key") !== required) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.device = device; // null when authenticated via the shared-secret stopgap
      wss.emit("connection", ws, request);
    });
  });

  return wss;
}

module.exports = createWebSocketServer;
