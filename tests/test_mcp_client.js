const LightpandaMcpClient = require("../agent-backend/mcp-client");
const assert = require("assert");

async function testMcpClient() {
  console.log("Starting MCP Client integration test...");
  const client = new LightpandaMcpClient();

  try {
    await client.connect();

    console.log("Listing tools from Lightpanda MCP server...");
    const tools = await client.listTools();
    console.log(`Discovered ${tools.length} tools:`, tools.map(t => t.name));
    
    assert(tools.length > 0, "Should discover tools");
    const toolNames = tools.map(t => t.name);
    assert(toolNames.includes("browser_navigate"), "Should support browser_navigate");
    assert(toolNames.includes("browser_get_content"), "Should support browser_get_content");

    console.log("Navigating to https://example.com via MCP server...");
    const navResult = await client.callTool("browser_navigate", { url: "https://example.com" });
    console.log("Navigation Result:", JSON.stringify(navResult, null, 2));

    console.log("Getting page content via MCP server...");
    const contentResult = await client.callTool("browser_get_content", {});
    console.log("Content Result (Truncated):", contentResult.content[0].text.substring(0, 300) + "...");

    console.log("All MCP client integration tests passed successfully!");
  } catch (error) {
    console.error("Test failed with error:", error);
    process.exit(1);
  } finally {
    console.log("Disconnecting client...");
    await client.disconnect();
  }
}

testMcpClient();
