// mcp-server-search/index.js
//
// The `orbit-search` MCP server: a keyless, best-effort web SEARCH tool — the
// default retriever when no native/keyed search is configured.
//
// WHY IT EXISTS: an LLM can't browse the live web, and the Lightpanda browser
// can only READ a URL you already have — it can't run a query on Google/DDG
// (they captcha-block bots). Without a search tool the agent spiraled across
// engines and curl hacks. This tool does ONE clean thing: hit a scrape-friendly
// engine (DuckDuckGo's HTML endpoint) and return parsed results. Lightpanda then
// opens the result URLs to read them.
//
// Philosophy: NOT trying to defeat anti-bot. Best-effort — if we get data, great;
// if an engine blocks us, we return a clear "no results" so the agent stops
// instead of flailing. A native/keyed search (pi web_search with a key) takes
// priority over this when configured.

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function decodeEntities(s) {
  return String(s)
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;|&#34;/g, '"')
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x2F;/g, "/")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ").trim();
}

/** DuckDuckGo redirect links look like //duckduckgo.com/l/?uddg=<enc>&… */
function unwrapDdg(href) {
  try {
    const u = new URL(href.startsWith("//") ? "https:" + href : href, "https://duckduckgo.com");
    const target = u.searchParams.get("uddg");
    return target ? decodeURIComponent(target) : href;
  } catch { return href; }
}

// Primary engine: DuckDuckGo HTML. Keyless, returns clean result blocks. Not
// stealthy — one polite request per query with a real browser UA.
async function searchDuckDuckGo(query, limit) {
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
  const blocks = html.split(/class="result(?:s_links|__body)?"/).slice(1);
  let m;
  while ((m = linkRe.exec(html)) && results.length < limit) {
    const url = unwrapDdg(m[1]);
    const title = decodeEntities(m[2]);
    if (!title || !/^https?:/i.test(url)) continue;
    // Grab the snippet that follows this link, if present.
    const after = html.slice(m.index, m.index + 1200);
    const sn = after.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/) ||
               after.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/div>/);
    results.push({ title, url, snippet: sn ? decodeEntities(sn[1]) : "" });
  }
  return results;
}

async function webSearch(query, limit = 6) {
  const q = String(query || "").trim();
  if (!q) throw new Error("a query is required");
  // Best-effort: try DuckDuckGo. (More keyless engines can be added here as
  // additional attempts; we deliberately do NOT try to bypass captchas.)
  const results = await searchDuckDuckGo(q, limit);
  return results;
}

const server = new Server(
  { name: "orbit-search", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "web_search",
      description:
        "Search the web and get a ranked list of results (title, URL, snippet). Use this to FIND pages for any question about the world — news, places, products, facts. Then open the most relevant URL(s) with the Lightpanda browser to read them. Best-effort and keyless: if it returns no results, say you couldn't find it — do NOT fall back to scraping search engines by hand or inventing an answer.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query." },
          limit: { type: "number", description: "Max results (default 6)." },
        },
        required: ["query"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    if (name === "web_search") {
      const results = await webSearch(args?.query, args?.limit || 6);
      if (!results.length) {
        return { content: [{ type: "text", text: `No results found for "${args?.query}". Tell the user you couldn't find it; do not invent an answer.` }] };
      }
      const text = results
        .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ""}`)
        .join("\n\n");
      return { content: [{ type: "text", text: `Search results for "${args.query}":\n\n${text}\n\nOpen the most relevant URL with the Lightpanda browser to read it.` }] };
    }
    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: `Error executing ${name}: ${error.message}. Web search is best-effort — if it keeps failing, tell the user you couldn't retrieve results rather than guessing.` }] };
  }
});

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Orbit Search MCP server running on stdio");
}

run().catch((error) => {
  console.error("Fatal error in Orbit Search MCP server:", error);
  process.exit(1);
});
