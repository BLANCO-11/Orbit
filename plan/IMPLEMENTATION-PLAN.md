# AegisAgent — Implementation Plan

> Companion to `plan/REDESIGN-PLAN.md` (the what/why) and `plan/aegis-console-mock.html` (the approved look).
> Phases are ordered so each ships something visible and nothing blocks on a later phase. Commit per phase; run `npm run verify` + drive the real app before each commit.

---

## Phase 1 — Metrics truth (backend first, no UI risk)

The observability data must be real before the new UI renders it.

1. **Provider-reported usage.** In the harness response path, parse `usage` (`prompt_tokens`, `completion_tokens`) from LiteLLM/OpenAI-compatible responses into `metrics.js`. Keep the char-count heuristic only as a fallback flagged `source: 'estimated'`; UI shows the source tag.
2. **Cost.** Add a per-model pricing map (config, editable in Settings). `cost = Σ(tokens × price)` accumulated per turn and per agent. Add `cost` to `createEmptyMetrics()`.
3. **Wire the dead sub-agent call-sites.** Register listeners for `subagent_tool_start` / `subagent_tool_end` / subagent reasoning in `server.js`; invoke `SubagentTracker.startToolCall/endToolCall` and the `metrics.addSubagent/updateSubagent/addSubagentToolCall/completeSubagent` family (all currently implemented but never called). Fix `parentId = null` hardcoding — pass real parent + depth.
4. **Persist traces.** Serialize `SubagentTracker` (`toJSON/fromJSON`) into the session row alongside metrics; restore on session load. Add per-turn ledger (append-only array) instead of snapshot-only overwrite.
5. **Fix the three confirmed metric bugs**: reducer receiving a function in `useWebSocket.ts`; action-feed field-name mismatch (`text`/`type`/`timestampEnd` vs backend shape); latency ms rendered as seconds.
6. **Events out.** One WS event vocabulary for the timeline: `turn_start`, `reasoning(tokens, text, spoken:false)`, `tool_start/end`, `edit(file, diffstat, diff)`, `subagent_spawn(task, parent, depth)`, `subagent_event(...)`, `approval_request/resolved`, `usage_update`, `assistant_message(tts?)`. Document in `agent-backend/PROTOCOL.md`.

**Verify:** run a session that spawns a sub-agent; DB row contains real token counts, cost, and a non-empty sub-agent trace; restart server, trace still loads.

## Phase 2 — Console rebuild on the mock

Port the mock's structure into `dashboard/` (Next + Tailwind + shadcn tokens; lift palette/type tokens from the mock CSS).

1. **Shell:** icon rail (Console/Fleet/Policies/Settings) replacing header-tab sprawl; kill the second settings entry point and the footer devices row.
2. **Timeline:** one virtualized stream rendering the Phase-1 event vocabulary — entry components: UserMessage, PlanCard, ToolCall, EditCard, ReasoningAccordion, SubagentLane, ApprovalGate, AssistantMessage. Gutter thread + lineage colors.
3. **Inspector:** Overview / Workspace / Preview / Trace segments per the mock (tiles, tokens-per-turn chart, context+budget meters, sub-agent list, latency bars, sparkline; file tree with M/A badges; diff/image/markdown preview; per-agent trace view that streams live).
4. **Composer (compact):** single-line textarea + uniform accordion chips — mode, harness, prompt (from library), effort, skills — plus dictate, TTS toggle, Send.
5. **State:** one store (single reducer/zustand — no more 23 `useState` + separate context). Typed end to end: delete every `@ts-nocheck`, no `any` props.
6. **Empty states:** designed first-run guidance (what the console can do, how to pair), never a bare spinner.
7. **Mission view:** Timeline ⇄ Mission toggle in the console header — phase board derived from plan/task events (phase, task, owner agent, status, cross-check, `added_from` turn ref). Requires the harness to emit structured plan-update events; task click jumps to the timeline entry.
8. **Effort profiles:** fast / balanced / deep selector in the composer → model routing + thinking budget per profile, defaults editable in Settings. Orthogonal to permission modes.
9. Mobile: bottom nav mirrors the rail; inspector segments as sheets.

