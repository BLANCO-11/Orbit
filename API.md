# Orbit Headless API & Protocol Specification

Orbit can run as a headless backend service (`agent-backend`), allowing third-party developers to build custom dashboards, command-line interfaces, or integrations.

---

## 1. Authentication, RBAC & CORS

By default, in development mode, the API binds to loopback (`127.0.0.1:6800`) and does not enforce authentication (dev-mode treats every caller as **superadmin** — ideal for a single-user / household deploy).

### Superadmin key
To lock Orbit down, set the `ORBIT_SUPERADMIN_KEY` environment variable on the backend:
```bash
export ORBIT_SUPERADMIN_KEY="your-secure-api-token"
```
When set:
- **REST requests** must include the token as `Authorization: Bearer <token>` **or** `x-api-key: <token>`.
- **WebSocket connections** must append it as a query parameter: `ws://localhost:6800/api/ws?key=<token>`.

(`ORBIT_API_KEY` and `AEGIS_API_KEY` are still accepted as fallbacks so older `.env` files keep working.)

### Credentials & roles (RBAC)
Any of these credentials authenticates a request; each resolves to a **role** and optional **tenant**:

| Credential | Role | Where it comes from |
|---|---|---|
| `ORBIT_SUPERADMIN_KEY` | `superadmin` | env — the single operator |
| Tenant **API key** (`orb_live_…`) | `admin` / `member` / `viewer` | minted in Admin › API Keys |
| **Session** token | user's role | issued after local (username+password) or OIDC sign-in |
| Paired **device token** | derived from device scope | Fleet pairing |

`GET /api/auth/whoami` returns the caller's `{ role, tenantId, email, ssoEnabled, ssoConfigured, devMode }`.

RBAC degrades gracefully: none of tenants/keys/SSO is required — they only matter once an operator creates them.

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

### Admin Console (RBAC, multi-tenancy, observability)
All under `/api/admin` and authenticated; each further gates on role. Superadmin sees all tenants; a tenant-admin is scoped to its own tenant.
- **`GET/POST /api/admin/tenants`**, **`PATCH/DELETE /api/admin/tenants/:id`** — tenant CRUD *(superadmin)*.
- **`GET /api/admin/keys`** — list API keys (scoped). **`POST /api/admin/keys`** `{ label, role, scope, tenantId? }` — mints a key; the raw secret (`key`) is returned **exactly once**. **`DELETE /api/admin/keys/:id`** — revoke.
- **`GET /api/admin/users`** — list SSO-provisioned users (scoped). **`PATCH /api/admin/users/:id`** `{ role }` — change a member's role.
- **`GET /api/admin/observability`** — usage aggregated from session metrics, bucketed by tenant, plus tenant/key/device counts.
- **`GET/PUT /api/admin/sso`** — read OIDC env presence + enable/disable SSO *(superadmin)*. The `PUT { enabled: true }` is rejected unless the OIDC env vars are present.

