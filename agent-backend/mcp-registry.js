// agent-backend/mcp-registry.js
// MCP connector registry — the single source of truth for which MCP tool
// servers the agent can reach. The agent (pi) reads these from .pi/mcp.json at
// spawn time; this module owns that file (add/remove/list) AND maintains a
// backend-side client to each server so the dashboard can show live status and
// the available tool list without waiting for a session to spawn.
//
// Two transports: local stdio ({ command, args, env }) and remote HTTP
// ({ url }). A connector added here is available to the next spawned session.

const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
const fs = require("fs");
const path = require("path");

const MCP_CONFIG_PATH = path.join(__dirname, "../.pi/mcp.json");
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

function readConfig() {
  try {
    const raw = fs.readFileSync(MCP_CONFIG_PATH, "utf-8");
    const cfg = JSON.parse(raw);
    if (!cfg.mcpServers || typeof cfg.mcpServers !== "object") cfg.mcpServers = {};
    return cfg;
  } catch {
    return { settings: { toolPrefix: "mcp" }, mcpServers: {} };
  }
}

function writeConfig(cfg) {
  fs.mkdirSync(path.dirname(MCP_CONFIG_PATH), { recursive: true });
  fs.writeFileSync(MCP_CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf-8");
}

/** One backend-side client per configured server, kept for status + tool listing. */
class McpRegistry {
  constructor() {
    /** Map<name, { client, transport, status, tools, error }> */
    this._conns = new Map();
  }

  /** Connect (or reconnect) a backend client to one server definition. */
  async _connectOne(name, def) {
    // Tear down any prior connection for this name first.
    await this._disconnectOne(name);

    const entry = { client: null, transport: null, status: "connecting", tools: [], error: null };
    this._conns.set(name, entry);

    try {
      let transport;
      if (def.url) {
        transport = new StreamableHTTPClientTransport(new URL(def.url));
      } else if (def.command) {
        transport = new StdioClientTransport({
          command: def.command,
          args: def.args || [],
          env: { ...process.env, ...(def.env || {}) },
        });
      } else {
        throw new Error("connector needs either a command (stdio) or url (remote)");
      }

      const client = new Client({ name: "orbit-registry", version: "1.0.0" }, { capabilities: {} });
      await client.connect(transport);
      const listed = await client.listTools();

      entry.client = client;
      entry.transport = transport;
      entry.tools = (listed.tools || []).map((t) => ({ name: t.name, description: t.description || "" }));
      entry.status = "connected";
      entry.error = null;
    } catch (err) {
      entry.status = "error";
      entry.error = err.message;
    }
    return entry;
  }

  async _disconnectOne(name) {
    const entry = this._conns.get(name);
    if (entry?.transport) {
      try { await entry.transport.close(); } catch {}
    }
    this._conns.delete(name);
  }

  /** Connect backend clients to every server in .pi/mcp.json. Best-effort. */
  async connectAll() {
    const { mcpServers } = readConfig();
    await Promise.all(
      Object.entries(mcpServers).map(([name, def]) => this._connectOne(name, def).catch(() => {}))
    );
  }

  /** List connectors: the config definition merged with live backend status. */
  list() {
    const { mcpServers } = readConfig();
    return Object.entries(mcpServers).map(([name, def]) => {
      const conn = this._conns.get(name);
      return {
        name,
        transport: def.url ? "remote" : "stdio",
        target: def.url || `${def.command} ${(def.args || []).join(" ")}`.trim(),
        status: conn?.status || "unknown",
        tools: conn?.tools || [],
        error: conn?.error || null,
      };
    });
  }

  /** Add or replace a connector, persist to .pi/mcp.json, connect a client. */
  async add(name, def) {
    if (!NAME_RE.test(name)) throw new Error("connector name must be [a-z0-9_-], max 64 chars");
    if (!def || (!def.command && !def.url)) throw new Error("connector needs a command or url");
    const cfg = readConfig();
    cfg.mcpServers[name] = def.url
      ? { url: def.url, transport: "http", lifecycle: "eager" }
      : { command: def.command, args: def.args || [], transport: "stdio", lifecycle: "eager", env: def.env || {} };
    writeConfig(cfg);
    await this._connectOne(name, cfg.mcpServers[name]).catch(() => {});
    return this.list();
  }

  /** Remove a connector from .pi/mcp.json and disconnect its backend client. */
  async remove(name) {
    const cfg = readConfig();
    if (cfg.mcpServers[name]) {
      delete cfg.mcpServers[name];
      writeConfig(cfg);
    }
    await this._disconnectOne(name);
    return this.list();
  }

  async disconnectAll() {
    await Promise.all([...this._conns.keys()].map((n) => this._disconnectOne(n)));
  }
}

module.exports = { McpRegistry, readConfig, MCP_CONFIG_PATH };
