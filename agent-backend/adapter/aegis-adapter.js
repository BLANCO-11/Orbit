#!/usr/bin/env node
// aegis-adapter — connect a local pi harness to a remote AegisAgent console.
//
// Run this on any machine that has `pi` installed to make it a harness the
// console can drive, exactly like the console's own local pi. It pairs with
// the console using a one-time code (from Fleet → Pair a device), opens an
// authenticated WebSocket, and bridges a local PiCodeHarness: the console
// sends spawn/prompt/cancel, and every harness event streams back.
//
// Usage:
//   node aegis-adapter.js --server ws://HOST:6800 --code AB3XK9 [--name "My workstation"]
//   node aegis-adapter.js --server ws://HOST:6800 --token <deviceToken>
//
// LiteLLM creds come from this machine's env: LITELLM_KEY (or OPENAI_API_KEY),
// LITELLM_BASE_URL, LITELLM_MODEL.

const os = require("os");
const path = require("path");
const WebSocket = require("ws");
const EventEmitter = require("events");
const PiCodeHarness = require("../harnesses/picode");
const { discoverPiBinaries } = require("../env");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) args[argv[i].slice(2)] = argv[i + 1];
  }
  return args;
}

async function redeemCode(httpBase, code, label) {
  const res = await fetch(`${httpBase}/api/pair/redeem`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: code.toUpperCase().trim(), label }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "pairing failed");
  return data.device.token;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const server = args.server || "ws://127.0.0.1:6800";
  const httpBase = server.replace(/^ws/, "http");
  const name = args.name || `${os.userInfo().username}@${os.hostname()}`;
  const machine = os.hostname();

  let token = args.token;
  if (!token) {
    if (!args.code) {
      console.error("Provide --code <pairing code> (from Fleet) or --token <device token>.");
      process.exit(1);
    }
    console.log(`[adapter] Redeeming pairing code against ${httpBase}...`);
    token = await redeemCode(httpBase, args.code, name);
    console.log(`[adapter] Paired. Token acquired.`);
  }

  const config = {
    litellm: {
      baseURL: process.env.LITELLM_BASE_URL || "http://127.0.0.1:5000/v1",
      apiKey: process.env.LITELLM_KEY || process.env.OPENAI_API_KEY || "",
      selectedNormalModel: process.env.LITELLM_MODEL || "deepseek-v4-flash",
    },
  };
  const binaries = discoverPiBinaries();

  const ws = new WebSocket(`${server}/api/harness?token=${encodeURIComponent(token)}`);
  const harnesses = new Map(); // sessionId → PiCodeHarness

  ws.on("open", () => {
    console.log(`[adapter] Connected to ${server}. Registering as "${name}".`);
    ws.send(JSON.stringify({
      type: "register",
      name,
      machine,
      capabilities: ["chat", "plan", "edit", "yolo", "subagents", "tools"],
    }));
  });

  ws.on("message", async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === "registered") {
      console.log(`[adapter] Registered as harness ${msg.harnessId}. Waiting for sessions.`);
      return;
    }

    if (msg.type === "spawn") {
      const sessionId = msg.sessionId;
      // A forwarding emitter: every harness event also streams to the console.
      const events = new EventEmitter();
      const origEmit = events.emit.bind(events);
      events.emit = (event, data) => {
        try { ws.send(JSON.stringify({ type: "event", sessionId, event, data })); } catch {}
        return origEmit(event, data);
      };
      const harness = new PiCodeHarness({
        events, config, sessionId,
        mode: msg.mode, systemPromptType: msg.systemPromptType,
        skills: msg.skills || [], model: msg.model,
        excludeTools: msg.excludeTools || null, binaries,
      });
      harnesses.set(sessionId, harness);
      try {
        await harness.connect();
        console.log(`[adapter] Spawned session ${sessionId} (mode=${msg.mode}).`);
      } catch (e) {
        console.error(`[adapter] Spawn failed for ${sessionId}:`, e.message);
        events.emit("error", { message: e.message });
      }
      return;
    }

    if (msg.type === "list_tools") {
      // Enumerate this machine's local harness tools without a live session.
      try {
        const probe = new PiCodeHarness({ events: new EventEmitter(), config, sessionId: "probe", mode: "chat", binaries });
        const tools = await probe.listTools();
        ws.send(JSON.stringify({ type: "tools_list", reqId: msg.reqId, tools }));
      } catch (e) {
        ws.send(JSON.stringify({ type: "tools_list", reqId: msg.reqId, tools: [] }));
      }
      return;
    }

    if (msg.type === "prompt") {
      const harness = harnesses.get(msg.sessionId);
      if (harness) await harness.sendPrompt(msg.message);
      return;
    }

    if (msg.type === "cancel") {
      const harness = harnesses.get(msg.sessionId);
      if (harness) await harness.cancel();
      return;
    }

    if (msg.type === "disconnect") {
      const harness = harnesses.get(msg.sessionId);
      if (harness) { await harness.disconnect(); harnesses.delete(msg.sessionId); }
      return;
    }
  });

  ws.on("close", () => {
    console.log("[adapter] Disconnected from console. Cleaning up sessions.");
    for (const h of harnesses.values()) { try { h.disconnect(); } catch {} }
    harnesses.clear();
    process.exit(0);
  });

  ws.on("error", (err) => {
    console.error("[adapter] WebSocket error:", err.message);
  });
}

main().catch((err) => {
  console.error("[adapter] Fatal:", err.message);
  process.exit(1);
});