### Enterprise SSO (OIDC)
Authorization-Code + PKCE against any OIDC IdP (Entra/Azure AD, Okta, Google, Auth0, Keycloak). Secrets live only in env (`OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, …); the superadmin toggles it on in Admin › SSO.
- **`GET /api/auth/sso/status`** *(public)* — `{ enabled, configured }` for the login screen.
- **`GET /api/auth/sso/login`** *(public)* — redirects to the IdP.
- **`GET /api/auth/sso/callback`** *(public)* — verifies the `id_token`, provisions the user, mints an SSO session, and redirects to `<DASHBOARD_ORIGIN>/?ssoToken=…` (the SPA stores it as the request credential).
- **`POST /api/auth/local`** *(public)* — local account sign-in: `{ username, password }` → `{ token }` (a session token; the client stores it as its credential). The superadmin account is seeded at boot from `ORBIT_SUPERADMIN_USERNAME`/`ORBIT_SUPERADMIN_PASSWORD` (or a generated password printed to the log). This is separate from `ORBIT_SUPERADMIN_KEY`, which is the bearer credential for programmatic API access.
- **`POST /api/auth/logout`** *(public)* — revokes the presented session token.
- **`GET /api/auth/whoami`** *(authed)* — the caller's identity (see §1).

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
- **`GET /api/connectors`**: List registered MCP connectors and their available tools with their live status.
- **`POST /api/connectors`**: Register or update an MCP connector. Accepts a JSON body:
  ```json
  {
    "name": "my-mcp-server",
    "command": "node",
    "args": ["/path/to/server.js"],
    "env": { "PORT": "3015" },
    "url": ""
  }
  ```
- **`DELETE /api/connectors/:name`**: Unregister/delete an MCP connector by its name.
- **`GET /api/harnesses`**: List available runtimes/harnesses (local pi, OpenCode, paired remote fleet devices).
- **`GET /api/harnesses/:id/tools`**: Retrieve the tools available under a specific harness.

### Reusable Session Profiles
Named templates containing default agent runtime settings. A session can load a profile by specifying its `profileId` on `start_task`.
- **`GET /api/profiles`**: List all saved session profiles.
- **`POST /api/profiles`**: Create or update a session profile. Accepts a JSON body:
  ```json
  {
    "id": "optional-profile-id",
    "name": "Quick Chat",
    "description": "Fast answers, no tools",
    "harnessType": "picode",
    "mode": "chat",
    "effort": "fast",
    "promptId": "standard",
    "skills": [],
    "toolPolicy": { "excluded": [] },
    "sandbox": "host"
  }
  ```
- **`DELETE /api/profiles/:id`**: Delete a session profile by ID.

### Event Channels (Webhooks & Schedules)
Channels are inbound event triggers that run an agent profile headlessly and create an associated session.
- **`GET /api/channels`**: List all active trigger channels.
- **`POST /api/channels`**: Create or update a trigger channel. Accepts a JSON body:
  ```json
  {
    "id": "optional-channel-id",
    "name": "Git Push Alert",
    "type": "webhook",
    "profileId": "safe-edit",
    "promptTemplate": "A new push was made to Git. Payload info: {{body}}",
    "enabled": true,
    "verify": "github",
    "secret": "my-hmac-secret",
    "intervalMinutes": null,
    "dailyAt": null
  }
  ```
- **`DELETE /api/channels/:id`**: Delete a trigger channel.
- **`POST /api/channels/:id/test`**: Manually fire/test a channel trigger. Accepts a JSON payload body (e.g., `{"payload": {}}`).
- **`POST /api/channels/:id/webhook`**: The public, unauthenticated receiver endpoint for webhook triggers. Validates HMAC signatures (GitHub, Slack) or Bearer tokens per configuration settings.

### Prompt Library
Base system prompts compiled and fed to the agent at spawn time.
- **`GET /api/prompts`**: List all base system prompts in the library.
- **`GET /api/prompts/:id`**: Retrieve the full markdown content of a prompt.
- **`POST /api/prompts`**: Create or update a base system prompt. Accepts a JSON body:
  ```json
  {
    "id": "my-custom-prompt",
    "content": "# Persona\nYou are an operations coordinator..."
  }
  ```
- **`DELETE /api/prompts/:id`**: Delete a base prompt (protected defaults like `standard` and `orbit-system` cannot be deleted).

### Reusable Skills
Skills are reusable instruction manuals appended to system prompts.
- **`GET /api/skills`**: List all available skills.
- **`GET /api/skills/:id`**: Retrieve the full markdown body and frontmatter description of a skill.
- **`POST /api/skills`**: Create or update a skill. Accepts a JSON body:
  ```json
  {
    "id": "my-reusable-skill",
    "description": "Short summary",
    "body": "Markdown text content..."
  }
  ```
- **`DELETE /api/skills/:id`**: Delete a skill.

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
  "path": "/home/user/my-file.txt"
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

## 4. Harness Pairing & Protocol v1

A **harness** is any process that runs agent turns for the console (the local pi child, or a remote `orbit-adapter` dialing in from another machine). Pairing turns a short-lived code into a durable device token; the harness then holds an authenticated WebSocket open and services `spawn`/`prompt`/`cancel`. The same contract serves Orbit's own adapter and any third-party harness — they differ only in how they consume the descriptor below.

### A. Minting a code (operator-only)
- **`POST /api/pair/start`** (authenticated). Body: `{ label?, scope? }` where `scope ∈ {full, chat_voice, read_only}`. Returns:
  ```json
  {
    "success": true,
    "code": "ABC123",
    "expiresAt": 1737000000000,
    "scope": "full",
    "pairingUrl": "https://<dashboard-origin>/pair?code=ABC123",
    "connectUrl": "https://<public-origin>/api/pair/connect?code=ABC123",
    "bootstrapCommand": "curl -fsSL 'https://<public-origin>/api/pair/bootstrap?code=ABC123' | node"
  }
  ```
  The code is **6 chars, 5-minute TTL, single-use, scoped**. `connectUrl` / `bootstrapCommand` are built from the **public origin of the request** (honoring `x-forwarded-proto`), so they work off-box behind nginx.

### B. Redeeming a code (open, code-gated, rate-limited)
Each of these redeems the code **atomically and single-use** — a second consumer of the same code gets `410 { error: "code_expired" }`. All three are rate-limited per IP (20/min).

- **`GET /api/pair/connect?code=CODE`** → the **connection descriptor** (JSON), the single source of truth a harness needs:
  ```jsonc
  {
    "protocolVersion": "1",
    "wsUrl": "wss://<public-origin>/api/harness",
    "token": "…64-hex, returned once…",
    "device": { "id": "…", "label": "My workstation", "scope": "full" },
    "register": { "type": "register", "required": ["name", "machine", "capabilities"],
                  "capabilitiesExample": ["chat","plan","edit","yolo","subagents","tools"] },
    "heartbeat": { "intervalMs": 30000, "type": "ping" },
    "reconnect": { "backoffMs": [1000, 2000, 5000, 15000], "maxJitterMs": 500 }
  }
  ```
- **`GET /api/pair/bootstrap?code=CODE`** → a runnable Node installer (Orbit adapter): it persists the descriptor to `~/.orbit/adapter-credentials.json`, downloads the adapter, and launches it. Intended for `… | node`.
- **`POST /api/pair/redeem`** (body `{ code, label? }`) → `{ success, device: { id, label, token, scope } }`. The bare-token path for a harness that builds its own WS URL.

> **The raw token is returned exactly once**, at redemption, and only its SHA-256 hash is stored. It rides in the URL/body, so **HTTPS/WSS is mandatory** for any non-loopback use.

### C. Connecting (WebSocket)
The harness opens `wss://<host>/api/harness?token=<deviceToken>` and sends its first frame:
```json
{ "type": "register", "name": "My workstation", "machine": "host-1", "capabilities": ["chat","plan","edit","yolo","subagents","tools"] }
```
The server replies `{ "type": "registered", "harnessId": "remote-…" }`. A rejected/revoked token fails the upgrade with **HTTP 401**.

**Backend → harness:** `{ type: "spawn", sessionId, mode, systemPromptType, skills, model, excludeTools }`, `{ type: "prompt", sessionId, message }`, `{ type: "cancel", sessionId }`, `{ type: "disconnect", sessionId }`, `{ type: "list_tools", reqId }`.
**Harness → backend:** `{ type: "event", sessionId, event, data }` (relayed harness events), `{ type: "tools_list", reqId, tools }`.

### D. Staying connected
- **Heartbeat:** the harness sends WS `ping` frames every `heartbeat.intervalMs` to hold the socket through proxy idle timeouts; the server auto-pongs.
- **Reconnect:** on a dropped socket the harness retries with `reconnect.backoffMs` + up to `maxJitterMs` jitter, then re-`register`s (a fresh `harnessId`).
- **Restart:** the persisted token in `~/.orbit/adapter-credentials.json` (keyed by server host, chmod 600) lets a restarted harness reconnect with **no re-pairing** — the expired code is irrelevant.
- **Revocation:** `DELETE /api/devices/:id` marks the token revoked; the next WS upgrade returns 401 and the adapter drops its stored credential and exits "re-pair required."

`protocolVersion` is advisory today (best-effort); it is surfaced so future breaking changes to the register/event shape can be negotiated.

---

## 5. Stability & Versioning

The endpoints listed under `/api/sessions`, `/api/capabilities`, and `/api/config` represent the stable public surface of Orbit Backend v2. Custom frontends built against these structures are guaranteed to remain compatible across patch releases.
