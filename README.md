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
   State: SQLite (agent-backend/*.db) · encrypted tokens · per-session file isolation
```

**How it fits together:** the backend owns sessions, metrics, and the capability×mode **policy** it enforces on every tool call. Each session spawns a harness with `cwd` = its own isolated workspace. Capabilities the agent reaches for (search, notify, plan, browser) are **MCP servers** Orbit auto-registers. A "lead" chat can delegate subtasks to other agents/devices (**Fleet**), and each delegate's activity streams back into the lead's Trace.

---

## Prerequisites

| Requirement | Why | Notes |
|---|---|---|
| **Node.js 22+** | uses the built-in `node:sqlite` | `node --version` ≥ 22 |
| **An OpenAI-compatible LLM endpoint** | the model the agent runs on | e.g. [LiteLLM](https://github.com/BerriAI/litellm) proxy, or any `/v1` endpoint |
| **`pi` CLI** | the default agent harness | install per pi's docs; auto-discovered on PATH |
| **Docker** *(recommended)* | the Lightpanda headless browser (web browsing) | auto-started on boot if present |
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

- **`.env`** (see [`.env.example`](.env.example)) — LLM endpoint, ports, optional TTS/search/browser/Telegram. Values here override the config file at spawn time.
- **Settings panel** (in-app) — models, TTS voice, security (allowed/blocked paths, approval), web-access extension, budgets — persisted to `agent-backend/security-config.json` (gitignored, holds your key).

**Permissions** are a capability × mode matrix (`chat`/`plan`/`edit`/`yolo` → allow/ask/block) enforced by the backend on every tool call, plus a consent-proof hard blocklist (your `~/.ssh`, Orbit's own source, etc.). Each session writes only inside its own `~/.orbit/sessions/<id>/workspace`; anything outside asks first.

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
- **Voice** *(optional)* — STT in, streamed TTS out with barge-in, shown only when a TTS backend is configured.

## Project layout

```
agent-backend/        Express backend, harnesses, policy engine, MCP registry, SQLite
  harnesses/          picode (pi), opencode, container, remote — one HarnessInterface
  routes/ ws/         REST + WebSocket
  workspace-paths.js  per-session ~/.orbit/sessions/<id> layout
dashboard/            Next.js console (src/app, components, hooks, providers)
mcp-server-*/         Orbit's own MCP tool servers (lightpanda, search, notify, plan, transcript, fleet)
prompts/  skills/     system prompts + reusable instruction packs
restart-orbit.sh      clean rebuild + boot
```

## Scripts

```bash
npm run dev        # backend + dashboard (hot reload)
npm run build      # build the dashboard
npm start          # build + run both (production)
npm run verify     # typecheck + production build
npm test           # security-guard tests
```

## Branching

- **`main`** — stable, releasable. Protect it; merge via PR.
- **`develop`** *(optional)* — integration branch if you want a staging line.
- **`feature/*`**, **`fix/*`** — one branch per change, PR into `main` (or `develop`).

Never commit `.env`, `agent-backend/security-config.json`, or `agent-backend/.orbit-secret` — they're gitignored and hold secrets. `security-config.example.json` is the safe, committed template.

## Orbit as a Headless Backend

Orbit can be run as a headless backend service (`agent-backend`). This allows third-party developers to connect their own dashboards, voice control suites, or external scripts.

For detailed request/response structures, WebSocket event protocols, authentication, and stability notes, refer to the [API Specification Guide](./API.md).

## Security notes

- The backend binds to `127.0.0.1` only. Set `ORBIT_SUPERADMIN_KEY` (formerly `ORBIT_API_KEY`, still accepted as a fallback) before exposing it beyond loopback — otherwise it runs in dev-mode, treating every caller as superadmin. For multi-user deployments, mint tenant-scoped API keys or enable OIDC SSO from the Admin console rather than sharing the superadmin key.
- The agent runs real commands on your machine within the policy matrix — review Policies/Settings before granting `edit`/`yolo`, and use the container sandbox for untrusted work.
- Tokens for connected services are encrypted at rest (`crypto-store.js`).
