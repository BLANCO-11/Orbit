const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
const path = require("path");
const assert = require("assert");

async function testSearchMcpServer() {
  console.log("Starting Search MCP Server integration test...");

  const serverPath = path.join(__dirname, "../mcp-servers/search/index.js");
  const transport = new StdioClientTransport({
    command: "node",
    args: [serverPath],
  });

  const client = new Client(
    { name: "test-search-mcp-client", version: "1.0.0" },
    { capabilities: {} }
  );

  try {
    await client.connect(transport);
    console.log("Connected to Search MCP server.");

    const toolsRes = await client.listTools();
    const toolNames = toolsRes.tools.map((t) => t.name);
    console.log("Discovered Search MCP tools:", toolNames);

    assert(toolNames.includes("web_search"), "Should include web_search tool");
    assert(toolNames.includes("fetch_webpage"), "Should include fetch_webpage tool");
    assert(toolNames.includes("fetch_rss_news"), "Should include fetch_rss_news tool");
    assert(!toolNames.includes("search_wikipedia"), "Should NOT include search_wikipedia tool");

    console.log("Calling web_search tool...");
    const searchRes = await client.callTool({
      name: "web_search",
      arguments: { query: "OpenAI news", limit: 2 },
    });
    assert(searchRes.content && searchRes.content.length > 0, "web_search should return content");
    assert(!searchRes.isError, "web_search should not return error");

    console.log("Calling fetch_rss_news tool...");
    const rssRes = await client.callTool({
      name: "fetch_rss_news",
      arguments: {},
    });
    assert(rssRes.content && rssRes.content.length > 0, "fetch_rss_news should return content");

    console.log("All Search MCP integration tests passed successfully!");
  } catch (err) {
    console.error("Search MCP test failed:", err);
    process.exit(1);
  } finally {
    await client.close();
  }
}

testSearchMcpServer();
