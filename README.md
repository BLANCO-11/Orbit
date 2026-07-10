# AegisAgent OS Assistant & Dashboard

AegisAgent is a local-first, **harness-agnostic agent-operations console**: a Next.js dashboard talks over one WebSocket to an Express backend that drives a local CLI agent ("harness" — pi/PiCode today, others via the adapter contract) and streams everything it does back for you to watch and steer. It runs on your host OS within user-configurable security guardrails, with real usage/cost observability, end-to-end sub-agent tracing, a voice (STT+TTS) layer, and live browsing via the **Lightpanda headless browser** (an MCP server).

## Key Features

1. **Console with a unified activity view** — an icon-rail app (Console / Fleet / Connectors / Policies / Settings). Chat, reasoning (per-turn, collapsible, never spoken), tools, and sub-agents stream in one place; the inspector has Overview / Workspace / Trace / Logs segments.
2. **Real observability** — provider-reported token usage (not estimates) with directional cost, a per-turn ledger + tokens-per-turn chart, and a **Trace** view giving each sub-agent its own task, reasoning, tool calls, and token counters (persisted across restarts).
3. **Permission modes + enforced budgets** — Chat / Plan / Edit / Yolo gate what the agent may do; per-session cost/token caps and a sub-agent-depth cap halt work before it overruns (Policies view; hot-reloaded, no restart).
4. **Prompt library + skills** — swap the system prompt per session from stored `prompts/*.md` (incl. frontier-style prompts); attach reusable `skills/*/SKILL.md` instruction packs. Both are inherited by every sub-agent.
5. **Fleet pairing** — pair devices via URL + OTP with a live countdown; the same flow is the path for remote harnesses.
6. **Dynamic Security Guard (HITL)** — filters file paths and shell commands; risky actions pause for in-conversation approval.
7. **Voice** — mic STT with barge-in (speaking stops the agent's audio), streamed sentence-level TTS.
8. **Lightpanda headless browser** — fast CDP browsing wrapped as an MCP connector.

---

## Folder Structure

- `mcp-server-lightpanda/`: MCP server connecting to Lightpanda CDP.
- `agent-backend/`: Node.js/Express server, harness abstraction (`harnesses/`), metrics + sub-agent tracker, Security Guard, and route handlers. Wire protocol documented in `agent-backend/PROTOCOL.md`.
- `dashboard/`: Next.js 16 + React 19 + Tailwind 4 dashboard (custom server with WS proxy).
- `prompts/`: System-prompt library (`standard.md`, `claude-fable-5.md`, …) plus mode directives (`plan/edit/yolo-mode.md`).
- `skills/`: Reusable instruction packs (`<name>/SKILL.md`).
- `plan/`: Product redesign + implementation plans and the approved UI mock (`aegis-console-mock.html`).
- `workspace/`: The designated file workspace for the assistant's filesystem operations.

---

## Quick Start Guide

### Prerequisites
- Node.js (v18+)
- Docker (for the Lightpanda browser container)

### Step 1: Start Lightpanda Browser
If not already running, start the Lightpanda browser CDP container:
```bash
docker run -d --name lightpanda-browser -p 127.0.0.1:9222:9222 lightpanda/browser:nightly
```

### Step 2: Configure Environment
Create a `.env` in the repo root with at least `LITELLM_KEY` (required — the backend refuses to start without it). Recommended extras: `LOCAL_TTS_KEY`, `LIGHTPANDA_WS`. The LiteLLM endpoint/models are configured in `agent-backend/security-config.json` (or live from the dashboard's Settings page). Optional TTS overrides: `LOCAL_TTS_URL`, `LOCAL_TTS_MODEL`.

### Step 3: Run the Application
In the root directory, start both the backend and dashboard concurrently:
```bash
npm run dev
```

This will:
1. Boot the agent backend on `http://127.0.0.1:6800` (internal only).
2. Connect to the Lightpanda browser container.
3. Launch the dashboard on `http://localhost:6801` — the only exposed port; it proxies `/api/*` and the WebSocket to the backend.

Open `http://localhost:6801` in your browser.

### All Commands

Run these from the repo root:

| Command | What it does |
|---|---|
| `npm run dev` | Backend + dashboard dev servers together (labeled, colored output; Ctrl+C stops both) |
| `npm run dev:backend` | Backend only (`:6800`) |
| `npm run dev:frontend` | Dashboard dev server only (`:6801`) |
| `npm run build` | Production build of the dashboard (**stop the dev server first** — build and dev sharing `.next` corrupts the chunk manifest) |
| `npm start` | Production: builds the dashboard, then runs backend + dashboard with `NODE_ENV=production` |
| `npm run verify` | Typecheck + a production compile into an isolated `.next-verify/` — safe to run while the dev server is up |
| `npm run typecheck` | `tsc --noEmit` on the dashboard |
| `npm test` | Security-guard test suite |
| `npm run clean` | Delete `dashboard/.next` and `.next-verify` — the fix for a corrupted/stale build cache |

---

## Security Configurations (`security-config.json`)

You can edit paths and prefixes directly inside the dashboard or via `agent-backend/security-config.json`.
- **Allowed Read/Write Directories**: The agent will be blocked if it attempts to access files outside these paths.
- **Allowed Utilities**: Shell commands must start with these utility prefixes (e.g. `git`, `npm`, `node`).
- **Auto-Approve Commands**: Safe commands that execute without prompt (e.g. `git status`).
- **Require Approval Toggle**: When active, all non-whitelist commands require you to click **Approve** on the dashboard before they run on your host.
