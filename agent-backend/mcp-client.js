const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
const path = require("path");

class LightpandaMcpClient {
  constructor() {
    this.client = null;
    this.transport = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.baseDelay = 1000;
    this.maxDelay = 30000;
  }

  async connect() {
    try {
      console.log("Initializing Lightpanda MCP client connection...");
      
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
        { name: "aegis-agent-backend", version: "1.0.0" },
        { capabilities: {} }
      );

      await this.client.connect(this.transport);
      this.reconnectAttempts = 0;
      console.log("Connected to Lightpanda MCP server successfully.");
    } catch (err) {
      console.error("Failed to connect to Lightpanda MCP server:", err.message);
      this._scheduleReconnect();
    }
  }

  _scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("[MCP] Max reconnect attempts reached. Giving up.");
      return;
    }
    const delay = Math.min(this.baseDelay * Math.pow(2, this.reconnectAttempts), this.maxDelay);
    this.reconnectAttempts++;
    console.log(`[MCP] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
    setTimeout(() => this.connect(), delay);
  }

  async healthCheck() {
    if (!this.client) return false;
    try {
      await this.client.ping();
      return true;
    } catch {
      return false;
    }
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
