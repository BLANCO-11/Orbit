# Orbit — UX Hardening & Capability Batch

> Handoff doc for continuing implementation in a fresh chat. Captures a batch of
> bug fixes + new features driven by user feedback (July 2026). Read this first,
> then continue with the **Remaining** section.
> Branch: `feat/metrics-reliability-and-fleet`. Newest commit: `a21a384`.

## How to run / verify (project conventions)
- Backend: `node agent-backend/server.js` (port 6800, loopback). Dashboard: `npm --prefix dashboard run dev` (port 6801, proxies `/api/*` → 6800).
- Clear ports: `fuser -k 6800/tcp 6801/tcp`.
- Verify: `npm run typecheck`, `NEXT_DIST_DIR=.next-verify npm --prefix dashboard run build`, `npm test` (security guard).
- Screenshots: puppeteer-core + chromium at `~/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome` (run scripts from repo root so `node_modules` resolves).
- **pi has stored auth on this machine** — running a real turn spends the user's tokens. Do NOT trigger live agent turns just to test. Use `TELEGRAM_DISABLE=1` when booting so the Telegram poller doesn't hit the user's real bot.

---

## ✅ Done & verified this batch (commits, newest first)

### `a21a384` — Preview + Console tabs (inspector panel)
- **PreviewTab** (`dashboard/src/components/panels/PreviewTab.tsx`): one tab, two modes — **Live** (iframe → a real system URL, e.g. a dev server) and **File** (render a `/workspace` path: markdown→HTML, images inline, else text). Reuses `GET /api/workspace/file`; added `?raw=1` byte route to `agent-backend/routes/workspace.js` for images.
- **ConsoleTab** (`dashboard/src/components/panels/ConsoleTab.tsx`): operator shell into the agent runtime. `POST /api/console/exec` (`agent-backend/routes/console.js`) runs a command in the **project root** (cwd matches the agent's bash), 20s timeout, 200KB output cap, `↑/↓` history. **Not** policy-gated (operator outranks the agent); loopback + authed only.
- Wired as tabs in `DetailPanel.tsx` (now horizontally scrollable): Overview · Preview · Console · Workspace · Trace · Logs. Mounted in `dashboard/src/app/page.tsx` (`rightPanelTab === 'preview' | 'console'`).
- Verified live: console exec returned real output; both tabs render, 0 console errors.

### `d9c5a89` — metrics turn-end persist + two-way Telegram bridge
- **Metrics reset bug (root fix):** metrics were only written to the DB on `ws.close` / harness-close / 30s autosave — never at turn end. So a fresh session refreshed before those read back **0**. Fixed: the `agent_end` handler in `server.js` (`createHarnessEventEmitter`) now upserts the session's metrics blob every turn. Architecture confirmed correct: session-id-keyed `metrics` blob, upserted+fetched by id, with per-tool (`byTool`) and per-turn (`turns[]`) breakdowns inside — round-trip verified.
- **Telegram bridge** (`agent-backend/telegram-bridge.js`): two-way over the stored `telegram` bot token. Inbound long-poll runs the agent for **paired chats only** (pairing code shown in console / `GET /api/telegram/status`); outbound alerts fan out from the notification bus. `TELEGRAM_DISABLE=1` opts out. Reuses `fleet.dispatchToDevice` (generalized with `source`/`titlePrefix`).

### `e085cfe` — reliable metrics, durable chat, device visibility, fleet dispatch
- Session-switch metrics no longer reset (client POST can't clobber backend-owned `metrics`/`subagentTree` — guard in `routes/sessions.js`; full-field `normalizeMetricsForUI` in `hooks/useSessions.ts`).
- AgentTab shows **reported** usage as authoritative; estimate shown as muted `≈`/`measuring…`, never as truth.
- Durable chat: persist conversation on turn active→settled; memoized `ChatMessage` + stick-to-bottom autoscroll (fixed streaming flicker).
- Header shows active device/runtime next to CONSOLE.
- Mission board parses pi's `[TODO]/[IN PROGRESS]/[DONE]` tags into live checklist status.
- **Fleet (orchestrated lead):** `orbit-fleet` MCP server (`mcp-server-fleet/index.js`) + `agent-backend/fleet.js` + `routes/fleet.js`. Lead delegates a task to a device; dispatch runs a headless turn on that device's harness and returns the answer; surfaces as sub-agent lanes in Mission via the lead's own tool-call events. Auto-registered in `.pi/mcp.json` on boot.

### Other
- **API key**: generated `orbit_…`, stored **inactive** (commented) in gitignored `.env`. Activating requires wiring the dashboard proxy + WS to forward it (else the UI 401s — no loopback exemption in `middleware/auth.js`). Auth also supports per-device tokens.

---

## 🔍 Key diagnosis carried forward

**Mode-change on a "chat" convo (user complaint):** NOT web fetch. The user's stored `policyMatrix` has `network:chat = "ask"` and `shell:chat = "block"` (`policy-engine.js` `DEFAULT_MATRIX`; override in `agent-backend/security-config.json` via `/api/config`). The escalation came from the agent using **`bash`+curl to send Telegram** (shell = blocked in chat). **User's steer: fix it as a SYSTEM fix, not a Telegram-specific hack** — give the agent a first-class notify/send *tool* (network capability) so it never reaches for shell. This folds into item #2 below.

---

## ✅ Remaining — now DONE (this batch)

### 2. Notifications separation + self-docs + systemic notify tool ✅
- **Notification bus** (`agent-backend/notify-bus.js`): one `notify(event)` → typed sinks. Sinks registered in `server.js`: `web` (WS `type:"notification"` bell/toasts), `desktop` (notify-send), `channel` (Telegram + Discord/Slack webhooks). Each event names its sinks; default is `web` only. Web and channel no longer pollute each other.
- `routes/notifications.js` is now a thin validator → `bus.notify(...)`; accepts `message` (legacy) or `body`, plus an optional `sinks[]`. `broadcastNotification` in `server.js` routes internal system events to `["web","desktop"]` only (no more spamming Telegram on every headless run).
- **Systemic notify TOOL** (`mcp-server-notify/index.js`, id `orbit-notify`): `send_message` (text the user on channels) + `notify` (alert, web+channel by default, `web_only` opt). MCP tools map to `network` capability, so they work in chat mode — this **kills the shell escalation** (agent no longer reaches for `bash`+curl). Auto-registered on boot via the generalized `ensureOrbitMcpServersRegistered` (fleet + notify). Verified: bus routes per-sink, MCP server boots on stdio.
- **Self-docs prompt** `prompts/orbit-system.md`: always injected in `harnesses/picode/index.js` — who Orbit is, modes + capability×mode matrix, notify/fleet tools, connectors, guidance. The `./orbit-notify` bash instruction removed from `standard.md` + all mode prompts, replaced with the notify tool.

### 3. Layout cleanup ✅
- **Settings dedupe**: removed the redundant Cog from `IconRail.tsx` (it and the header gear both called `setActiveView('settings')`). Header gear is the single entrypoint.
- **Sidebar collapse**: desktop sessions `<aside>` in `AppShell.tsx` hides via a `PanelLeftClose/Open` toggle in the `Header` brand cluster (desktop only) — collapsed = more canvas.
- **Composer run-config popover**: `ChatInput.tsx` now shows only **Mode** inline plus a **⚙ Run config** popover holding Profile · Harness · Prompt · Effort · Skills (labeled rows). Voice + mic + Send unchanged. Click-outside/Escape to close.

Verified: `npm run typecheck` clean, `next build` clean, `npm test` (security guard) clean, backend boots and notify routing/sink-separation confirmed live.

<details><summary>Original plan (for reference)</summary>

### 2. Notifications separation + self-docs + systemic notify tool
**Why:** the in-app notification module (`agent-backend/routes/notifications.js`, `broadcastNotification` in `server.js`, dashboard `NotificationCenter`) is conflated with Telegram/channel notifications. And the agent falls back to `bash ./orbit-notify` (shell, blocked in chat) for outbound messaging.

- **Split the dispatcher into one bus → typed sinks.** One `notify(event)` with sinks tagged by origin:
  - `web` sink → dashboard `NotificationCenter`/toasts (WS `type:"notification"`), **web-app only**.
  - `channel` sink → Telegram (`telegramBridge.notify`) + webhook channels.
  - Tag each notification with origin so Telegram/channel alerts don't pollute the web bell and vice-versa. Currently `broadcastNotification` in `server.js` blindly fans to both (WS + `telegramBridge.notify`) — separate them and let callers/config choose sinks.
- **Systemic notify/send TOOL (the Telegram/mode fix).** Expose an MCP tool (network capability) — e.g. add to `mcp-server-fleet` or a new small MCP server — that calls a backend route (`POST /api/notify` or extend `/api/telegram/send`) routing through the dispatcher. Then the agent sends notifications/messages via a *tool* (allowed by `network:chat`), not `bash`. This kills the chat-mode escalation. Map the tool to the `network` capability in `policy-engine.js` `toolToCapability` if needed.
- **Self-documenting system prompt.** Add `prompts/orbit-system.md` (always injected, alongside `prompts/standard.md`): who Orbit is, its modes (chat/plan/edit/yolo) + the capability×mode matrix, connectors, the fleet + notify/Telegram tools, and how to guide the user. In the problem session the agent `bash`-grepped its own source to answer "are we connected to telegram" — this prompt prevents that. Injected in `agent-backend/harnesses/picode/index.js` (`basePrompt` assembly, ~line 33-59).

### 3. Layout cleanup (theme is good; reduce redundancy)
- **Two settings buttons** — one on the header (`components/layout/Header.tsx`, gear) and one on the sidebar/icon rail (`components/layout/IconRail.tsx`). Keep the header gear; remove the rail one.
- **Sidebar collapse** — add a collapse toggle to the session sidebar (`AppShell.tsx` desktop `<aside w-[264px]>`); collapsed = rail-only, more canvas for chat/preview.
- **Composer is overloaded** (`components/chat/ChatArea.tsx` + `ChatInput.tsx`): Profile · Harness · Mode · Prompt · Skills · Effort · mic · TTS · Send. Collapse the run-config chips (Profile/Harness/Prompt/Skills/Effort) behind one **"⚙ Run config"** popover; leave only **Mode + mic + Send** inline. Much calmer.

</details>

---

## Design constraints (apply to everything above)
- Keep the current theme — it's strong. The issue is layout redundancy, not styling. Reuse existing tokens (`text-faint`, `border-border-soft`, `bg-card`, `rounded-xl`, `shadow-card`, `text-[12.5px]`, etc.).
- **One inspector panel, tabbed** (Overview · Preview · Console · Workspace · Trace · Logs) — do NOT add new regions/columns.
- Don't clutter. Prefer popovers/collapse over more always-visible controls.
- `dashboard/AGENTS.md`: this Next.js has breaking changes vs training data — check `node_modules/next/dist/docs/` before new patterns.

## Verified-elsewhere caveats (need the user's env to fully exercise)
- Fleet **successful** dispatch and Telegram **live** inbound both run real pi on a device (spend tokens / need a paired device) — mechanisms built & unit/boot-verified, not end-to-end driven here.
