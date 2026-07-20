# Orbit

**A local-first, harness-agnostic agent-operations console.** A Next.js dashboard talks over one WebSocket to an Express backend that drives a local CLI agent — a "harness" (pi, OpenCode, or a paired remote device) — and streams everything it does back for you to watch and steer: chat, reasoning, tool calls, sub-agents, tokens, and cost. It runs on your own machine, on your own model, within permission guardrails you control.

```
┌──────────────────────┐        WebSocket + REST         ┌───────────────────────────┐
│  Dashboard (Next.js)  │ ───────────────────────────────▶│   Backend (Express)        │
│  localhost:6801       │◀─────────  live stream  ────────│   localhost:6800 (loopback)│
└──────────────────────┘                                 └────────────┬──────────────┘
   chat · trace · mission                                              │ drives
   preview · policies · fleet                                          ▼
                                              ┌───────────────────────────────────────┐
                                              │  Harness (one per session)             │
                                              │   • pi   • OpenCode   • remote adapter  │
                                              └───────┬───────────────────────┬────────┘
                                                      │ tools                 │ MCP (stdio)
                                                      ▼                       ▼
                                     per-session workspace          orbit MCP servers:
                                     ~/.orbit/sessions/<id>/         lightpanda (browser),
                                       workspace · artifacts · tmp   search · notify · plan ·
                                                                     transcript · fleet
   State: PostgreSQL or SQLite (env-selected) · encrypted tokens · per-session file isolation
```

**How it fits together:** the backend owns sessions, metrics, and the capability×mode **policy** it enforces on every tool call. Each session spawns a harness with `cwd` = its own isolated workspace. Capabilities the agent reaches for (search, notify, plan, browser) are **MCP servers** Orbit auto-registers. A "lead" chat can delegate subtasks to other agents/devices (**Fleet**), and each delegate's activity streams back into the lead's Trace.

> **📖 Full documentation lives in [`docs/`](./docs/README.md)** — [getting started](./docs/getting-started.md), [concepts](./docs/concepts.md), [user guide](./docs/user-guide.md), [configuration](./docs/configuration.md), the [integration guide](./docs/integration/README.md) for driving Orbit from your own app, and [troubleshooting](./docs/troubleshooting.md). The endpoint + WebSocket protocol reference is [`API.md`](./API.md).

---

## Prerequisites

