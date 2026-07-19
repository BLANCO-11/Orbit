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

// Public origins for this request, TLS/proxy-correct. The harness connection
// descriptor's wsUrl (ws:// vs wss://) is derived here, so getting the scheme
// wrong behind a proxy makes the harness dial the wrong scheme and the WS upgrade
// fails with a non-101. Resolution order:
//   1. ORBIT_PUBLIC_ORIGIN (e.g. "https://orbit.example.com") — an explicit pin
//      that ignores request headers entirely. Use this when a proxy can't be
//      trusted to set X-Forwarded-Proto (chained proxies, Cloudflare Tunnel, …).
//   2. else req.secure / X-Forwarded-Proto === "https" + the Host header.
function detectOrigins(req) {
  const override = process.env.ORBIT_PUBLIC_ORIGIN;
  if (override) {
    try {
      const u = new URL(override);
      const isSecure = u.protocol === "https:";
      return {
        host: u.host,
        isSecure,
        wsOrigin: `${isSecure ? "wss" : "ws"}://${u.host}`,
        httpOrigin: `${isSecure ? "https" : "http"}://${u.host}`,
      };
    } catch { /* malformed override → fall through to header detection */ }
  }
  const host = req.get("host") || "127.0.0.1:6800";
  const isSecure = req.secure || req.headers["x-forwarded-proto"] === "https";
  return {
    host,
    isSecure,
    wsOrigin: `${isSecure ? "wss" : "ws"}://${host}`,
    httpOrigin: `${isSecure ? "https" : "http"}://${host}`,
  };
}

