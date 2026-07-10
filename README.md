# AegisAgent OS Assistant & Dashboard

AegisAgent is a local personal assistant framework that operates directly on your host OS within user-configurable security guardrails. It features a stunning glassmorphic dashboard with real-time text and audio interaction, detailed logs of agent executions, and live browser integration powered by the high-performance **Lightpanda headless browser**.

## Key Features

1. **Host OS Interaction**: The assistant can run terminal commands, inspect and edit files, and deploy assets directly.
2. **Dynamic Security Guard (HITL)**: Protects your computer by filtering file paths and shell commands. Risky commands are paused for **Human-in-the-Loop** approval in real-time.
3. **Lightpanda Headless Browser**: Fast, lightweight browsing via Docker CDP, wrapped as an **MCP (Model Context Protocol)** server.
4. **Interactive Dashboard**:
   - **Speech to Text (STT)**: Use your microphone to talk to the agent.
   - **Text to Speech (TTS)**: The assistant responds vocally.
   - **Live Viewports**: View the latest screenshots of what the browser is rendering.
   - **Access Control Panel**: Customize allowed read/write directories and approved utilities live.
5. **Claude Fable 5 Prompt Option**: Access the newly leaked 1,000+ line behavioral prompt directive for deep reasoning.

---

## Folder Structure

- `mcp-server-lightpanda/`: MCP Server connecting to Lightpanda CDP.
- `agent-backend/`: Node.js/Express server and the Security Guard sandbox.
- `dashboard/`: Next.js 16 + React 19 + Tailwind 4 dashboard (custom server with WS proxy).
- `prompts/`: Pre-loaded prompts (`claude-fable-5.md` and `standard.md`).
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
Create a `.env` in the repo root with at least `LITELLM_KEY` (required — the backend refuses to start without it). Recommended extras: `LOCAL_TTS_KEY`, `LIGHTPANDA_WS`. The LiteLLM endpoint/models are configured in `agent-backend/security-config.json` (or live from the dashboard's Settings tab).

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
