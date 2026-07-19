// agent-backend/ws/index.js
// WebSocket server creation + upgrade handler

const WebSocket = require("ws");
const { resolveIdentity } = require("../middleware/auth");

function createWebSocketServer(httpServer, db, harnessRegistry) {
  const wss = new WebSocket.Server({ noServer: true });

  httpServer.on("upgrade", async (request, socket, head) => {
   try {
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
    const reject = () => { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); };

    if (isHarness) {
      // A harness adapter MUST present a valid device token — no shared-secret,
      // tenant-key, or dev-mode fallback for the harness lane.
      if (!deviceToken) return reject();
      device = await db.getDeviceByToken(deviceToken);
      if (!device) return reject();
      await db.touchDeviceLastSeen(device.id);
    } else {
      // Dashboard lane: accept ANY recognized credential — a paired device
      // token, a tenant API key, an SSO session token, or the superadmin shared
      // key — via resolveIdentity, plus dev-mode when nothing is configured.
      // Browsers can't set headers on a WS upgrade, so the credential rides as a
      // query param (`deviceToken` or `key`); adapt it into a header for reuse.
      const cred = deviceToken || url.searchParams.get("key") || "";
      const identity = await resolveIdentity({ headers: { "x-api-key": cred } }, db);
      if (!identity) return reject();
      // Keep the device binding when a device token was used, so per-device
      // scope enforcement (server.js start_task) still applies.
      if (deviceToken) {
        device = await db.getDeviceByToken(deviceToken);
        if (device) await db.touchDeviceLastSeen(device.id);
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
   } catch (e) {
    console.error("[ws upgrade] auth failed:", e.message);
    try { socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n"); socket.destroy(); } catch {}
   }
  });

  return wss;
}

module.exports = createWebSocketServer;
