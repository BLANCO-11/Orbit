# Configuration

Orbit reads configuration from two layers, and **env wins**:

1. **`.env`** (copy from [`.env.example`](../.env.example)) — LLM endpoint,
   ports, database, sandbox, access control. Values here override the config file
   at spawn time.
2. **Settings panel** (in-app) — models, TTS voice, security (allowed/blocked
   paths, approval gates), web access, budgets — persisted to
   `agent-backend/security-config.json` (gitignored).

> **Docker note:** Compose's `env_file` does **not** strip inline `# …`
> comments — keep comments on their own lines. Inside the container, `PORT`/`HOST`
> are forced by the entrypoint (backend `:6800`, dashboard `:6801`).

## Core

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `6800` | Backend REST + WS port (bare-metal only). |
| `HOST` | `127.0.0.1` | Bind host. Set off-loopback only behind a proxy — then a superadmin key is mandatory. |
| `DASHBOARD_ORIGIN` | `http://localhost:6801` | CORS + OIDC redirect base. |
| `ORBIT_PUBLIC_ORIGIN` | — | Public origin harnesses reach Orbit at (pins `wss://` for pairing behind TLS). |
| `ORBIT_HOME` | `~/.orbit` | Where per-session workspaces live (`/data/orbit-home` in Docker). |

## Access control (RBAC + multi-tenancy)

| Var | Purpose |
|---|---|
| `ORBIT_SUPERADMIN_KEY` | Superadmin **bearer** credential for the API/WS. **If set, auth is enforced.** Unset = loopback dev-mode (every caller is superadmin). |
| `ORBIT_SUPERADMIN_USERNAME` / `ORBIT_SUPERADMIN_PASSWORD` | Seed the browser sign-in account (separate from the key). A random password is generated + logged on first boot if unset. |
| `OIDC_*` | Enterprise SSO (issuer, client id/secret, redirect, scopes, admin emails, allowed domains). Toggle on from Admin › SSO once set. |

`ORBIT_API_KEY` / `AEGIS_API_KEY` are still read as fallbacks for the superadmin
key. Tenant-scoped API keys are minted from the Admin console, not env. See
[Authentication](./integration/authentication.md).

## LLM (required)

Any OpenAI-compatible `/v1` endpoint (OpenAI, Groq, OpenRouter, Together, Ollama,
vLLM, a LiteLLM proxy, …).

| Var | Purpose |
|---|---|
| `LLM_BASE_URL` | Upstream base URL. Leave blank if none yet (the UI prompts). |
| `LLM_API_KEY` | Upstream key. Held server-side; local agents never see it (they go through Orbit's internal `/llm/v1` gateway). |
| `LLM_MODEL` | Default model. |
| `ORBIT_GATEWAY_KEY` | App-local key agents use for the internal gateway. Auto-generated per boot if unset. |

Historical `LITELLM_*` / `OPENAI_*` names are read as fallbacks. Pick the actual
response/reasoning models in Settings › Models.

## Execution sandbox

| Var | Default | Purpose |
|---|---|---|
| `ORBIT_DEFAULT_SANDBOX` | `host` | Sandbox when a request/profile doesn't set one: `host` \| `container` \| `remote`. |
| `ORBIT_SANDBOX_IMAGE` | `nikolaik/python-nodejs:python3.12-nodejs22-slim` | Container image (ships python + node). |
| `ORBIT_SANDBOX_PULL` | `missing` | Docker pull policy: `missing` (pull once if absent) \| `never` (air-gapped) \| `always`. |
| `ORBIT_SANDBOX_NETWORK` | `host` | Docker network mode; non-`host` isolates net and publishes `host.docker.internal`. |
| `ORBIT_SANDBOX_PI_CONFIG_RO` | off | Mount host `~/.pi` read-only (protect pi auth). |

## Run API

| Var | Default | Purpose |
|---|---|---|
| `ORBIT_RUN_SANDBOX` | (falls back to `container`) | Sandbox for `/api/run` when the request/profile doesn't set one. Downgrades to `host` if Docker is unavailable. |
| `ORBIT_RUN_IDLE_MS` | `180000` | Idle watchdog: abort if the harness emits no events for this long (hang → `timeout`). |
| `ORBIT_RUN_MAX_MS` | `1200000` | Absolute backstop per run (~20 min). |
| `ORBIT_ASK_TIMEOUT_MS` | `600000` | How long the built-in `ask_questions` tool parks a run at `awaiting_input` before returning a "no answer" sentinel. The idle watchdog is suspended while waiting; the backstop still applies. |

See the [Run API](./integration/run-api.md).

## External build+test facility

The `orbit-build` `end_build` tool hands generated code to a **separate** test facility.

| Var | Default | Purpose |
|---|---|---|
| `ORBIT_TESTER_URL` | — | Facility base URL. Set → `end_build` submits artifacts to `<url>/grade` and merges the verdict into the contract's `build` block. Unset → handoff is inert (`skipped`). |
| `ORBIT_TESTER_KEY` | — | Bearer token sent to the facility. |

## Secrets encryption

| Var | Purpose |
|---|---|
| `ORBIT_SECRET` | Key for encrypting stored secrets + connection tokens (`crypto-store.js`). If unset, a random key is generated once and persisted to a gitignored file. **Pin it** to keep encrypted data readable across hosts/rebuilds. |

## Database

Two interchangeable backends, chosen at boot:

| Var | Purpose |
|---|---|
| `ORBIT_DB_DRIVER` | Force `sqlite` or `postgres`. Wins over everything. |
| `DATABASE_URL` | Postgres connection string. If set (and no `ORBIT_DB_DRIVER`), selects Postgres. |
| `ORBIT_DB_PATH` | SQLite file location (default `agent-backend/orbit.db`; Docker mounts a volume). |

Resolution: `ORBIT_DB_DRIVER` → else `DATABASE_URL` present → postgres → else
sqlite. Both drivers share one schema. Migrate SQLite→Postgres with
`agent-backend/scripts/migrate-sqlite-to-pg.js`.

## Optional integrations

| Area | Vars |
|---|---|
| Harness binaries | `PI_CLI_PATH`, `PI_NODE_PATH`, `OPENCODE_PATH` (auto-discovered on PATH). |
| Browser | `LIGHTPANDA_WS` (auto-started via Docker). |
| TTS / voice | `LOCAL_TTS_URL`, `LOCAL_TTS_KEY`, `LOCAL_TTS_MODEL`. |
| Web search | `EXA_API_KEY`, `PERPLEXITY_API_KEY`, `GEMINI_API_KEY` (Orbit also ships a keyless search MCP). |
| Telegram | `TELEGRAM_DISABLE=1` to disable the poller (bot token added via Connectors UI). |

## Policy & budgets (Settings panel)

Not env — set in the app and stored in `security-config.json`:

- Capability × mode matrix (allow / ask / block).
- Allowed paths + the consent-proof hard blocklist.
- Per-session cost / token / sub-agent-depth budgets (0 = unlimited).

See [Concepts › Policy](./concepts.md#policy--modes).
