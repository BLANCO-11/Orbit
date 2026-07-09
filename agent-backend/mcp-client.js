const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
const path = require("path");

class LightpandaMcpClient {
  constructor() {
    this.client = null;
    this.transport = null;
  }

  async connect() {
    console.log("Initializing Lightpanda MCP client connection...");
    
    // Command to launch the MCP server child process
    const serverPath = path.join(__dirname, "../mcp-server-lightpanda/index.js");
    
    this.transport = new StdioClientTransport({
      command: "node",
      args: [serverPath],
      env: {
        ...process.env,
        LIGHTPANDA_WS: process.env.LIGHTPANDA_WS || "ws://127.0.0.1:9222"
      }
    });

    this.client = new Client(
      {
        name: "aegis-agent-backend",
        version: "1.0.0",
      },
      {
        capabilities: {}
      }
    );

    await this.client.connect(this.transport);
    console.log("Connected to Lightpanda MCP server successfully.");
  }

  async listTools() {
    if (!this.client) {
      throw new Error("MCP client is not connected.");
    }
    const response = await this.client.listTools();
    return response.tools || [];
  }

  async callTool(name, args) {
    if (!this.client) {
      throw new Error("MCP client is not connected.");
    }
    console.log(`Calling MCP tool: ${name} with arguments:`, args);
    const response = await this.client.callTool({
      name,
      arguments: args
    });
    return response;
  }

  async disconnect() {
    if (this.transport) {
      await this.transport.close();
      this.client = null;
      this.transport = null;
      console.log("Disconnected from Lightpanda MCP server.");
    }
  }
}

module.exports = LightpandaMcpClient;
