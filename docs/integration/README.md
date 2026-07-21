# Integration guide — driving Orbit from your app

Orbit's backend is a headless service. An external **parent app** can, with only
an Orbit API key, register its datasources, submit a task, and read back a typed
result — without a browser or the dashboard.

- [Authentication & tenants](./authentication.md)
- [Run API & the result contract](./run-api.md)
- [Secrets & connectors](./secrets-and-connectors.md)
- [End-to-end examples (curl / Python / Node)](./examples.md)

For the exhaustive endpoint + WebSocket protocol reference, see
[`../../API.md`](../../API.md).

## Base URL & auth

- **Backend API:** `http://<host>:6800` (REST + WebSocket). The dashboard on
  `:6801` proxies `/api`, so it works too.
- **Auth:** send your key as `x-api-key: <key>` or `Authorization: Bearer <key>`.
  WebSocket takes it as a query param: `ws://<host>:6800/api/ws?key=<key>`.

If no `ORBIT_SUPERADMIN_KEY` is configured, Orbit runs in loopback **dev-mode**
(every caller is superadmin) — handy for local prototyping. Set the key before
exposing Orbit or going multi-tenant.

## The parent-app flow

The headline use case: your app hands Orbit a task and gets back a runnable,
smoke-tested artifact plus a machine-readable verdict.

```
 ┌─ your app ────────────────────────────────────────────────────────┐
 │                                                                    │
 │  1. POST /api/secrets      stash datasource/tool creds (encrypted) │
 │  2. POST /api/connectors   register datasource MCP servers          │
 │  3. POST /api/run          submit the task  ──►  { runId, ... }     │
 │  4. GET  /api/run/:runId   poll  ──►  result contract (typed)       │
 │  5. GET  /api/workspace/file?session=…&path=…   fetch the script    │
 │                                                                    │
 └────────────────────────────────────────────────────────────────────┘
```

Everything is scoped to the tenant of your API key:

- **Secrets** are injected into the run's sandbox as environment variables and
  referenced as `${secret:NAME}` — they never appear in the prompt, transcript,
  or logs.
- **Connectors** (MCP tool servers) are composed into only your tenant's
  sessions; another tenant never sees or can call them.
- **Runs** are versioned per session, execute in a network-on sandbox with
  layered timeouts, and always reach a terminal status.
- **Sessions, templates, and the fleet** (paired devices / remote harnesses) are
  tenant-scoped too; sessions are additionally owner-private within a tenant (a
  signed-in user sees only its own; a tenant admin sees all).

Steps 1–2 are **one-time setup** per datasource; steps 3–5 repeat per task.

## REST vs WebSocket

- **REST (this guide)** — best for "submit a task, get a result." Async:
  `POST /api/run` then poll `GET /api/run/:id`. Simple, stateless, language-
  agnostic. Use this for automation and server-to-server integration.
- **WebSocket (`/api/ws`)** — best for interactive UIs that need the live token
  stream, tool events, and plan updates. See the protocol in
  [`../../API.md`](../../API.md#3-websocket-protocol-apiws).

Most integrations want REST. Reach for the WebSocket only when you're building
something that renders live agent activity.

## What a run produces

A run leaves files in the session's `artifacts/` directory and returns a
**result contract**: status, a one-line summary, the primary artifact, the full
artifact listing, the agent's self-reported smoke-test results, token/cost usage,
and validation metadata. Your app acts on the contract; it never parses the
transcript. See [Run API](./run-api.md).
