// mcp-server-notify/index.js
//
// The `orbit-notify` MCP server: a first-class NETWORK capability the agent uses
// to message the user and raise alerts — Telegram, the in-app bell, desktop.
//
// WHY THIS EXISTS: without it, the agent reaches for `bash`+curl (or the old
// ./orbit-notify shell script) to send a Telegram message, which is a SHELL
// capability and is blocked in chat mode — so a harmless "message me" turned
// into a policy escalation. Routing through an MCP tool makes messaging a
// network action (allowed in chat), killing that escalation for good.
//
// Both tools POST to the Orbit backend's /api/notify route, which fans the alert
// through the notification bus to the chosen sinks.

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");

const API = process.env.ORBIT_API || "http://127.0.0.1:6800";
const API_KEY = process.env.ORBIT_API_KEY || "";

async function postNotify(payload) {
  const headers = { "Content-Type": "application/json" };
  if (API_KEY) headers["Authorization"] = `Bearer ${API_KEY}`;
  const res = await fetch(`${API}/api/notify`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok || json.success === false) {
    throw new Error(json.error || json.message || `HTTP ${res.status}`);
  }
  return json;
}

const server = new Server(
  { name: "orbit-notify", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "send_message",
      description:
        "Send a text message to the user on their connected channels (e.g. Telegram). Use this when the user asks you to 'message me', 'text me', or 'send this to my phone/Telegram'. This is a network action — never shell out to curl or a script to message the user.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "The message to send to the user." },
        },
        required: ["text"],
      },
    },
    {
      name: "notify",
      description:
        "Raise an alert for the user — task completion, build failure, an anomaly, or a security warning. By default it reaches both the in-app notification bell and the user's channels (Telegram). Set web_only:true for a low-importance heads-up that shouldn't ping their phone.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short alert title." },
          body: { type: "string", description: "Optional detail line." },
          severity: { type: "string", enum: ["info", "warning", "error"], description: "Defaults to info." },
          web_only: { type: "boolean", description: "If true, only the in-app bell (no channel ping)." },
        },
        required: ["title"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    if (name === "send_message") {
      if (!args?.text || !String(args.text).trim()) throw new Error("text is required");
      await postNotify({ title: args.text, severity: "info", sinks: ["channel"] });
      return { content: [{ type: "text", text: "Message sent to the user's channels." }] };
    }

    if (name === "notify") {
      if (!args?.title || !String(args.title).trim()) throw new Error("title is required");
      const sinks = args.web_only ? ["web"] : ["web", "channel"];
      await postNotify({
        title: args.title,
        body: args.body || "",
        severity: args.severity || "info",
        sinks,
      });
      return { content: [{ type: "text", text: `Alert delivered (${sinks.join(", ")}).` }] };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: `Error executing ${name}: ${error.message}` }] };
  }
});

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Orbit Notify MCP server running on stdio");
}

run().catch((error) => {
  console.error("Fatal error in Orbit Notify MCP server:", error);
  process.exit(1);
});
