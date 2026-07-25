# Configuration

Tether reads configuration from two layers, and **env wins**:

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
| `APP_PUBLIC_ORIGIN` | — | Public origin harnesses reach Tether at (pins `wss://` for pairing behind TLS). |
| `APP_HOME` | `~/.tether` | Where per-session workspaces live (`/data/tether-home` in Docker). |

## Access control (RBAC + multi-tenancy)

| Var | Purpose |
|---|---|
| `AUTH_SUPERADMIN_KEY` | Superadmin **bearer** credential for the API/WS. **If set, auth is enforced.** Unset = loopback dev-mode (every caller is superadmin). |
| `AUTH_SUPERADMIN_USERNAME` / `AUTH_SUPERADMIN_PASSWORD` | Seed the browser sign-in account (separate from the key). A random password is generated + logged on first boot if unset. |
| `OIDC_*` | Enterprise SSO (issuer, client id/secret, redirect, scopes, admin emails, allowed domains). Toggle on from Admin › SSO once set. |

`AUTH_SUPERADMIN_KEY` is the only name read for the superadmin
key. Tenant-scoped API keys are minted from the Admin console, not env. See
[Authentication](./integration/authentication.md).

## LLM (required)

Any OpenAI-compatible `/v1` endpoint (OpenAI, Groq, OpenRouter, Together, Ollama,
vLLM, a LiteLLM proxy, …).

