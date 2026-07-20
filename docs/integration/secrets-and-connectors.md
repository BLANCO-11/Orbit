# Secrets & connectors

The two pieces of one-time setup that back a run: credentials your generated
scripts read, and the datasource tool servers the agent can call. Both are
**tenant-scoped** — isolated to the tenant of your API key.

## Secrets

Datasource/tool credentials, encrypted at rest. They are injected into a run's
sandbox as **environment variables** and referenced elsewhere as `${secret:NAME}`
— the value never appears in the prompt, transcript, or logs.

### API

| Method | Endpoint | Notes |
|---|---|---|
| `GET` | `/api/secrets` | Lists **names + presence only**: `[{ name, hasValue, createdAt, updatedAt }]`. Never returns values. |
| `POST` | `/api/secrets` | `{ name, value }` (upsert). *member+*. |
| `DELETE` | `/api/secrets/:name` | Remove one. *member+*. |

**Rules:** `name` must be a valid env-var identifier (`[A-Za-z_][A-Za-z0-9_]*`);
`value` is a non-empty string ≤ 64 KiB. The POST response is
`{ secret: { name, hasValue: true } }` — it never echoes the value.

```bash
BASE=http://localhost:6800
curl -s -X POST "$BASE/api/secrets" -H "x-api-key: $KEY" \
  -H 'Content-Type: application/json' \
  -d '{"name":"ATTEND_TOKEN","value":"super-secret-value"}'
```

### How a secret reaches the script

At session spawn, **all** of the tenant's secrets are injected as env vars into
the sandbox (reserved provider/gateway/system names — `ORBIT_*`, `OPENAI_*`,
`PATH`, `HOME`, … — are protected so a secret can't hijack them). Then:

- In the **prompt**, tell the agent the variable name:
  *"the API token is in `$ATTEND_TOKEN`."*
- The generated script reads it: `os.environ["ATTEND_TOKEN"]` /
  `process.env.ATTEND_TOKEN`.
- In a **connector `env`**, reference `${secret:ATTEND_TOKEN}` (see below).

The value exists only in the sandbox env at run time. It is never written to the
stored prompt, the transcript, or the logs.

## Connectors (MCP tool servers)

Register the MCP servers that expose your datasources. A connector you add is
isolated to your tenant and composed into only your sessions' `.pi/mcp.json` at
spawn. Orbit's own servers (fleet/notify/search/…) and OAuth-wired providers are
**shared** and shown read-only.

### API

| Method | Endpoint | Notes |
|---|---|---|
| `GET` | `/api/connectors` | Shared connectors (`shared:true`) + your tenant's (`shared:false`). |
| `POST` | `/api/connectors` | Register/replace one of your connectors. *member+*. |
| `DELETE` | `/api/connectors/:name` | Remove one of your connectors. *member+*. |

Body — stdio or remote:

```jsonc
// stdio
{ "name": "my-datasource", "command": "node", "args": ["/path/to/server.js"],
  "env": { "PORT": "3015", "API_KEY": "${secret:MY_TOKEN}" } }

// remote (HTTP)
{ "name": "my-remote", "url": "https://mcp.example.com" }
```

`name` must be `[a-z0-9_-]`, ≤ 64 chars. `env` values may contain
`${secret:NAME}` references — stored verbatim and resolved from your secret store
into the sandbox at spawn (the plaintext never lands in config on disk).

```bash
curl -s -X POST "$BASE/api/connectors" -H "x-api-key: $KEY" \
  -H 'Content-Type: application/json' \
  -d '{"name":"watchlist","command":"node","args":["/srv/watchlist-mcp.js"],
       "env":{"DS_TOKEN":"${secret:ATTEND_TOKEN}"}}'
```

Inside a run, the agent calls the tool as `mcp_<connector>_<tool>` (e.g.
`mcp_watchlist_get_watchlist`).

## Isolation

A `member` of tenant A:

- `GET /api/secrets` and `GET /api/connectors` return only tenant A's own items;
- tenant B's sessions never get tenant A's connectors composed in, and cannot
  call them;
- a `${secret:X}` in tenant B's config resolves only against tenant B's
  secrets — an unknown name is left literal (never cross-tenant).

## Caveats

- **Container stdio connectors** with host-absolute `command` paths may not
  resolve inside the container sandbox (HTTP `url` connectors are unaffected).
- **OAuth-wired provider connectors** live in the global config and are shared
  across tenants (they're per-deployment).
- **Remote harnesses** run with their own `.pi` on their own box; tenant-scoped
  MCP composition does not extend to them.

Put it together in the [Examples](./examples.md).
