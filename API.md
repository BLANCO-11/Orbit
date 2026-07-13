# Orbit Headless API & Protocol Specification

Orbit can run as a headless backend service (`agent-backend`), allowing third-party developers to build custom dashboards, command-line interfaces, or integrations.

---

## 1. Authentication & CORS

By default, in development mode, the API binds to loopback (`127.0.0.1:6800`) and does not enforce authentication.

### API Key Authentication
To secure Orbit, set the `ORBIT_API_KEY` environment variable on the backend:
```bash
export ORBIT_API_KEY="your-secure-api-token"
```
When set:
- **REST requests** must include the `Authorization` header: `Authorization: Bearer your-secure-api-token`
- **WebSocket connections** must append the token as a query parameter: `ws://localhost:6800/api/ws?key=your-secure-api-token`

### Cross-Origin Resource Sharing (CORS)
To allow a custom frontend domain to talk to the backend, set `DASHBOARD_ORIGIN`:
```bash
export DASHBOARD_ORIGIN="https://my-dashboard.com"
```

---

## 2. REST API Endpoints

All REST endpoints are prefixed with `/api`.

### Capabilities Manifest
- **Endpoint**: `GET /api/capabilities`
- **Description**: Returns a consolidated manifest of configured, connected, and available capabilities (LLM, TTS, Search, Browse, Telegram, connectors, fleet).
- **Response**:
  ```json
  {
    "success": true,
    "generatedAt": "2026-07-13T07:15:00.000Z",
    "capabilities": {
      "llm": { "configured": true, "connected": null, "detail": "model gemini-3.5-flash via litellm" },
      "web_search": { "configured": true, "connected": true, "detail": "orbit-search MCP" },
      "web_browse": { "configured": true, "connected": null, "detail": "Lightpanda browser enabled" },
      "telegram": { "configured": false, "connected": false, "detail": "no bot token" }
    }
  }
  ```

### Sessions Management
- **`GET /api/sessions`**: List all saved sessions (returns metadata and metrics seeds).
- **`GET /api/sessions/search?q=<query>`**: Search sessions containing text in title or messages.
- **`GET /api/sessions/:id`**: Retrieve the full state of a session (messages, plans, metrics, logs, runState, subagentTree).
- **`POST /api/sessions`**: Create or update a session.
- **`DELETE /api/sessions/:id`**: Delete a session and purge its workspace files.
- **`GET /api/sessions/export/all`**: Export all sessions as a downloadable JSON file.
- **`POST /api/sessions/import`**: Import an array of exported sessions.

### Settings & Configuration
- **`GET /api/config`**: Fetch the current `security-config.json` (HITL approval gates, allowed paths, budgets).
- **`POST /api/config`**: Update the `security-config.json`. Hot-reloaded on the next turn.
- **`GET /api/config/ui`**: Get UI visibility configuration.
- **`POST /api/config/ui`**: Set UI visibility configuration.

### Connectors & Harnesses
- **`GET /api/connectors`**: List registered MCP connectors and their available tools.
- **`GET /api/harnesses`**: List available runtimes/harnesses (local pi, OpenCode, paired remote fleet devices).

---

## 3. WebSocket Protocol (`/api/ws`)

The WebSocket server coordinates streaming agent tasks, tool executions, plan adjustments, and sub-agent events.

### A. Client Inbound Messages (Commands)

#### 1. Start Task
Runs the agent execution loop on a prompt.
```json
{
  "type": "start_task",
  "sessionId": "session-12345",
  "prompt": "Investigate quantum entanglement.",
  "mode": "plan",
  "effort": "balanced",
  "harnessId": "local",
  "systemPromptType": "standard",
  "excludeTools": []
}
```

#### 2. Cancel Task
Stops execution and terminates the running process tree.
```json
{
  "type": "cancel",
  "sessionId": "session-12345"
}
```

#### 3. Resume Task
Resumes a turn that was interrupted (e.g. after a process crash or restart).
```json
{
  "type": "resume",
  "sessionId": "session-12345"
}
```

#### 4. Mode Switch
Changes the active execution mode for the session.
```json
{
  "type": "mode_switch",
  "sessionId": "session-12345",
  "mode": "yolo"
}
```

#### 5. HITL Approval Response
Responds to a human-in-the-loop tool execution gate.
```json
{
  "type": "approval_response",
  "toolCallId": "call_abc123",
  "approved": true
}
```

#### 6. Filesystem Write Approval Response
Responds to a write restriction path gate.
```json
{
  "type": "edit_permission_response",
  "toolCallId": "call_xyz789",
  "decision": "allow",
  "path": "/home/blanco/my-file.txt"
}
```

---

### B. Server Outbound Messages (Events)

#### 1. Message Stream
Streams assistant responses, including markdown text and attached tool records.
```json
{
  "type": "message",
  "content": "I am looking into that now...",
  "status": "thinking"
}
```

#### 2. Tool Start
Emitted when a tool call begins execution.
```json
{
  "type": "tool_start",
  "toolCallId": "call_123",
  "name": "bash",
  "arguments": { "command": "ls -la" }
}
```

#### 3. Tool End
Emitted when a tool call completes.
```json
{
  "type": "tool_end",
  "toolCallId": "call_123",
  "status": "done",
  "result": "total 8\ndrwxr-xr-x...",
  "latencyMs": 142
}
```

#### 4. Plan State Update
Pushes updated session plans whenever mutated by the `orbit-plan` tool.
```json
{
  "type": "plan_state",
  "activePlanId": "default",
  "plans": [
    {
      "planId": "default",
      "title": "Quantum Research Plan",
      "type": "task",
      "steps": [
        { "id": "1", "text": "Scrape research papers", "status": "done", "deps": [] },
        { "id": "2", "text": "Draft report", "status": "active", "deps": ["1"] }
      ]
    }
  ]
}
```

#### 5. Usage Update
Streams live token usage, turn latency, and cost accumulations.
```json
{
  "type": "usage_update",
  "toolCalls": 3,
  "tokens": 4210,
  "tokensIn": 3120,
  "tokensOut": 1090,
  "cost": 0.0012,
  "latency": 3520
}
```

#### 6. Agent End
Emitted when the turn settles and the agent process halts.
```json
{
  "type": "agent_end",
  "sessionId": "session-12345",
  "status": "done"
}
```

---

## 4. Stability & Versioning

The endpoints listed under `/api/sessions`, `/api/capabilities`, and `/api/config` represent the stable public surface of Orbit Backend v2. Custom frontends built against these structures are guaranteed to remain compatible across patch releases.
