// agent-backend/routes/devices.js
// Device identity + URL/OTP pairing.
//
// POST /api/pair/start    — (authenticated) mint a short-lived pairing code + links
// GET  /api/pair/connect  — (open, code-gated) redeem a code → connection descriptor (JSON)
// GET  /api/pair/bootstrap — (open, code-gated) redeem a code → runnable adapter installer
// POST /api/pair/redeem   — (open, code-gated) exchange a code for a device token (legacy)
// GET  /api/devices       — (authenticated) list paired devices
// PATCH /api/devices/:id  — (authenticated) rename a device
// DELETE /api/devices/:id — (authenticated) revoke a device
//
// One connection contract, one builder. `connect`, `bootstrap`, and `redeem`
// all redeem the same single-use code and speak the same descriptor shape
// (buildDescriptor) — they differ only in how the harness consumes it (raw
// JSON vs. a launcher script vs. a bare token).

const { Router } = require("express");
const fs = require("fs");
const path = require("path");

// Harness↔backend wire contract version. Bumped when the register payload or
// event stream changes shape. Surfaced in the descriptor so third-party
// harnesses can negotiate. See API.md § "Harness protocol v1".
const PROTOCOL_VERSION = "1";

// Public origins for this request, TLS/nginx-correct: honors x-forwarded-proto
// so the links work off-box behind a reverse proxy, not just on loopback.
function detectOrigins(req) {
  const host = req.get("host") || "127.0.0.1:6800";
  const isSecure = req.secure || req.headers["x-forwarded-proto"] === "https";
  return {
    host,
    isSecure,
    wsOrigin: `${isSecure ? "wss" : "ws"}://${host}`,
    httpOrigin: `${isSecure ? "https" : "http"}://${host}`,
  };
}

// The single source of truth a harness needs to connect and stay connected.
// The raw device token rides in here (returned exactly once), so this is only
// safe over TLS off-loopback — see the security note in the pairing plan.
function buildDescriptor(req, device) {
  const { wsOrigin } = detectOrigins(req);
  return {
    protocolVersion: PROTOCOL_VERSION,
    wsUrl: `${wsOrigin}/api/harness`,
    token: device.token,
    device: { id: device.id, label: device.label, scope: device.scope },
    register: {
      type: "register",
      required: ["name", "machine", "capabilities"],
      capabilitiesExample: ["chat", "plan", "edit", "yolo", "subagents", "tools"],
    },
    heartbeat: { intervalMs: 30000, type: "ping" },
    reconnect: { backoffMs: [1000, 2000, 5000, 15000], maxJitterMs: 500 },
  };
}

// Minimal in-memory per-IP rate limiter (no external dep). Blunts brute-forcing
// of the 6-char code on the open, code-gated endpoints. Paired with the 5-min
// TTL + single-use guard this makes guessing infeasible.
function makeRateLimiter({ windowMs, max }) {
  const hits = new Map(); // ip → { count, resetAt }
  return function rateLimit(req, res, next) {
    const now = Date.now();
    const ip = req.ip || (req.connection && req.connection.remoteAddress) || "unknown";
    let rec = hits.get(ip);
    if (!rec || now > rec.resetAt) {
      rec = { count: 0, resetAt: now + windowMs };
      hits.set(ip, rec);
    }
    rec.count++;
    // Opportunistic prune so the map can't grow unbounded.
    if (hits.size > 4096) {
      for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k);
    }
    if (rec.count > max) {
      res.setHeader("Retry-After", Math.ceil((rec.resetAt - now) / 1000));
      return res.status(429).json({ error: "rate_limited", message: "Too many pairing attempts, slow down." });
    }
    next();
  };
}

