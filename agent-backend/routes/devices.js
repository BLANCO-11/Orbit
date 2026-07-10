// agent-backend/routes/devices.js
// Device identity + URL/OTP pairing.
//
// POST /api/pair/start   — (authenticated) generate a short-lived pairing code + URL
// POST /api/pair/redeem  — (open) exchange a valid pairing code for a device token
// GET  /api/devices      — (authenticated) list paired devices
// PATCH /api/devices/:id — (authenticated) rename a device
// DELETE /api/devices/:id — (authenticated) revoke a device

const { Router } = require("express");

function createDevicesRouter(db, authMiddleware, getDashboardOrigin) {
  const router = Router();

  router.post("/pair/start", authMiddleware, (req, res) => {
    const label = (req.body && req.body.label) || "New device";
    const { code, expiresAt } = db.createPairingCode(String(label).slice(0, 100));
    const origin = getDashboardOrigin();
    res.json({
      success: true,
      code,
      expiresAt,
      pairingUrl: `${origin}/pair?code=${code}`,
    });
  });

  router.post("/pair/redeem", (req, res) => {
    const { code, label } = req.body || {};
    if (!code || typeof code !== "string") {
      return res.status(400).json({ success: false, message: "Missing pairing code." });
    }
    const device = db.redeemPairingCode(code.toUpperCase().trim(), label);
    if (!device) {
      return res.status(400).json({ success: false, message: "Invalid, expired, or already-used pairing code." });
    }
    res.json({ success: true, device });
  });

  router.get("/devices", authMiddleware, (req, res) => {
    res.json({ success: true, devices: db.listDevices() });
  });

  router.patch("/devices/:id", authMiddleware, (req, res) => {
    const { label } = req.body || {};
    if (!label || typeof label !== "string") {
      return res.status(400).json({ success: false, message: "Missing label." });
    }
    db.renameDevice(req.params.id, label.slice(0, 100));
    res.json({ success: true });
  });

  router.delete("/devices/:id", authMiddleware, (req, res) => {
    db.revokeDevice(req.params.id);
    res.json({ success: true });
  });

  return router;
}

module.exports = createDevicesRouter;
