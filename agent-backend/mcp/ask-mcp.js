// agent-backend/mcp/ask-mcp.js
//
// The `orbit-ask` MCP server: a baked-in "ask the user a question" tool, like
// Claude Code's AskUserQuestion. The agent calls it to get clarification —
// free-text OR multiple-choice (single/multi) — instead of guessing.
//
// HOW IT RESOLVES: this tool POSTs to the Orbit backend's /api/ask and BLOCKS
// until an answer comes back. The backend routes the question to a live browser
// session (interactive) and/or marks a headless run `awaiting_input` for the
// parent app to answer over REST — then resolves this call with the answers.
//
// Modeled on orbit-notify: a thin stdio shim that HTTP-calls the backend with
// the injected app creds + ORBIT_SESSION_ID.

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");

const API = process.env.ORBIT_API || "http://127.0.0.1:6800";
const API_KEY = process.env.ORBIT_API_KEY || "";
const SESSION_ID = process.env.ORBIT_SESSION_ID || "";

async function postAsk(questions) {
  const headers = { "Content-Type": "application/json" };
  if (API_KEY) headers["Authorization"] = `Bearer ${API_KEY}`;
  const res = await fetch(`${API}/api/ask`, {
    method: "POST",
    headers,
    body: JSON.stringify({ sessionId: SESSION_ID, questions }),
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
  { name: "orbit-ask", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "ask_questions",
      description:
        "Ask the user one or more clarifying questions and WAIT for their answer before continuing. Use this when a decision is genuinely the user's to make and you cannot resolve it from the request or sensible defaults — do NOT use it for choices with an obvious default. Each question can be free-text or multiple-choice (single- or multi-select). Ask 1–4 questions at once. Returns the user's answers keyed by question id.",
      inputSchema: {
        type: "object",
        properties: {
          questions: {
            type: "array",
            description: "1–4 questions to ask.",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "Stable id you'll read the answer back by (e.g. 'db_choice'). Optional." },
                question: { type: "string", description: "The full question text." },
                header: { type: "string", description: "Very short label (≤40 chars) for the question chip." },
                kind: { type: "string", enum: ["text", "single", "multi"], description: "'text' free-form, 'single' pick-one, 'multi' pick-many. Defaults to 'single' if options are given, else 'text'." },
                options: {
                  type: "array",
                  description: "Choices for single/multi questions (2–8).",
                  items: {
                    type: "object",
                    properties: {
                      label: { type: "string", description: "The choice text." },
                      description: { type: "string", description: "Optional explanation of the choice." },
                    },
                    required: ["label"],
                  },
                },
              },
              required: ["question"],
            },
          },
        },
        required: ["questions"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    if (name === "ask_questions") {
      const questions = Array.isArray(args?.questions) ? args.questions : [];
      if (!questions.length) throw new Error("provide at least one question");
      if (!SESSION_ID) throw new Error("no session context (ORBIT_SESSION_ID missing)");
      const result = await postAsk(questions);
      if (result.answered === false) {
        return { content: [{ type: "text", text: result.note || "No answer was provided; proceed with your best assumption." }] };
      }
      return { content: [{ type: "text", text: `User answered:\n${JSON.stringify(result.answers, null, 2)}` }] };
    }
    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: `Error executing ${name}: ${error.message}` }] };
  }
});

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Orbit Ask MCP server running on stdio");
}

run().catch((error) => {
  console.error("Fatal error in Orbit Ask MCP server:", error);
  process.exit(1);
});