function createDevicesRouter(db, authMiddleware, getDashboardOrigin) {
  const router = Router();

  // 20 attempts / minute / IP across the open code-gated endpoints.
  const pairRateLimit = makeRateLimiter({ windowMs: 60 * 1000, max: 20 });

  // Generic connection descriptor for ANY harness (Orbit's adapter or a custom
  // third-party one). Redeems the code single-use, then hands back everything
  // needed to connect and stay connected as plain JSON.
  router.get("/pair/connect", pairRateLimit, (req, res) => {
    const { code, label } = req.query || {};
    if (!code || typeof code !== "string") {
      return res.status(400).json({ error: "missing_code", message: "Missing pairing code." });
    }
    const device = db.redeemPairingCode(code.toUpperCase().trim(), label);
    if (!device) {
      return res.status(410).json({ error: "code_expired", message: "Invalid, expired, or already-used pairing code. Ask the operator for a fresh code." });
    }
    res.json(buildDescriptor(req, device));
  });

  router.get("/pair/bootstrap", pairRateLimit, (req, res) => {
    const { code, label } = req.query || {};
    if (!code || typeof code !== "string") {
      return res.status(400).send("// Error: Missing pairing code.");
    }
    const device = db.redeemPairingCode(code.toUpperCase().trim(), label);
    if (!device) {
      return res.status(410).send("// Error: Invalid, expired, or already-used pairing code. Ask the operator for a fresh code.");
    }

    // Same descriptor as /pair/connect — one contract. The bootstrap is a thin
    // convenience wrapper: it bakes the descriptor into a launcher that
    // persists the token and starts Orbit's adapter, so a restart reconnects
    // without re-pairing.
    const { httpOrigin } = detectOrigins(req);
    const descriptor = buildDescriptor(req, device);

    const script = `
// Injected by the Orbit server at request-time — one-time redemption of a
// pairing code. The descriptor below is the durable credential from here on.
const DESCRIPTOR = ${JSON.stringify(descriptor)};
const BOOTSTRAP_ORIGIN = ${JSON.stringify(httpOrigin)};

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

console.log("[bootstrap] Starting Orbit remote harness installer...");

async function run() {
  try {
    // 1. Persist the descriptor so restarts reconnect without re-pairing.
    const home = process.env.ORBIT_ADAPTER_HOME || path.join(os.homedir(), ".orbit");
    fs.mkdirSync(home, { recursive: true });
    const credsPath = path.join(home, "adapter-credentials.json");
    let store = {};
    try { store = JSON.parse(fs.readFileSync(credsPath, "utf8")); } catch {}
    const host = new URL(DESCRIPTOR.wsUrl).host;
    store[host] = {
      wsUrl: DESCRIPTOR.wsUrl,
      token: DESCRIPTOR.token,
      deviceId: DESCRIPTOR.device.id,
      label: DESCRIPTOR.device.label,
      scope: DESCRIPTOR.device.scope,
    };
    fs.writeFileSync(credsPath, JSON.stringify(store, null, 2), { mode: 0o600 });
    try { fs.chmodSync(credsPath, 0o600); } catch {}
    console.log(\`[bootstrap] Saved credentials to \${credsPath}\`);

    // 2. Download the adapter source from the server.
    console.log("[bootstrap] Downloading orbit-adapter.js...");
    const response = await fetch(\`\${BOOTSTRAP_ORIGIN}/api/pair/adapter\`);
    if (!response.ok) throw new Error("Failed to download adapter source.");
    const targetPath = path.join(process.cwd(), "orbit-adapter.js");
    fs.writeFileSync(targetPath, await response.text());
    console.log(\`[bootstrap] Saved adapter to \${targetPath}\`);

    // 3. Launch the adapter. It reads the persisted credential itself — no
    //    token on the command line — and supervises its own reconnects.
    console.log("[bootstrap] Launching adapter daemon...");
    const child = spawn("node", [targetPath, "--server", DESCRIPTOR.wsUrl], {
      stdio: "inherit",
    });
    child.on("exit", (code) => process.exit(code || 0));
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

    // The dashboard page link uses the configured dashboard origin. The
    // harness-facing links (connect + bootstrap) MUST use the PUBLIC origin of
    // THIS request — derived like the descriptor endpoints — so the pasted
    // command works off-box behind nginx, not the internal DASHBOARD_ORIGIN.
    const dashOrigin = getDashboardOrigin();
    const { httpOrigin } = detectOrigins(req);
    res.json({
      success: true,
      code,
      expiresAt,
      scope: grantedScope,
      pairingUrl: `${dashOrigin}/pair?code=${code}`,
      // For a custom/third-party harness: fetch this for the JSON descriptor.
      connectUrl: `${httpOrigin}/api/pair/connect?code=${code}`,
      // For Orbit's own adapter: paste this verbatim on the harness machine.
      bootstrapCommand: `curl -fsSL '${httpOrigin}/api/pair/bootstrap?code=${code}' | node`,
    });
  });

  router.post("/pair/redeem", pairRateLimit, (req, res) => {
    const { code, label } = req.body || {};
    if (!code || typeof code !== "string") {
      return res.status(400).json({ success: false, message: "Missing pairing code." });
    }
    const device = db.redeemPairingCode(code.toUpperCase().trim(), label);
    if (!device) {
      return res.status(410).json({ success: false, error: "code_expired", message: "Invalid, expired, or already-used pairing code." });
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
