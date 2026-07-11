// agent-backend/ws/index.js
// WebSocket server creation + upgrade handler

const WebSocket = require("ws");
const { getSharedApiKey } = require("../middleware/auth");

function createWebSocketServer(httpServer, db, harnessRegistry) {
  const wss = new WebSocket.Server({ noServer: true });

  httpServer.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url, "http://internal");
    const isDashboard = url.pathname === "/api/ws";
    const isHarness = url.pathname === "/api/harness";
    if (!isDashboard && !isHarness) {
      socket.destroy();
      return;
    }

    // Per-device token from the URL/OTP pairing flow (routes/devices.js) takes
    // priority when presented. Falls back to the shared-secret stopgap (see
    // middleware/auth.js) for simple single-device local setups that haven't
    // paired anything. Browsers can't set custom headers on a WS upgrade
    // request, so both travel as query params instead of headers.
    const deviceToken = url.searchParams.get("deviceToken") || url.searchParams.get("token");
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
      // A harness adapter MUST present a device token; only the dashboard may
      // fall back to the shared-secret / dev-mode path.
      if (isHarness) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      const required = getSharedApiKey();
      if (required && url.searchParams.get("key") !== required) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
    }

    if (isHarness && harnessRegistry) {
      harnessRegistry.wss.handleUpgrade(request, socket, head, (ws) => {
        harnessRegistry.wss.emit("connection", ws, request, device);
      });
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.device = device; // null when authenticated via the shared-secret stopgap
      wss.emit("connection", ws, request);
    });
  });

  return wss;
}

module.exports = createWebSocketServer;
