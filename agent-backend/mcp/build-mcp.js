// agent-backend/mcp/build-mcp.js
//
// The `orbit-build` MCP server: build-handoff notifiers. Once the agent has
// written a runnable script/app, it calls these to hand the code off to the
// EXTERNAL build+test facility (a separate service, out of Orbit's scope).
//
//   start_build — mark the build/test phase as starting; returns a buildId and
//                 emits a lifecycle event to the parent app / console.
//   end_build   — the code is final: Orbit packages the session artifacts and
//                 submits them to the external tester, then attaches the verdict
//                 to the run's result contract.
//
// Thin stdio shim over the backend (like orbit-notify): it HTTP-calls
// /api/build/* with the injected app creds + ORBIT_SESSION_ID. The real tester
// integration lives behind those routes (stubbed until ORBIT_TESTER_URL is set).

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");

const API = process.env.ORBIT_API || "http://127.0.0.1:6800";
const API_KEY = process.env.ORBIT_API_KEY || "";
const SESSION_ID = process.env.ORBIT_SESSION_ID || "";

async function post(pathname, payload) {
  const headers = { "Content-Type": "application/json" };
  if (API_KEY) headers["Authorization"] = `Bearer ${API_KEY}`;
  const res = await fetch(`${API}${pathname}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ sessionId: SESSION_ID, ...payload }),
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
  { name: "orbit-build", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "start_build",
      description:
        "Signal that the generated script/app is ready and the build+test phase is starting. Call this once, AFTER the code is written, right before it is handed off to the external build+test facility. Returns a buildId to pass to end_build.",
      inputSchema: {
        type: "object",
        properties: {
          language: { type: "string", description: "Primary language of the build (e.g. 'python', 'node')." },
          entrypoint: { type: "string", description: "The entrypoint file to build/run (e.g. 'artifacts/fetch.py')." },
          summary: { type: "string", description: "One line describing what is being built." },
        },
      },
    },
    {
      name: "end_build",
      description:
        "Signal that the code is final and hand it off for building + testing. Orbit packages the session's artifacts and submits them to the external test facility, then attaches the returned verdict to the run result. Call this last, after start_build and after the code is complete.",
      inputSchema: {
        type: "object",
        properties: {
          buildId: { type: "string", description: "The id returned by start_build." },
          summary: { type: "string", description: "One line describing the finished build." },
          notes: { type: "string", description: "Optional notes for the tester (how to run, expected behavior)." },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    if (!SESSION_ID) throw new Error("no session context (ORBIT_SESSION_ID missing)");
    if (name === "start_build") {
      const out = await post("/api/build/start", {
        language: args?.language || "", entrypoint: args?.entrypoint || "", summary: args?.summary || "",
      });
      return { content: [{ type: "text", text: `Build started. buildId: ${out.buildId}. Call end_build with this id when the code is final.` }] };
    }
    if (name === "end_build") {
      const out = await post("/api/build/end", {
        buildId: args?.buildId || "", summary: args?.summary || "", notes: args?.notes || "",
      });
      const b = out.build || {};
      const line = b.status === "skipped"
        ? `Build handed off, but the external test facility is not configured — no verdict (${b.summary || ""}).`
        : `Build submitted to the test facility. Verdict: ${b.status}. ${b.summary || ""}`;
      return { content: [{ type: "text", text: line }] };
    }
    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: `Error executing ${name}: ${error.message}` }] };
  }
});

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Orbit Build MCP server running on stdio");
}

run().catch((error) => {
  console.error("Fatal error in Orbit Build MCP server:", error);
  process.exit(1);
});