**Verify:** drive a real session end-to-end in the browser; screenshot desktop + 390px; keyboard-navigate the timeline; zero console errors.

## Phase 3 — Fleet: identity, OTP pairing, remote harnesses

1. **Device identity:** `devices` table; `POST /api/pair/start` (issues 5-min OTP, owner-only), `POST /api/pair/claim` (code + name + scope → device token); token check on every HTTP route and WS upgrade (replaces fail-open middleware); revocation endpoint kills sockets.
2. **Scopes:** `chat_voice` / `read_only` / `full` enforced server-side (read-only devices get events, no `start_task`/approvals).
3. **Harness registry:** `harness_instances` (type, transport, machine, policy scope, status). Local = spawn (existing); remote = `aegis-adapter` CLI that claims an OTP, opens an authenticated WS, and bridges the harness's stdio protocol. Multiple instances per machine supported; session picker chooses instance.
4. **Fleet UI** per the mock: pairing card (OTP + countdown + scope + adapter one-liner), harness list with per-instance spend + policy link, device list with revoke.
5. Remove the kill-sibling-session-on-same-socket behavior; sessions keyed `(deviceId, sessionId)`.

**Verify:** pair a phone via OTP on the LAN, watch a running session read-only; connect a second harness instance and run two sessions concurrently; revoke the phone mid-session.

## Phase 4 — Policies & approvals

1. **Policy engine v2:** capability × mode matrix (read/write-in/write-out/shell/network/spawn) with allow/ask/block, stored per harness instance with device overrides; replaces the single global config object and the `AEGIS_MODE` env fallback.
2. **Budgets enforced:** max cost/session, token budget, sub-agent depth — harness paused at cap with a timeline gate asking to continue.
3. **In-timeline approvals:** `ask` → `approval_request` event → gate card (approve once / deny); only devices with approval rights may resolve; resolution broadcast to all viewers.
4. **Policies UI** per the mock (matrix, budgets, per-device overrides).
5. Config save no longer kills every active session — policies hot-reload per instance.

## Phase 5 — Connectors & skills

1. **MCP connector registry:** add/remove servers (command or URL + auth) via `mcp-client.js`; expose namespaced tools to harness sessions; every connector call goes through the policy engine (per-connector allow/ask/block rows) and lands in timeline + metrics. Ship github as the reference connector; lightpanda already exists.
2. **Skills:** `skills/<name>/SKILL.md` loader; composer attach/detach injects into system prompt; always-on flag; Settings management UI (list, toggle, add from folder/git URL).
3. **Prompt library:** store prompts as `prompts/<name>.md` with a small manifest (name, description, flavor); seed with `standard` + frontier-style prompts (claude/gemini/codex — `prompts/claude-fable-5.md` already exists). Session carries `promptId`; harness composes `library prompt + mode directive`; sub-agent spawns inherit the session's `promptId`. Add prompt via paste/file/URL in Settings.
4. **Settings page** per the mock: models, prompt library management, skills, voice, memory/compaction.

## Phase 6 — Voice polish + hardening

1. TTS: mute stops playback now; revoke blob URLs; stream (pipe) audio instead of buffering; autoplay-blocked indicator.
2. Barge-in: mic activity pauses agent audio; mic muted while TTS plays unless barge-in triggers.
3. Per-session voice (two concurrent sessions distinguishable by ear).
4. Sweep: README rewrite (Next 16 + React 19 + Tailwind 4 reality), delete orphaned components, a11y pass (roles, focus, keyboard), widget-level error boundaries so one panel can't take down the app.

---

## Sequencing note

1 → 2 are the core ask (real observability + the new UI) and land independently of auth changes. 3 → 4 change the security model and should be reviewed together. 5 → 6 are additive. If anything must be cut first pass, cut 6.3 and the github connector's write actions.
