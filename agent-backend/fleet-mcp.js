// agent-backend/fleet-mcp.js
//
// The baked-in `orbit-fleet` MCP server: the tools the LEAD agent uses to drive other
// devices. It exposes two tools — list_devices and dispatch_to_device — and
// forwards each call to the Orbit backend's /api/fleet routes, which run the
// task on the target device's harness and return the answer. See
// agent-backend/fleet.js.

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");

const API = process.env.ORBIT_API || "http://127.0.0.1:6800";
const API_KEY = process.env.ORBIT_API_KEY || "";

async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (API_KEY) headers["Authorization"] = `Bearer ${API_KEY}`;
  const res = await fetch(`${API}${path}`, { ...opts, headers });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok || json.success === false) {
    throw new Error(json.error || json.message || `HTTP ${res.status}`);
  }
  return json;
}

const server = new Server(
  { name: "orbit-fleet", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_devices",
      description:
        "List the targets you can delegate work to: local AGENT TYPES ('local' = pi, 'opencode' = OpenCode) plus any paired remote devices. Call this before dispatch_to_device to see valid target ids. Use it to mix agents — e.g. run one subtask on pi and another on OpenCode.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "dispatch_to_device",
      description:
        "Delegate a self-contained task to another agent/device and get its final answer back. `device` picks the target: a local agent type ('local'=pi, 'opencode'=OpenCode) runs it on THIS host with a fresh agent of that type; a remote device id runs it on that machine. IMPORTANT: the delegate does NOT see this conversation — give it a complete, standalone instruction. By default the delegate inherits YOUR execution rights (mode); set `mode` to grant it fewer/appropriate rights (it can never exceed yours). Fan out subtasks, then merge the answers yourself.",
      inputSchema: {
        type: "object",
        properties: {
          device: { type: "string", description: "A target id from list_devices: 'local' (pi), 'opencode', or a paired device id." },
          task: { type: "string", description: "A complete, standalone instruction for the delegate agent." },
          mode: { type: "string", enum: ["chat", "plan", "edit", "yolo"], description: "Execution rights to grant the delegate (default: inherit yours). chat=read/answer, plan=read+research, edit=read/write/shell, yolo=unrestricted. Capped at your own rights." },
        },
        required: ["device", "task"],
      },
    },
    {
      name: "list_capabilities",
      description:
        "Discover what THIS Orbit backend can actually do right now — which LLM/voice/search/browse are configured, which MCP connectors and service connections (GitHub, Slack, Notion, …) are connected, whether Telegram/Discord/Slack messaging is wired, and what fleet devices are paired. Call this BEFORE assuming a capability exists (e.g. before trying to message Telegram or use a connector). If something you need is unavailable, tell the user how to set it up rather than failing silently.",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    if (name === "list_devices") {
      const d = await api("/api/fleet/devices");
      const list = (d.devices || [])
        .map((x) => `- ${x.id}  (${x.name}${x.machine && x.machine !== x.id ? ` · ${x.machine}` : ""}) — ${x.transport}, ${x.status}`)
        .join("\n");
      return { content: [{ type: "text", text: list || "No devices available." }] };
    }

    if (name === "dispatch_to_device") {
      const d = await api("/api/fleet/dispatch", {
        method: "POST",
        body: JSON.stringify({
          device: args.device,
          prompt: args.task,
          mode: args.mode,                          // explicit rights (capped server-side)
          leadSessionId: process.env.ORBIT_SESSION_ID, // so the delegate inherits the lead's rights
        }),
      });
      return {
        content: [{ type: "text", text: `[${d.device} · ${d.status}]\n${d.output || "(no output returned)"}` }],
      };
    }

    if (name === "list_capabilities") {
      const d = await api("/api/capabilities");
      const caps = d.capabilities || {};
      const label = (c) => {
        if (!c) return "unknown";
        if (c.configured && c.connected) return "ready";
        if (c.configured && c.connected === null) return "configured";
        if (c.configured) return "configured (not connected)";
        return "unavailable";
      };
      const lines = Object.entries(caps).map(
        ([k, c]) => `- ${k}: ${label(c)}${c && c.detail ? ` — ${c.detail}` : ""}`
      );
      return { content: [{ type: "text", text: `Orbit capabilities right now:\n${lines.join("\n")}` }] };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: `Error executing ${name}: ${error.message}` }] };
  }
});

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Orbit Fleet MCP server running on stdio");
}

run().catch((error) => {
  console.error("Fatal error in Orbit Fleet MCP server:", error);
  process.exit(1);
});