| Var | Purpose |
|---|---|
| `LLM_BASE_URL` | Upstream base URL. Leave blank if none yet (the UI prompts). |
| `LLM_API_KEY` | Upstream key. Held server-side; local agents never see it (they go through Tether's internal `/llm/v1` gateway). |
| `LLM_FAST_MODEL` | Default model for the fast/balanced effort tiers. |
| `GATEWAY_KEY` | App-local key agents use for the internal gateway. Auto-generated per boot if unset. |
| `LLM_REASONING_MODEL` | Reasoning/plan model. No hardcoded provider default — falls back to `LLM_FAST_MODEL`. Used for `deep`-effort reasoning and by the pre-plan generator if it is re-enabled (see note below). |
| `LLM_CONFIG_LOCKED` | Invert precedence: env wins over Settings and the LLM fields render read-only. Off by default. |

These four `LLM_*` names are the app's **onboarding defaults**: on a fresh install
the Settings fields arrive pre-filled from them. A value saved in Settings sits
**above** env; clearing a field falls back to the env value rather than to nothing.

The historical `LITELLM_*` / `OPENAI_*` aliases were **removed**. `OPENAI_*` in
particular meant two contradictory things — the app's own upstream *and* a
spawned agent's credentials — which forced the harness to explicitly delete them
from the child environment to stop the real key leaking. A stale name now fails
at boot with its replacement (`node scripts/migrate-env.js .env`).

> **Planning:** the agent surfaces its own plan via the **Mission board**
> (`plans/*.md`, streamed as `plan_state`); the separate pre-plan LLM call is **off by
> default** (it never fed generation — it only populated a UI preview — and added a full
> round-trip). `LLM_REASONING_MODEL` / `LLM_PLAN_MAX_TOKENS` / `LLM_PLAN_TIMEOUT_MS`
> bound that call for deployments that re-enable it.

## Execution sandbox

| Var | Default | Purpose |
|---|---|---|
| `SANDBOX_DEFAULT` | `host` | Sandbox when a request/profile doesn't set one: `host` \| `container` \| `remote`. |
| `SANDBOX_IMAGE` | `nikolaik/python-nodejs:python3.12-nodejs22-slim` | Container image (ships python + node). |
| `SANDBOX_PULL` | `missing` | Docker pull policy: `missing` (pull once if absent) \| `never` (air-gapped) \| `always`. |
| `SANDBOX_NETWORK` | `host` | Docker network mode; non-`host` isolates net and publishes `host.docker.internal`. |
| `SANDBOX_HARNESS_CONFIG_RO` | off | Mount host `~/.pi` read-only (protect pi auth). |

## Run API

| Var | Default | Purpose |
|---|---|---|
| `RUN_SANDBOX` | (falls back to `container`) | Sandbox for `/api/run` when the request/profile doesn't set one. Downgrades to `host` if Docker is unavailable. |
| `RUN_IDLE_MS` | `180000` | Idle watchdog: abort if the harness emits no events for this long (hang → `timeout`). |
| `RUN_MAX_MS` | `1200000` | Absolute backstop per run (~20 min). |
| `RUN_ASK_TIMEOUT_MS` | `600000` | How long the built-in `ask_questions` tool parks a run at `awaiting_input` before returning a "no answer" sentinel. The idle watchdog is suspended while waiting; the backstop still applies. |

See the [Run API](./integration/run-api.md).

## External build+test facility

The `tether-build` `end_build` tool hands generated code to a **separate** test facility.

| Var | Default | Purpose |
|---|---|---|
| `RUN_TESTER_URL` | — | Facility base URL. Set → `end_build` submits artifacts to `<url>/grade` and merges the verdict into the contract's `build` block. Unset → handoff is inert (`skipped`). |
| `RUN_TESTER_KEY` | — | Bearer token sent to the facility. |

## Secrets encryption

| Var | Purpose |
|---|---|
| `APP_SECRET` | Key for encrypting stored secrets + connection tokens (`crypto-store.js`). **Set this in Docker.** If unset, a random key is generated and written to a key file; unless that file is on a persistent volume, a container **rebuild/recreate mints a new key** and every previously-encrypted secret in the DB becomes undecryptable (`[Crypto] decrypt failed: Unsupported state or unable to authenticate data` on session init). Pin any strong string to keep encrypted data readable across hosts/rebuilds. |
| `APP_SECRET_FILE` | Path where the auto-generated key is persisted when `APP_SECRET` is unset. Defaults to `$APP_HOME/.tether-secret` (the `/data` volume in Docker) so it survives recreates. |

> If you see `[Crypto] decrypt failed` for a specific secret after changing/losing the
> key, that value was encrypted under the old key and is unrecoverable — re-save it
> (re-enter the secret / re-add the datasource) so it re-encrypts under the current key.

## Database

Two interchangeable backends, chosen at boot:

| Var | Purpose |
|---|---|
| `DB_DRIVER` | Force `sqlite` or `postgres`. Wins over everything. |
| `DATABASE_URL` | Postgres connection string. If set (and no `DB_DRIVER`), selects Postgres. |
| `DB_PATH` | SQLite file location (default `agent-backend/tether.db`; Docker mounts a volume). |

Resolution: `DB_DRIVER` → else `DATABASE_URL` present → postgres → else
sqlite. Both drivers share one schema. Migrate SQLite→Postgres with
`agent-backend/scripts/migrate-sqlite-to-pg.js`.

## Optional integrations

| Area | Vars |
|---|---|
| Harness binaries | `HARNESS_PI_PATH`, `HARNESS_NODE_PATH`, `HARNESS_OPENCODE_PATH` (auto-discovered on PATH). |
| Browser | `LIGHTPANDA_WS` (auto-started via Docker). |
| TTS / voice | `LOCAL_TTS_URL`, `LOCAL_TTS_KEY`, `LOCAL_TTS_MODEL`. |
| Web search | `EXA_API_KEY`, `PERPLEXITY_API_KEY`, `GEMINI_API_KEY` (Tether also ships a keyless search MCP). |
| Telegram | `TELEGRAM_DISABLE=1` to disable the poller (bot token added via Connectors UI). |

## Policy & budgets (Settings panel)

Not env — set in the app and stored in `security-config.json`:

- Capability × mode matrix (allow / ask / block).
- Allowed paths + the consent-proof hard blocklist.
- Per-session cost / token / sub-agent-depth budgets (0 = unlimited).

See [Concepts › Policy](./concepts.md#policy--modes).
