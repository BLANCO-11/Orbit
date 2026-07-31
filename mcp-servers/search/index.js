// mcp-server-search/index.js
//
// The `tether-search` MCP server: keyless, robust web search, webpage fetching,
// and RSS news fetching.
//
// Works around bot-detection issues in headless browsers by extracting clean text
// using readability / BeautifulSoup and DDGS engine in python, with a JS fallback.

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");
const { execFile } = require("child_process");
const path = require("path");
const fs = require("fs");

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function decodeEntities(s) {
  return String(s)
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;|&#34;/g, '"')
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x2F;/g, "/")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ").trim();
}

function unwrapDdg(href) {
  try {
    const u = new URL(href.startsWith("//") ? "https:" + href : href, "https://duckduckgo.com");
    const target = u.searchParams.get("uddg");
    return target ? decodeURIComponent(target) : href;
  } catch { return href; }
}

// Legacy JS DuckDuckGo fallback in case Python engine fails or is unavailable
async function searchDuckDuckGoJs(query, limit) {
  const res = await fetch("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query), {
    headers: { "User-Agent": UA, "Accept": "text/html", "Accept-Language": "en-US,en;q=0.9" },
  });
  if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`);
  const html = await res.text();
  if (/challenge|are you a robot|verify you are human/i.test(html) && !/result__a/.test(html)) {
    throw new Error("DuckDuckGo returned a bot challenge (rate-limited).");
  }
  const results = [];
  const linkRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = linkRe.exec(html)) && results.length < limit) {
    const link = unwrapDdg(m[1]);
    const title = decodeEntities(m[2]);
    if (!title || !/^https?:/i.test(link)) continue;
    const after = html.slice(m.index, m.index + 1200);
    const sn = after.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/) ||
               after.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/div>/);
    results.push({ title, link, summary: sn ? decodeEntities(sn[1]) : "" });
  }
  return results;
}

function getPythonExecutable() {
  const venvPython = path.join(__dirname, "venv/bin/python");
  if (fs.existsSync(venvPython)) return venvPython;
  return "python3";
}

function runPythonEngine(command, argsObj) {
  return new Promise((resolve, reject) => {
    const pythonExe = getPythonExecutable();
    const scriptPath = path.join(__dirname, "search_engine.py");
    execFile(pythonExe, [scriptPath, command, JSON.stringify(argsObj)], { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        return reject(new Error(stderr || error.message));
      }
      try {
        const parsed = JSON.parse(stdout);
        resolve(parsed);
      } catch (e) {
        reject(new Error(`Failed to parse python stdout: ${stdout}`));
      }
    });
  });
}

async function webSearch(query, limit = 5) {
  const q = String(query || "").trim();
  if (!q) throw new Error("a query is required");
  try {
    const pyResults = await runPythonEngine("search_web", { query: q, limit });
    if (Array.isArray(pyResults) && pyResults.length > 0 && !pyResults[0].error) {
      return pyResults;
    }
  } catch (err) {
    console.error("[search] Python DDGS failed, attempting JS fallback:", err.message);
  }
  return await searchDuckDuckGoJs(q, limit);
}

const server = new Server(
  { name: "tether-search", version: "1.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "web_search",
      description:
        "Search the web using DuckDuckGo and return a ranked list of results (title, link, summary). Use this to FIND pages for questions about news, facts, topics, or products.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query." },
          limit: { type: "number", description: "Max results (default 5)." },
        },
        required: ["query"],
      },
    },
    {
      name: "fetch_webpage",
      description:
        "Fetch the main readable text content from a webpage URL cleanly without running a headless browser.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "The web URL to fetch content from." },
        },
        required: ["url"],
      },
    },
    {
      name: "fetch_rss_news",
      description:
        "Fetch top news headlines and summaries from a public RSS feed.",
      inputSchema: {
        type: "object",
        properties: {
          feed_url: { type: "string", description: "RSS feed URL (default: http://feeds.bbci.co.uk/news/world/rss.xml)" },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    if (name === "web_search") {
      const results = await webSearch(args?.query, args?.limit || 5);
      if (!results || !results.length) {
        return { content: [{ type: "text", text: `No results found for "${args?.query}".` }] };
      }
      const text = results
        .map((r, i) => `${i + 1}. ${r.title}\n   ${r.link}${r.summary ? `\n   ${r.summary}` : ""}`)
        .join("\n\n");
      return { content: [{ type: "text", text: `Search results for "${args.query}":\n\n${text}` }] };
    }

    if (name === "fetch_webpage") {
      const res = await runPythonEngine("fetch_webpage", { url: args?.url });
      const content = res?.content || "No content extracted.";
      return { content: [{ type: "text", text: content }] };
    }

    if (name === "fetch_rss_news") {
      const feedUrl = args?.feed_url || "http://feeds.bbci.co.uk/news/world/rss.xml";
      const items = await runPythonEngine("fetch_rss_news", { feed_url: feedUrl });
      if (!Array.isArray(items) || items.length === 0 || items.error) {
        return { content: [{ type: "text", text: `Could not fetch RSS feed from ${feedUrl}: ${items?.error || 'Empty feed'}` }] };
      }
      const text = items.map((it, i) => `${i + 1}. ${it.title}\n   ${it.link}\n   ${it.summary}`).join("\n\n");
      return { content: [{ type: "text", text: `RSS News items from ${feedUrl}:\n\n${text}` }] };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: `Error executing ${name}: ${error.message}` }] };
  }
});

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Tether Search MCP server running on stdio");
}

run().catch((error) => {
  console.error("Fatal error in Tether Search MCP server:", error);
  process.exit(1);
});
