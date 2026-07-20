# Concepts

The mental model behind Orbit. Skim this once; the rest of the docs assume it.

## Session

A **session** is the durable context for a line of work: its conversation, its
per-session **workspace** on disk, and (for multi-tenant deploys) its owning
tenant. Sessions persist to the database and show up in the session list and
timeline. A session is created implicitly by the first task run against it, or
explicitly via the UI / `POST /api/sessions`.

### Workspace layout

Each session gets an isolated tree under `ORBIT_HOME` (default `~/.orbit`, or
`/data/orbit-home` in Docker):

```
<ORBIT_HOME>/sessions/<sessionId>/
  workspace/     ← agent cwd; all task work + scripts land here
  artifacts/     ← deliverables to keep (reports, scripts) — surfaced in the contract
  tmp/           ← scratch
  runs/<runId>/artifacts/   ← per-run snapshot (see Runs)
```

The agent is told to write finished deliverables to `../artifacts/`. The whole
session root is the writable safe zone; writes outside it require consent, and
blocklisted paths are refused outright.

## Run

A **run** is one execution against a session. Runs are **many-per-session and
versioned**: re-running the same or a refined task on the same `sessionId`
produces a new run with an incrementing `seq` (v1, v2, …), its own result
contract, and its own artifact snapshot — so v1's script survives when v2
rewrites the live workspace. `runId : sessionId = many : 1`.

A run is **async**: submit it, then poll. Its lifecycle is:

```
running → { succeeded | failed | timeout | error | needs_review }
```

The terminal status is derived from the run lifecycle merged with the agent's
self-reported `artifacts/RESULT.json`. See the [Run API](./integration/run-api.md).

## Tenant & RBAC

A **tenant** is an isolation boundary. Every credential resolves to an identity
with a role and (optionally) a tenant:

- **superadmin** — the operator; env-key or seeded account; sees everything.
- **admin** — manages its tenant (keys, members).
- **member** — normal programmatic access within its tenant (the default for
  minted API keys; can manage its own secrets/connectors/runs).
- **viewer** — read-only.

Secrets, connectors, and runs are all scoped to the tenant of the API key that
created them. A member of tenant A can never see tenant B's data.

**Dev-mode:** if no `ORBIT_SUPERADMIN_KEY` is configured, every caller is treated
as superadmin (zero-config local use). Set the key before exposing Orbit.

See [Authentication](./integration/authentication.md).

## Harness

A **harness** is the agent runtime that actually runs a turn. All implement one
interface:

- **picode** — the local `pi` CLI as a child process (default).
- **container** — `pi` inside an ephemeral Docker container (stronger isolation).
- **opencode** — the OpenCode runtime.
- **remote** — a paired remote device (Fleet).

## Sandbox

Where a run executes, chosen per-run or by deployment default:

- **host** — the backend host / its container. Fast; policy-gated.
- **container** — an ephemeral Docker container, filesystem-isolated, network-on
  by default, image ships python+node. **Runs default to this**, downgrading to
  `host` if Docker isn't available (so a run always reaches a terminal status).
- **remote** — a paired remote harness.

Runs are additionally bounded by an **idle watchdog** and an **absolute
backstop** so a hung task always terminates (`ORBIT_RUN_IDLE_MS`,
`ORBIT_RUN_MAX_MS`).

## Policy & modes

Every tool call is evaluated against a **capability × mode** matrix:

| Mode | Intent |
|---|---|
| `chat` | Conversation + read-only capabilities. |
| `plan` | Planning; no mutations. |
| `edit` | File edits allowed. |
| `yolo` | Broad autonomy (shell, network, write) within the hard blocklist. |

On top of the matrix sits a **consent-proof hard blocklist** (your `~/.ssh`,
Orbit's own source, etc.) that no mode can cross, and shell-command tokenization
so a blocklisted path can't sneak through a redirect or subshell. The sandbox is
the containment layer beneath the policy.

## Connectors (MCP)

**Connectors** are MCP tool servers the agent can call. Two kinds:

- **Shared** — Orbit's own servers (fleet, notify, search, transcript,
  lightpanda) and OAuth-wired providers; available to all tenants.
- **Tenant** — servers a tenant registers via `POST /api/connectors`; isolated to
  that tenant and composed into only its sessions' `.pi/mcp.json` at spawn.

Connector `env` values may reference `${secret:NAME}` (resolved from the tenant's
secret store at spawn). See [Secrets & connectors](./integration/secrets-and-connectors.md).

## Secrets

Tenant-scoped credentials, encrypted at rest. They are **injected into the
sandbox environment** at spawn (so a generated script reads `os.environ["NAME"]`)
and are **never** placed in the prompt, transcript, or logs — the agent is told
the env-var *name*, never the value. Reference them anywhere as `${secret:NAME}`.

## Result contract

The typed, validated object a run returns — status, summary, primary artifact,
artifact listing, self-reported tests, token/cost usage, and validation
metadata. It's designed so a parent app can act on a run **without scraping the
transcript**. Full shape in the [Run API](./integration/run-api.md).