// Explicit host-trust advisory for a full-scope pairing. A paired remote runs
// agent tool calls — including arbitrary shell — on its OWN machine, where
// Orbit's container isolation does NOT reach (the policy gate still evaluates
// calls, but containment is host-local only). Surfaced so the UI and the human
// pairing the device see the trust decision they're making. `null` for the
// narrower scopes (read_only / chat_voice) that can't run shell.
function remoteTrustNotice(scope) {
  if (scope !== "full") return null;
  return {
    uncontained: true,
    level: "warning",
    title: "This machine will run agent commands on itself",
    detail:
      "A full-scope remote harness executes agent tool calls — including arbitrary shell — on its own OS. " +
      "Orbit's container sandbox does not apply to remote machines; the policy gate still evaluates each call, " +
      "but pairing a remote is a host-trust decision. Pair only machines you control and trust.",
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
    security: remoteTrustNotice(device.scope),
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

    // The bootstrap IS the adapter: we serve the generic, zero-dependency
    // `orbit-connect.js` with the pairing descriptor baked in. `curl … | node`
    // then pairs + connects in one step — no secondary download, no `npm
    // install ws`, no `pi`, no repo checkout. It runs on any OS with a stock
    // Node 20+ and drives whatever OpenAI-SDK-compatible model the machine has.
    const descriptor = buildDescriptor(req, device);
    const adapterPath = path.join(__dirname, "../adapter/orbit-connect.js");
    let adapterSrc;
    try { adapterSrc = fs.readFileSync(adapterPath, "utf8"); }
    catch { return res.status(500).send("// Error: adapter source not found on server."); }
    // Node only strips a shebang on LINE 1. Prepending the descriptor header
    // pushes orbit-connect's `#!/usr/bin/env node` down, which then throws a
    // SyntaxError under `curl … | node`. Drop the leading shebang before injecting.
    adapterSrc = adapterSrc.replace(/^#![^\n]*\n/, "");

    const header =
      `// Injected by the Orbit server — one-time redemption of a pairing code.\n` +
      `// The descriptor below is the durable credential from here on; it is\n` +
      `// persisted to ~/.orbit so a restart reconnects without re-pairing.\n` +
      `globalThis.__ORBIT_DESCRIPTOR__ = ${JSON.stringify(descriptor)};\n\n`;

    res.setHeader("Content-Type", "application/javascript");
    res.send(header + adapterSrc);
  });

  // Agent-actionable connection instructions (Markdown). The "clean autonomous"
  // path: the operator hands an agent ONE url — `…/api/pair/agent?code=XYZ` — and
  // the agent fetches this, then follows it to pair + stay connected on its own.
  // Deliberately does NOT redeem the code (safe to fetch/retry); the code is
  // redeemed only when the agent actually runs the bootstrap below.
  router.get("/pair/agent", pairRateLimit, (req, res) => {
    const { code } = req.query || {};
    if (!code || typeof code !== "string") {
      return res.status(400).type("text/markdown").send("# Error\nMissing pairing code. Ask the operator for a fresh Orbit pairing link.");
    }
    const safeCode = code.toUpperCase().trim().replace(/[^A-Z0-9]/g, "").slice(0, 16);
    const { httpOrigin } = detectOrigins(req);
    const bootstrap = `curl -fsSL '${httpOrigin}/api/pair/bootstrap?code=${safeCode}' | node`;
    const md =
`# Connect this machine to Orbit (run a persistent connector)

You are asked to connect **this machine** to an Orbit control plane as a *harness*.
Orbit sends tasks; you carry them out with your own agent (its own tools + model)
and results stream back. A small **connector process holds the live connection** —
it auto-detects your installed agent (pi, Claude Code, OpenCode, Codex, Gemini CLI,
Aider, …) and drives it. **No API keys needed.**

> ⚠️ **This is a long-running daemon, not a one-off command.** The connection lives
> only while the connector process is alive. **Spawn it detached / in the
> background so it runs indefinitely**, and do NOT stop it when your current task
> ends. Never run it foreground-and-wait.

## How reconnection works (so you don't over-engineer it)
- **Network drop → automatic.** The connector reconnects on its own (backoff +
  heartbeat). You don't do anything, and you never need a new code for this.
- **The durable credential is a token, not the code.** Pairing exchanges the
  single-use code for a device token saved to \`~/.orbit\`. Every reconnect/restart
  reuses that token — re-pair ONLY if the operator revokes this device.
- **What the connector can't do itself: come back after its process is killed or
  the box reboots.** That needs a supervisor/service (below).

## Tier 1 — get connected now (survives your session)
1. Node.js 20+: \`node --version\`.
2. Start it detached:
   \`\`\`bash
   nohup sh -c "${bootstrap}" > "$HOME/orbit-connect.log" 2>&1 &
   disown 2>/dev/null || true
   \`\`\`
3. Verify (don't skip):
   \`\`\`bash
   sleep 3 && grep -m1 "Registered as harness" "$HOME/orbit-connect.log" \\
     && echo "OK — connected. Leave this running." \\
     || (echo "NOT connected:"; tail -n 20 "$HOME/orbit-connect.log")
   \`\`\`
This step also saves the connector to \`~/.orbit/orbit-connect.js\` for Tier 2.

## Tier 2 — durable (survives crashes + reboots) — RECOMMENDED
The restart command must be the **saved connector run from the persisted token** —
NOT the bootstrap curl (its code is single-use). After Tier 1 has paired once:

**Linux (systemd user service):**
\`\`\`bash
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/orbit-connect.service <<'EOF'
[Unit]
Description=Orbit connector
After=network-online.target
[Service]
ExecStart=/usr/bin/env node %h/.orbit/orbit-connect.js
Restart=always
RestartSec=3
[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload && systemctl --user enable --now orbit-connect
loginctl enable-linger "$USER"   # keep running with no active login
\`\`\`

**macOS (launchd):**
\`\`\`bash
cat > ~/Library/LaunchAgents/ai.orbit.connect.plist <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>ai.orbit.connect</string>
  <key>ProgramArguments</key><array><string>/usr/bin/env</string><string>node</string><string>$HOME/.orbit/orbit-connect.js</string></array>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
</dict></plist>
EOF
launchctl load ~/Library/LaunchAgents/ai.orbit.connect.plist
\`\`\`

**Windows (Task Scheduler, run at logon + restart):** pair once, then:
\`\`\`powershell
schtasks /Create /TN OrbitConnect /SC ONLOGON /RL LIMITED /F ^
  /TR "node %USERPROFILE%\\.orbit\\orbit-connect.js"
\`\`\`

## Notes
- The pairing code is **single-use** and **expires in 5 minutes**. \`code_expired\`
  → ask the operator for a fresh link.
- No supported agent installed? Install one, or run the built-in generic loop:
  export \`OPENAI_BASE_URL\`/\`OPENAI_API_KEY\`/\`OPENAI_MODEL\` and prefix
  \`ORBIT_CONNECT_AGENT=generic\`. Force a specific agent with
  \`ORBIT_CONNECT_AGENT=<pi|claude|opencode|codex|gemini|aider>\`.
`;
    res.type("text/markdown").send(md);
  });

  // Raw generic adapter source (no descriptor) — for manual download / inspection.
  router.get("/pair/adapter", (req, res) => {
    const adapterPath = path.join(__dirname, "../adapter/orbit-connect.js");
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
      // Host-trust advisory for the operator (null for non-shell scopes).
      security: remoteTrustNotice(grantedScope),
      pairingUrl: `${dashOrigin}/pair?code=${code}`,
      // For a custom/third-party harness: fetch this for the JSON descriptor.
      connectUrl: `${httpOrigin}/api/pair/connect?code=${code}`,
      // For Orbit's own adapter: paste this verbatim on the harness machine.
      bootstrapCommand: `curl -fsSL '${httpOrigin}/api/pair/bootstrap?code=${code}' | node`,
      // For the autonomous flow: hand an agent this ONE url (it fetches
      // machine-readable steps and wires itself up), or paste `agentPrompt`.
      agentUrl: `${httpOrigin}/api/pair/agent?code=${code}`,
      agentPrompt: `Connect this machine to Orbit: fetch ${httpOrigin}/api/pair/agent?code=${code} and follow the instructions to pair and stay connected.`,
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

  // Per-device brain (remote-agent-connect plan §3). DEFAULT: a paired remote
  // harness uses its OWN LLM provider (env on the box) and never depends on Orbit
  // for inference — Orbit supplies only the plan/context. This route configures
  // that provider centrally instead:
  //   • `{ baseURL, apiKey, model }` — a bring-your-own endpoint for this device;
  //   • `{ provider: "orbit" }`     — explicit opt-in to borrow Orbit's own LLM
  //                                    gateway as this device's brain (off by default);
  //   • `null` / `{}`               — clear it (back to the box's own env provider).
  // The apiKey is stored but never returned by GET /devices (redacted to `hasApiKey`).
  router.patch("/devices/:id/llm", authMiddleware, (req, res) => {
    const cfg = req.body && req.body.llmConfig;
    if (cfg && typeof cfg !== "object") {
      return res.status(400).json({ success: false, message: "llmConfig must be an object or null." });
    }
    if (cfg && cfg.provider && cfg.provider !== "orbit") {
      return res.status(400).json({ success: false, message: 'llmConfig.provider must be "orbit" (or omit it and give a baseURL for bring-your-own).' });
    }
    if (cfg && cfg.baseURL && !/^https?:\/\//i.test(String(cfg.baseURL))) {
      return res.status(400).json({ success: false, message: "llmConfig.baseURL must be an http(s) URL." });
    }
    db.setDeviceLlmConfig(req.params.id, cfg || {});
    res.json({ success: true });
  });

  router.delete("/devices/:id", authMiddleware, (req, res) => {
    db.revokeDevice(req.params.id);
    res.json({ success: true });
  });

  return router;
}

module.exports = createDevicesRouter;