| Requirement | Why | Notes |
|---|---|---|
| **Node.js 22+** | SQLite driver uses the built-in `node:sqlite` | `node --version` ≥ 22 |
| **An OpenAI-compatible LLM endpoint** | the model the agent runs on | e.g. [LiteLLM](https://github.com/BerriAI/litellm) proxy, or any `/v1` endpoint |
| **`pi` CLI** | the default agent harness | install per pi's docs; auto-discovered on PATH |
| **Docker** *(recommended)* | the Lightpanda headless browser + the bundled PostgreSQL | auto-started on boot if present |
| **PostgreSQL** *(optional)* | the default DB in Docker; set `DATABASE_URL` | omit it and Orbit uses local SQLite with no config |
| **OpenCode** *(optional)* | a second harness | `npm i -g opencode-ai` |
| **A TTS server** *(optional)* | voice output | the voice UI only appears when configured |

It is **not** a pure pull-and-run: you need an LLM endpoint and the `pi` CLI. Everything else degrades gracefully (no Docker → no browser; no TTS creds → no voice UI).

## Quickstart

```bash
git clone https://github.com/BLANCO-11/Orbit.git
cd Orbit
npm install
npm --prefix dashboard install

cp .env.example .env          # set LLM_BASE_URL / LLM_API_KEY / LLM_MODEL
                              # (LITELLM_* / OPENAI_* also accepted as fallbacks;
                              #  or leave blank and configure in Settings after launch)

npm run dev                   # backend :6800 + dashboard :6801
# open http://localhost:6801
```

On first boot Orbit **seeds `agent-backend/security-config.json`** from the committed example (so it doesn't crash on a fresh clone) and **auto-starts the Lightpanda browser** container if Docker is available.

For a clean restart on the latest code (kills ports, rebuilds the dashboard, boots both):

```bash
./restart-orbit.sh
```

## Configuration

Two layers, and env wins:

- **`.env`** (see [`.env.example`](.env.example)) — LLM endpoint, ports, database, optional TTS/search/browser/Telegram. Values here override the config file at spawn time.
- **Settings panel** (in-app) — models, TTS voice, security (allowed/blocked paths, approval), web-access extension, budgets — persisted to `agent-backend/security-config.json` (gitignored, holds your key).

**Database** — Orbit runs on either **PostgreSQL** or **SQLite**, chosen at boot: set `ORBIT_DB_DRIVER` explicitly, else a `DATABASE_URL` selects Postgres, else it falls back to SQLite (`node:sqlite`) at `ORBIT_DB_PATH`. SQLite is the zero-config default for local/single-box; the Docker stack ships a Postgres service and defaults to it. Migrate an existing SQLite DB with `agent-backend/scripts/migrate-sqlite-to-pg.js` (see `.env.example`). Both drivers share one schema and the same app behavior.

**Permissions** are a capability × mode matrix (`chat`/`plan`/`edit`/`yolo` → allow/ask/block) enforced by the backend on every tool call, plus a consent-proof hard blocklist (your `~/.ssh`, Orbit's own source, etc.). Shell commands are tokenized so a blocklisted path can't slip through via redirects/subshells/unlisted tools. Each session writes only inside its own `~/.orbit/sessions/<id>/workspace`; anything outside asks first. For untrusted execution, set `ORBIT_DEFAULT_SANDBOX=container` to run agents in an ephemeral Docker sandbox by default. The container sandbox ships a python+node image (`ORBIT_SANDBOX_IMAGE`, pulled on first use — set `ORBIT_SANDBOX_PULL=never` for air-gapped hosts) and its network is on by default (`ORBIT_SANDBOX_NETWORK`). Run-API executions are bounded by an idle watchdog and an absolute backstop (`ORBIT_RUN_IDLE_MS`, `ORBIT_RUN_MAX_MS`) so a hung task always terminates.

## Features

- **Unified console** — icon rail (Console / Fleet / Connectors / Policies / Admin / Settings); chat, per-turn reasoning, tools, and sub-agents in one stream; inspector tabs Overview · Preview · Console · Workspace · Trace · Logs.
- **Admin & multi-tenancy** *(optional)* — an Admin console for tenants, tenant-scoped API keys, roles (superadmin/admin/member/viewer), per-tenant observability, and an enterprise **OIDC SSO** toggle. Degrades gracefully: a single-user/household deploy needs none of it.
- **Real observability** — provider-reported tokens (not estimates) + directional cost, per-turn ledger, and a **Trace** giving every sub-agent its own task, tool calls, and tokens.
- **Mission board** — the agent's structured plan (via the `orbit-plan` tool) as a live checklist with dependencies.
- **Enforced policy + budgets** — capability×mode matrix, per-device tighten-only overrides, per-session cost/token/sub-agent-depth caps.
- **Per-session isolation** — each session runs in its own workspace; host by default, or an ephemeral Docker sandbox for untrusted execution.
- **Multi-agent (Fleet)** — one chat delegates subtasks to pi, OpenCode, or paired remote devices; delegates inherit the lead's rights (capped) and their activity streams back to the lead's Trace.
- **Capabilities as MCP servers** — Lightpanda browser, keyless web search, YouTube transcripts, notify (in-app + Telegram + webhooks), plan, fleet — all auto-registered.
- **Prompt library + skills** — swap the system prompt and attach `skills/*/SKILL.md` packs per session; inherited by sub-agents.
- **Channels** — trigger a saved profile unattended on a schedule or a verified webhook (GitHub/Slack HMAC).
- **Run API** — a parent app submits a task with only its API key and polls back a typed, schema-validated **result contract** (status + artifacts + smoke-test results + usage); runs are versioned per session, execute in a network-on sandbox with layered timeouts, and always reach a terminal status. Tenant-scoped **secrets** (env-injected, never in the transcript) and **connectors** back the flow.
- **Voice** *(optional)* — STT in, streamed TTS out with barge-in, shown only when a TTS backend is configured.

## Project layout

```
agent-backend/        Express backend, harnesses, policy engine, MCP registry
  db.js  db/adapter.js dual-driver data layer (PostgreSQL / SQLite), async
  scripts/            migrate-sqlite-to-pg.js (one-time data migration)
  harnesses/          picode (pi), opencode, container, remote — one HarnessInterface
  routes/ ws/         REST + WebSocket
  workspace-paths.js  per-session ~/.orbit/sessions/<id> layout
dashboard/            Next.js console (src/app, components, hooks, providers)
mcp-servers/          External capability MCP servers (lightpanda, search, transcript)
agent-backend/mcp/    Native platform tool shims (fleet, notify) over the backend's own features
prompts/  skills/     system prompts + reusable instruction packs
restart-orbit.sh      clean rebuild + boot
```

## Scripts

```bash
npm run dev        # backend + dashboard (hot reload)
npm run build      # build the dashboard
npm start          # build + run both (production)
npm run verify     # typecheck + production build
npm test           # policy-hardening + DB-adapter tests

# DB layer test — SQLite by default; add DATABASE_URL to test Postgres:
node tests/test_db_layer.js
DATABASE_URL=postgres://orbit:orbit@localhost:5432/orbit_test node tests/test_db_layer.js
```

## Docker

One image runs the backend + dashboard; `pi` (the agent harness) and its extensions
are **baked into the image** — no host mount needed. Lightpanda (browser) and
**PostgreSQL** run as sibling services. Copy `.env.example` → `.env` and fill it in first.

```bash
# prod (slim built image)
docker compose up -d --build

# dev (HMR, source bind-mounted) — include BOTH files
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

- Only **`6801`** (dashboard) is published by default; it proxies `/api` + `/api/ws`
  to the backend. `6800` is also published so an external nginx can hit the backend
  directly — firewall it to the proxy host, or remove it and point nginx `/api` at `6801`.
- The entrypoint **forces** ports in-container (backend `6800`, dashboard `6801`);
  `PORT`/`HOST` from `.env` are ignored there.
- `docker compose` `env_file` does **not** strip inline `# comments` — keep comments
  on their own lines in `.env`.
- **PostgreSQL** is the default DB: the `postgres` service holds the data (on the
  `orbit-pgdata` volume) and the app waits for it via a healthcheck. To use SQLite
  instead, comment out `DATABASE_URL` on the `orbit` service (or set
  `ORBIT_DB_DRIVER=sqlite`); it then persists at `ORBIT_DB_PATH` on `orbit-data`.
  Override `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` in `.env` for a real
  deploy (and keep `DATABASE_URL` in sync).
- Session workspaces persist on the `orbit-data` volume (`ORBIT_HOME`).
- The container reaches **host-run services** (a host LiteLLM, TTS, etc.) via
  `host.docker.internal` (mapped through `extra_hosts`) — e.g.
  `LLM_BASE_URL=http://host.docker.internal:5000`.

## Remote harnesses (bring your own agent)

Any machine can join Orbit as a harness. In **Fleet → Pair a device** you get a
one-liner (`curl -fsSL '<origin>/api/pair/bootstrap?code=…' | node`) — or hand an
agent the **`agentUrl`** and let it self-connect. A tiny zero-dependency connector
(`agent-backend/adapter/orbit-connect.js`) pairs, then Orbit drives that machine
exactly like the local harness (spawn/prompt/cancel, streamed events, central
policy). Orbit supplies the **plan/context**; the remote runs its **own** agent
with its **own** model and tools — Orbit never provides inference.

The connector is **agent-agnostic**: it auto-detects an installed agent on `PATH`
and translates its native protocol to Orbit's events via a per-agent adapter:

| Agent | Mode | Fidelity |
|---|---|---|
| **pi** | `pi --mode rpc` (persistent) | rich: text, tool calls, sub-agents, usage |
| **Claude Code** | `claude -p --output-format stream-json` (persistent) | rich: text, tool calls, usage |
| **OpenCode / Codex / Gemini CLI / Aider** | headless per-turn | text output streamed back |
| **custom** | `ORBIT_AGENT_CMD` (+ optional `ORBIT_AGENT_ARGS` with `{prompt}`) | text — drive any other agent |
| **generic** | built-in OpenAI tool loop | forced only (`ORBIT_CONNECT_AGENT=generic`), needs `OPENAI_*` |

Force a specific one with `ORBIT_CONNECT_AGENT=<pi|claude|opencode|codex|gemini|aider|custom|generic>`.
A box with no recognized agent won't connect (it isn't a harness). Adapter flags
for third-party agents are best-effort and version-sensitive — if one drifts, use
`ORBIT_AGENT_CMD` to point at the exact command. The connector probes `pi --help`
and only uses flags that version supports, and passes large system prompts via a
file (`--append-system-prompt`) so it doesn't overflow the Windows command line.

**A remote agent is a full first-class harness — on its own machine:**

- **Isolated workspace, on the remote.** Each session runs in
  `~/.orbit/workspaces/<sessionId>` on the *remote* box; the local host's sessions
  live in `~/.orbit/sessions/<sessionId>/`. Both keyed by session id.
- **File explorer (read-only).** The dashboard Explorer shows the *selected*
  agent's workspace — local reads the host FS, remote fetches over the connector
  socket on demand (list/read, sandboxed), VS-Code-style, no sync.
- **Operator console → the agent's runtime.** The Console runs your commands where
  the agent runs — the Orbit host for a local agent, the remote machine for a
  remote one (routed over the connector, correct shell per OS). It shows the
  machine + OS it's on.
- **OS + LLM in Fleet.** Fleet groups agents under their paired **device** (one
  laptop = one device, even with several agents) and shows each device's OS
  (Linux/Windows/macOS), online state, and each agent's model/provider.
- **Orbit MCP tools work.** The connector hands the agent `ORBIT_API` +
  `ORBIT_API_KEY` (the device token) + `ORBIT_SESSION_ID`, so the agent's Orbit
  MCP tools (fleet/notify) authenticate back to Orbit as that device.

**Keep it running (it's a daemon).** The connection lives only while the connector
process is alive; a dropped socket auto-reconnects (backoff + the persisted device
token — no new code). Run it **detached** (see `…/api/pair/agent` for the exact
per-OS commands), and for reboot survival install it as a service that runs the
saved `node ~/.orbit/orbit-connect.js` (the single-use bootstrap code can't be the
restart command). The token is durable until the operator **revokes** the device.

## Reverse proxy (TLS + WebSocket harness)

Orbit uses **WebSockets** on two paths — `/api/ws` (dashboard) and `/api/harness`
(remote agent harnesses that pair in via `curl … | node`). Any proxy in front of
Orbit must therefore:

1. **Upgrade WebSockets** on `/api/` (HTTP/1.1 + `Upgrade`/`Connection` headers).
2. **Send the public scheme in `X-Forwarded-Proto`.** Orbit builds the harness
   connection descriptor's URL (`ws://` vs **`wss://`**) from this header. If a
   TLS-terminating proxy forwards `X-Forwarded-Proto: http` (e.g. it uses its own
   internal `$scheme`), the harness dials plaintext `ws://`, hits the http→https
   redirect, and the upgrade fails with **`Received network error or non-101
   status code`**. This is the #1 cause of "paired but the harness won't connect."
3. Use **long read timeouts** and **disable response buffering** for streaming.

> **Bulletproof fallback:** if you can't trust the proxy chain to set
> `X-Forwarded-Proto` correctly (chained proxies, Cloudflare Tunnel, …), pin the
> public origin on the backend: `ORBIT_PUBLIC_ORIGIN=https://orbit.example.com`.
> Orbit then always emits `wss://orbit.example.com/api/harness` and ignores the
> request headers entirely.

**Verify the harness WS path end-to-end** (expect `HTTP/1.1 401` — the upgrade
reached Orbit and it rejected the fake token; a `200`/`404`/`502`/`301` means the
proxy isn't upgrading):

```bash
curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" -H "Sec-WebSocket-Version: 13" \
  'https://orbit.example.com/api/harness?token=probe'
```

### nginx

```nginx
map $http_upgrade $connection_upgrade { default upgrade; '' close; }

server {
    listen 443 ssl;                       # (or behind another TLS terminator)
    server_name orbit.example.com;
    # ssl_certificate / ssl_certificate_key ...

    location /api/ {                      # REST + /api/ws + /api/harness
        proxy_pass http://127.0.0.1:6800;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;   # ← the public scheme, NOT $scheme
        proxy_read_timeout 3600s; proxy_send_timeout 3600s; proxy_buffering off;
    }
    location / { proxy_pass http://127.0.0.1:6801; }   # dashboard UI
}
```

> If Orbit sits behind **another** TLS terminator (so this nginx listens on plain
> HTTP), hardcoding `X-Forwarded-Proto https` is correct because the *public* entry
> is https. To instead trust the outer proxy's value:
> `map $http_x_forwarded_proto $fwd { default $http_x_forwarded_proto; '' $scheme; }`
> then `proxy_set_header X-Forwarded-Proto $fwd;`.

### Caddy

Caddy proxies WebSockets and sets `X-Forwarded-Proto` correctly out of the box:

```caddy
orbit.example.com {
    handle /api/* { reverse_proxy 127.0.0.1:6800 }
    handle       { reverse_proxy 127.0.0.1:6801 }
}
```

### Traefik (labels)

```yaml
labels:
  - "traefik.http.routers.orbit-api.rule=Host(`orbit.example.com`) && PathPrefix(`/api`)"
  - "traefik.http.services.orbit-api.loadbalancer.server.port=6800"
  - "traefik.http.routers.orbit-ui.rule=Host(`orbit.example.com`)"
  - "traefik.http.services.orbit-ui.loadbalancer.server.port=6801"
```

Traefik auto-detects WebSocket upgrades and forwards `X-Forwarded-Proto`; no extra
config needed.

### Cloudflare

- **Proxied DNS (orange cloud):** WebSockets are on by default and `X-Forwarded-Proto`
  is set — nothing special beyond pointing at your origin.
- **Cloudflare Tunnel (`cloudflared`):** WS works, but the origin service is
  reached over http and the forwarded scheme can be unreliable. Set
  `ORBIT_PUBLIC_ORIGIN=https://orbit.example.com` on the backend so the descriptor
  is always `wss://`.

### OpenShift / Kubernetes routes

Routes support WebSockets by default (edge/passthrough TLS). If Orbit is behind an
in-cluster nginx too, apply the nginx block above and make sure **both** layers
upgrade WS and preserve the https scheme. When in doubt, set `ORBIT_PUBLIC_ORIGIN`.

## Branching

- **`main`** — stable, releasable. Protect it; merge via PR.
- **`develop`** *(optional)* — integration branch if you want a staging line.
- **`feature/*`**, **`fix/*`** — one branch per change, PR into `main` (or `develop`).

Never commit `.env`, `agent-backend/security-config.json`, or `agent-backend/.orbit-secret` — they're gitignored and hold secrets. `security-config.example.json` is the safe, committed template.

## Orbit as a Headless Backend

Orbit can be run as a headless backend service (`agent-backend`). This allows third-party developers to connect their own dashboards, voice control suites, or external scripts.

**Parent-app run flow.** With only its Orbit API key, an external app can drive an agent end-to-end and read a typed result:

1. `POST /api/secrets` — stash datasource/tool credentials (encrypted, tenant-scoped).
2. `POST /api/connectors` — register datasource MCP servers (isolated to the caller's tenant).
3. `POST /api/run` `{ prompt }` — submit the task → `{ runId, sessionId, seq }`.
4. `GET /api/run/:runId` — poll → the **result contract** (status + artifacts + tests + usage).
5. `GET /api/workspace/file?session=<sessionId>&path=<primaryArtifact.path>` — fetch the generated script.

Secrets are injected into the sandbox as env vars (referenced as `${secret:NAME}`), never appearing in the prompt or transcript; connectors are composed per-session and never leak across tenants. See the [API Specification Guide](./API.md) for the run/secrets/connectors endpoints and the contract schema.

For detailed request/response structures, WebSocket event protocols, authentication, and stability notes, refer to the [API Specification Guide](./API.md).

## Security notes

- The backend binds to `127.0.0.1` only. Set `ORBIT_SUPERADMIN_KEY` (formerly `ORBIT_API_KEY`, still accepted as a fallback) before exposing it beyond loopback — otherwise it runs in dev-mode, treating every caller as superadmin. For multi-user deployments, mint tenant-scoped API keys or enable OIDC SSO from the Admin console rather than sharing the superadmin key.
- The agent runs real commands on your machine within the policy matrix — review Policies/Settings before granting `edit`/`yolo`, and use the container sandbox for untrusted work.
- Tokens for connected services are encrypted at rest (`crypto-store.js`).
