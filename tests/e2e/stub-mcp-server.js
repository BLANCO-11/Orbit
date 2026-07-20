#!/usr/bin/env node
// tests/e2e/stub-mcp-server.js
// A tiny stdio MCP server that stands in for a parent app's datasource. It
// exposes a single tool, `get_watchlist()`, returning canned JSON. The payload
// is configurable via env so one binary covers both E2E domains:
//
//   STUB_WATCHLIST='{"cities":["Delhi","Tokyo"]}'   node stub-mcp-server.js   # weather
//   STUB_WATCHLIST='{"coins":["bitcoin","ethereum"]}' node stub-mcp-server.js # crypto
//
// Registered as a tenant connector via POST /api/connectors, it becomes
// mcp_<name>_get_watchlist inside that tenant's sessions — and ONLY those.

// The @modelcontextprotocol/sdk lives in the repo-root node_modules; Node's
// module resolution walks up from this file and finds it.
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { ListToolsRequestSchema, CallToolRequestSchema } = require("@modelcontextprotocol/sdk/types.js");

let WATCHLIST;
try { WATCHLIST = JSON.parse(process.env.STUB_WATCHLIST || ""); }
catch { WATCHLIST = { cities: ["Delhi", "Tokyo"] }; }

const server = new Server(
  { name: "stub-datasource", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: "get_watchlist",
    description: "Return the parent app's watchlist (the working set of items to fetch).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  }],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== "get_watchlist") {
    throw new Error(`unknown tool: ${req.params.name}`);
  }
  return { content: [{ type: "text", text: JSON.stringify(WATCHLIST) }] };
});

const transport = new StdioServerTransport();
server.connect(transport).then(
  () => { /* connected; serve until stdin closes */ },
  (e) => { console.error("[stub-mcp] connect failed:", e.message); process.exit(1); }
);
