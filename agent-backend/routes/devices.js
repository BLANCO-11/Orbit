// agent-backend/routes/devices.js
// Device identity + URL/OTP pairing.
//
// POST /api/pair/start   — (authenticated) generate a short-lived pairing code + URL
// POST /api/pair/redeem  — (open) exchange a valid pairing code for a device token
// GET  /api/devices      — (authenticated) list paired devices
// PATCH /api/devices/:id — (authenticated) rename a device
// DELETE /api/devices/:id — (authenticated) revoke a device

const { Router } = require("express");
const fs = require("fs");
const path = require("path");

function createDevicesRouter(db, authMiddleware, getDashboardOrigin) {
  const router = Router();

  router.get("/pair/bootstrap", (req, res) => {
    const { code, label } = req.query || {};
    if (!code || typeof code !== "string") {
      return res.status(400).send("// Error: Missing pairing code.");
    }
    const device = db.redeemPairingCode(code.toUpperCase().trim(), label);
    if (!device) {
      return res.status(400).send("// Error: Invalid, expired, or already-used pairing code.");
    }
    
    // Detect host/origin and secure protocol dynamically from req
    const host = req.get("host") || "127.0.0.1:6800";
    const isSecure = req.secure || req.headers["x-forwarded-proto"] === "https";
    const serverUrl = `${isSecure ? "wss" : "ws"}://${host}`;
    const bootstrapOrigin = `${isSecure ? "https" : "http"}://${host}`;
    
    const script = `
// Dynamic variables injected by the Orbit Server at request-time
const SERVER_URL = ${JSON.stringify(serverUrl)};
const DEVICE_TOKEN = ${JSON.stringify(device.token)};
const BOOTSTRAP_ORIGIN = ${JSON.stringify(bootstrapOrigin)};

const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

console.log("[bootstrap] Starting Orbit remote harness installer...");

async function run() {
  try {
    // 1. Download the full adapter code from the server
    console.log("[bootstrap] Downloading orbit-adapter.js...");
    const response = await fetch(\`\${BOOTSTRAP_ORIGIN}/api/pair/adapter\`);
    if (!response.ok) throw new Error("Failed to download adapter source.");
    const adapterCode = await response.text();

    // 2. Write it to local disk
    const targetPath = path.join(process.cwd(), "orbit-adapter.js");
    fs.writeFileSync(targetPath, adapterCode);
    console.log(\`[bootstrap] Saved adapter to \${targetPath}\`);

    // 3. Spawn the adapter daemon process using the pre-baked token
    console.log("[bootstrap] Launching adapter daemon...");
    const child = exec(\`node "\${targetPath}" --server "\${SERVER_URL}" --token "\${DEVICE_TOKEN}"\`, (err) => {
      if (err) {
        console.error("[bootstrap] Adapter crashed:", err.message);
      }
    });

    child.stdout.on("data", (data) => console.log(\`[adapter] \${data.trim()}\`));
    child.stderr.on("data", (data) => console.error(\`[adapter-err] \${data.trim()}\`));

    // Keep bootstrap process alive briefly to ensure WebSocket connection succeeds
    setTimeout(() => {
      console.log("[bootstrap] Setup complete. Daemon is running in the background.");
      process.exit(0);
    }, 3000);

  } catch (err) {
    console.error("[bootstrap] Installation failed:", err.message);
    process.exit(1);
  }
}

run();
`;
    res.setHeader("Content-Type", "application/javascript");
    res.send(script);
  });

  router.get("/pair/adapter", (req, res) => {
    const adapterPath = path.join(__dirname, "../adapter/orbit-adapter.js");
    if (!fs.existsSync(adapterPath)) {
      return res.status(404).send("// Error: Adapter source not found on server.");
    }
    res.sendFile(adapterPath);
  });

  router.post("/pair/start", authMiddleware, (req, res) => {
    const label = (req.body && req.body.label) || "New device";
    const scope = (req.body && req.body.scope) || "full";
    const { code, expiresAt, scope: grantedScope } = db.createPairingCode(String(label).slice(0, 100), scope);
    const origin = getDashboardOrigin();
    res.json({
      success: true,
      code,
      expiresAt,
      scope: grantedScope,
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

  // Set per-device policy overrides (a partial capability × mode matrix). The
  // engine applies these tighten-only, so this can only further restrict a
  // device, never grant it more than the global matrix.
  router.patch("/devices/:id/policy", authMiddleware, (req, res) => {
    const { policyOverrides } = req.body || {};
    if (policyOverrides && typeof policyOverrides !== "object") {
      return res.status(400).json({ success: false, message: "policyOverrides must be an object." });
    }
    db.setDevicePolicyOverrides(req.params.id, policyOverrides || {});
    res.json({ success: true });
  });

  router.delete("/devices/:id", authMiddleware, (req, res) => {
    db.revokeDevice(req.params.id);
    res.json({ success: true });
  });

  return router;
}

module.exports = createDevicesRouter;
