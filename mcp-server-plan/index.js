// mcp-server-plan/index.js
//
// The `orbit-plan` MCP server: a structured TODO / plan the agent maintains as
// it works — so a multi-step task (build an app, research a big topic) has a
// visible checklist that gets CROSSED OFF, instead of a plan written once and
// never updated. Keeps both the user AND the agent oriented toward the goal.
//
// The tools are intentionally thin: they validate + echo back. The Orbit backend
// intercepts these tool calls per-session (it has the session context the shared
// MCP process doesn't) and is the source of truth that drives the live Mission
// board. So the agent just declares/updates steps and trusts the board.

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");

const STATUSES = ["pending", "active", "done", "blocked"];

const server = new Server(
  { name: "orbit-plan", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "plan_write",
      description:
        "Declare or replace a plan as an ordered checklist. Call this at the START of any multi-step task (building something, research, multi-file changes) so you and the user can track progress. Keep steps short and outcome-focused. Then call plan_update as you go. IMPORTANT: exactly one step should be 'active' at a time. A session may hold SEVERAL plans (one per goal) — give each a stable `planId` + short `title` + `type`. Omit planId to write the 'default' plan. Writing a NEW goal? Use a new planId; continuing an existing goal? Reuse its planId (or call plan_update).",
      inputSchema: {
        type: "object",
        properties: {
          planId: { type: "string", description: "Stable id for THIS plan (e.g. 'build', 'research'). Defaults to 'default'. Use distinct ids for distinct goals in the same session." },
          title: { type: "string", description: "Short human title for this plan (e.g. 'Build the dashboard')." },
          type: { type: "string", description: "Plan kind: build | research | refactor | ops | task. Defaults to 'task'." },
          steps: {
            type: "array",
            description: "Ordered steps.",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "Stable short id (e.g. '1','2'). Auto-assigned if omitted." },
                text: { type: "string", description: "What this step accomplishes." },
                status: { type: "string", enum: STATUSES, description: "Defaults to 'pending'." },
                deps: { type: "array", items: { type: "string" }, description: "Ids of steps that must finish first (for a DAG). Must be acyclic." },
              },
              required: ["text"],
            },
          },
        },
        required: ["steps"],
      },
    },
    {
      name: "plan_update",
      description:
        "Update one step's status as you work. Mark a step 'active' when you start it and 'done' the moment it's complete (or 'blocked' if you can't proceed). Do this continuously — the checklist should always reflect reality. Pass `planId` to target a specific plan; omit it to update the most recently written plan.",
      inputSchema: {
        type: "object",
        properties: {
          planId: { type: "string", description: "Which plan to update (defaults to the active/most-recent plan)." },
          id: { type: "string", description: "The step id to update." },
          status: { type: "string", enum: STATUSES },
          text: { type: "string", description: "Optional revised text for the step." },
        },
        required: ["id", "status"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    if (name === "plan_write") {
      const steps = Array.isArray(args?.steps) ? args.steps : [];
      if (!steps.length) throw new Error("steps must be a non-empty array");
      const normalized = steps.map((s, i) => ({
        id: String(s.id || i + 1),
        text: String(s.text || "").slice(0, 240),
        status: STATUSES.includes(s.status) ? s.status : "pending",
        deps: Array.isArray(s.deps) ? s.deps.map(String) : [],
      }));
      const done = normalized.filter((s) => s.status === "done").length;
      const planId = String(args?.planId || "default");
      return { content: [{ type: "text", text: `Plan "${planId}" set (${normalized.length} steps, ${done} done). The checklist is now live in the Mission board. Update it with plan_update as you complete each step.` }] };
    }
    if (name === "plan_update") {
      if (!args?.id) throw new Error("id is required");
      if (!STATUSES.includes(args?.status)) throw new Error(`status must be one of: ${STATUSES.join(", ")}`);
      const planId = String(args?.planId || "default");
      return { content: [{ type: "text", text: `Plan "${planId}" · step ${args.id} → ${args.status}.` }] };
    }
    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: `Error executing ${name}: ${error.message}` }] };
  }
});

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Orbit Plan MCP server running on stdio");
}

run().catch((error) => {
  console.error("Fatal error in Orbit Plan MCP server:", error);
  process.exit(1);
});
