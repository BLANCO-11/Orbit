# AegisAgent — Investigation Report

> **Date:** 2026-07-10
> **Method:** Fresh, independent line-by-line audit of the current codebase (four parallel deep-dives: UI/frontend, metrics/observability, TTS, auth+harness-connection), plus manual re-verification of the highest-severity claims. No prior planning documents were trusted as input — the previous `plan/`, `temp-test/`, and `progress.md` docs were stale/unreliable and have been deleted.
> **Scope:** `agent-backend/`, `dashboard/`, `mcp-server-lightpanda/`.

---

## 0. What this app actually is today

AegisAgent is a **single-tenant, single-machine, localhost-bound** tool: a Next.js dashboard talks over one WebSocket to an Express backend that spawns a local CLI agent process ("harness," currently only `pi`/PiCode implemented) and streams its events back. It already has real, working pieces — a working chat/session model, a sentence-level TTS pipeline, a sub-agent tracking data model, mode-based policy (chat/plan/edit/yolo), and a security guard for path/command validation.

What it is **not** yet, despite being the stated ambition: a multi-tenant platform that arbitrary harnesses/devices can authenticate into, with real observability, and a polished product-grade UI. Every one of those four ambitions has a concrete, verified gap below.

---

## 1. Auth Layer & Harness Connection (the "connect any harness via URL + OTP" ambition)

**Verdict: none of this exists yet, and today there is no auth at all — not even for a single device.**

| # | Finding | Severity |
|---|---|---|
| 1.1 | `agent-backend/middleware/auth.js:10-14` is fail-open: `if (!config.apiKey) return next()`. Nothing in the codebase ever writes a top-level `apiKey` into `security-config.json` (the only `apiKey` present is `litellm.apiKey`, a different field — the LLM provider's own key). Every route mounted with this middleware is **unauthenticated in practice**, permanently, not as a dev-mode fallback. | 🔴 Critical |
| 1.2 | `agent-backend/ws/index.js:9-17` — the WS upgrade handler checks only that the URL path is `/api/ws`. No token, cookie, or origin check. Any TCP client that reaches the port can upgrade and immediately issue `start_task`, spawning an agent and running tools. | 🔴 Critical |
| 1.3 | Mitigating today: `server.js:621-623` binds to `127.0.0.1` only, so exposure is local-machine-only for now. This is the *only* thing standing between "no auth" and "wide open" — it must not be relaxed before 1.1/1.2 are fixed. | 🟡 Note |
| 1.4 | No device/connection identity concept anywhere. `sessionId` (`server.js:100`) is a free-form client-supplied string used as a `Map` key — not tied to a user, device, or token. The `sessions` DB table has no `device_id`/`user_id` column in any schema version. | 🟠 High |
| 1.5 | Harnesses are spawned exclusively via local `child_process.spawn` (`harnesses/picode/index.js:82-86`). There is no network transport for a harness to "dial in" from elsewhere — the extensibility point that exists (`harnesses/index.js`) is for harness *type* (which CLI to run), not harness *location* or *identity*. |🟠 High |
| 1.6 | The protocol actively assumes one active session per browser tab: `server.js:102-109` kills any other session on the *same WS* whenever a new `start_task` arrives. "Multiple agents on one device" isn't cleanly supported today even locally. | 🟠 High |
| 1.7 | Policy (`security-guard.js`) is a single global config object (`config.js:9-11`), not scoped per session/device. Saving new config via `routes/config.js:19-34` kills **every** active session server-wide. Mode is also leaked through a global env var (`process.env.AEGIS_MODE`, read as a fallback in `security-guard.js`), a real cross-session race risk once concurrency increases. | 🟠 High |
| 1.8 | Grep for `otp\|pairing\|device.?id\|qrcode\|linkcode` across the entire backend: **zero matches.** No pairing endpoint, no token issuance/rotation/revocation, no OTP generation/expiry, no device table. This is a from-scratch feature, not an extension of something partial. | ⚪ Scope note |

**What has to be true architecturally before URL+OTP pairing makes sense:** an authenticated device/connection identity layered above `sessionId`; `activeSessions` keyed by `(deviceId, sessionId)`; per-device policy scoping instead of one global config; a real WS auth handshake; and removal of the "kill sibling session on this socket" behavior. This is genuinely a new subsystem, not a patch.

---

## 2. Metrics & Observability

**Verdict: the data model for full observability mostly exists — nested sub-agent tree, per-tool latency, reasoning tracking, a cost field in the UI — but roughly half the wiring between "collected" and "shown/persisted" is dead code, mismatched field names, or was never connected.**

Two independent tracker objects exist and only partly talk to each other: `metrics.js` (`SessionMetricsManager`, meant to be the persisted record) and `subagent-tracker.js` (`SubagentTracker`, the richer live parent/child tree, never persisted).

| # | Finding | Severity |
|---|---|---|
| 2.1 | All token counts are a **character-count heuristic** (`estimateTokens`, `metrics.js:27,95-105`), never real provider `usage` numbers. `tokens.estimated` is hardcoded `true`. Zero code parses a real `prompt_tokens`/`completion_tokens` object anywhere. | 🟠 High |
| 2.2 | **Cost is not tracked at all.** `createEmptyMetrics()` has no `cost` field, yet `MetricsPanel.tsx:317,339` and `AgentTab.tsx:21` both render an "Est. Cost" tile that always falls back to `"0"` — a permanently fake UI element. | 🟠 High |
| 2.3 | `server.js:395` hardcodes `parentId = null` for every spawned sub-agent — true nesting depth is structurally unrepresentable even though `SubagentTracker.getAgentTree()` supports it. | 🟠 High |
| 2.4 | `SubagentTracker.startToolCall(...)` — the method that records a sub-agent's *own* nested tool calls — is **never invoked anywhere** in `server.js`. No listener is registered for `subagent_tool_start`/`subagent_tool_end` even though the harness interface defines them. Every sub-agent's `toolCalls` array stays `[]` forever, which is why the UI shows a "tracked internally" placeholder instead of real per-subagent tool history. | 🔴 Critical (directly the user's stated ask) |
| 2.5 | `metrics.js:326-411` — `addSubagent`/`updateSubagent`/`addSubagentToolCall`/`completeSubagent` are fully implemented but **never called**. The field that actually gets persisted to the DB (`metrics.subagents`) is always `[]` in every saved session row. | 🔴 Critical |
| 2.6 | `SubagentTracker` is **100% ephemeral** — `toJSON()`/`fromJSON()` are never called. All sub-agent reasoning/tool/tree history is lost on harness restart, mode switch, or server restart. | 🟠 High |
| 2.7 | `recordReasoning` (`metrics.js:244-253`) increments a "reasoningSteps" counter once per streaming *token chunk*, not per logical reasoning turn — a mislabeled metric that's also never sent to the frontend at all. | 🟡 Medium |
| 2.8 | Per-tool and per-phase latency (`latency.perTool`, `latency.perPhase`) are tracked and persisted but **never included** in the frontend payload — a category the user perceives as "not tracked" that's actually collected and just invisible. `startPhase`/`endPhase` are additionally dead code (never called). | 🟡 Medium |
| 2.9 | **Confirmed live bug:** `useWebSocket.ts:58` dispatches `updateMetrics({ toolCalls: (state) => (state||0)+1 })` — passing a function where the reducer (`AegisProvider.tsx:137`) does a plain assignment. `metrics.toolCalls` becomes a stringified function object for the duration of every tool call, until the next full sync overwrites it. | 🟠 High |
| 2.10 | **Confirmed live bug:** backend `actionFeed` entries use `{type: "tool_call", toolName, latencyMs, ...}`; the frontend Action Feed (`MetricsPanel.tsx:468-509`) reads `feed.text`, `feed.type === "start"`, `feed.timestampEnd` — none of which the backend ever sets. Every feed entry renders "undefined... Completed at undefined." | 🟠 High |
| 2.11 | **Confirmed live bug:** `AgentTab.tsx:20` renders `` `${metrics.latency}s` `` but the backend sends milliseconds (`metrics.js:444`) — a 3-second tool call displays as "3000s." | 🟡 Medium |
| 2.12 | Persistence is snapshot-only: `sessions.metrics` is a single JSON blob overwritten on every save. No history table, no per-turn ledger — only the latest cumulative state survives. | 🟡 Medium |

---

## 3. TTS Engine

**Verdict: the underlying design (sentence-level `<tts>` tag streaming from an self-hosted OpenAI-compatible "pocket-tts" server) is genuinely good and the previously-fixed "double playback" bug holds up under inspection. The gaps are all in surrounding integration polish, matching the user's framing that the engine itself is fine.**

| # | Finding | Severity |
|---|---|---|
| 3.1 | Mute toggle (`page.tsx:540-543`) only flips state — never calls `stopSpeaking()`. Audio already queued/fetched keeps playing after the user hits mute. | 🟠 High (UX) |
| 3.2 | `useTTS.ts:53` creates a blob URL per spoken sentence via `URL.createObjectURL` — never revoked anywhere in the file. Long sessions accumulate live blob references (memory leak). | 🟡 Medium |
| 3.3 | No barge-in / interrupt support: nothing stops TTS when the user starts speaking, and the mic isn't muted while TTS is talking — real risk of the agent's own voice being picked up by STT. | 🟠 High (matches the multi-device/voice ambition) |
| 3.4 | Backend fully buffers each sentence's audio (`routes/models.js:61-64`, `await response.arrayBuffer()`) instead of piping the upstream stream directly — adds a full round-trip of latency per sentence on top of generation time. | 🟡 Medium |
| 3.5 | No autoplay-block feedback: a rejected `audio.play()` (common before any user gesture) is silently skipped with zero UI indication that speech is blocked, not broken. | 🟢 Low |
| 3.6 | `services/tts.js` does no audio synthesis — it's an LLM summarization call used as a fallback when the model doesn't emit a `<tts>` tag, adding a second LLM round-trip (latency + cost) that better prompting could remove entirely. | 🟢 Low (naming is also misleading) |
| 3.7 | No per-session/per-agent voice profile — `selectedVoice` is one global piece of UI state, so two concurrent agent sessions can't be told apart by voice. | 🟢 Opportunity |
| 3.8 | Provider endpoint (`127.0.0.1:6767`) and model name (`"pocket-tts"`) are duplicated independently in two places in `routes/models.js` with no shared config. | 🟢 Low |

---

## 4. UI / Frontend

**Verdict: nothing is a hard crash (the app builds and type-checks clean) — the "broken/college-project" feeling is real but comes from a handful of systemic causes, not scattered surface bugs. Fix these four things and the whole app reads differently.**

| # | Finding | Severity |
|---|---|---|
| 4.1 | **Confirmed critical bug** — `hooks/useTheme.ts:61-65`: `root.classList.add('dark'); root.classList.remove('dark');` adds then immediately removes the class in the same branch. Since every shadcn primitive (`button.tsx`, `input.tsx`, `select.tsx`, `switch.tsx`) relies on Tailwind `dark:` variants gated on `.dark` being present on `<html>`, those variants **can never activate**. The app only "looks dark" because raw CSS-var fallbacks happen to be dark — shadcn primitives visually diverge from hand-styled components in both themes. This is a direct, mechanical explanation for "UI inconsistencies." | 🔴 Critical |
| 4.2 | **Two incompatible styling systems coexist**: shadcn primitives (`components/ui/*`) use pure Tailwind + theme tokens; ~29 of ~40 other component files use inline `style={{...}}` with hardcoded px/rem + `var(--...)` strings (440 occurrences of `style={{` total). This is the structural root of the visual inconsistency, not a nitpick. | 🔴 Critical |
| 4.3 | `--radius` is referenced in `globals.css`'s `@theme inline` block (used to derive `--radius-sm/md/lg/xl/2xl/3xl/4xl`) but **never defined anywhere** — any `rounded-*` utility mapped through these tokens computes an invalid value. | 🟠 High |
| 4.4 | `app/page.tsx` (580 lines, `DashboardInner`) holds 23 separate `useState` calls plus a *separate* `useReducer`-based context (`AegisProvider`) — state is split-brained between the two. Concrete evidence: 27+ individually-named props (each with its own setter) passed into a single `<SettingsPanel>` call — textbook prop-drilling. | 🟠 High |
| 4.5 | Dead/orphaned files: `layout/RightPanelShell.tsx` (not imported anywhere, starts with `// @ts-nocheck`), `ui/kbd.tsx`, `ui/scroll-area.tsx` (scaffolded, never used). `ComponentErrorBoundary` accepts a `fallback` prop that's never rendered and is itself never used — only the plain full-page `ErrorBoundary` wraps the entire app once, meaning any single-widget render error takes down the whole dashboard. | 🟠 High |
| 4.6 | Accessibility: only 14 `aria-*` usages in the whole `src` tree, mostly from library primitives. Hand-written interactive elements are plain `<div onClick>` with no `role`/`tabIndex`/keydown handling (e.g. `WorkspaceTab.tsx:93,103`, `ChatMessage.tsx:120,166`, `AgentTab.tsx:111`) — keyboard-inaccessible. | 🟡 Medium |
| 4.7 | Two independent responsive systems doing the same job with different breakpoints: `hooks/useResponsive.ts` (JS, 768/1024px) branches entire JSX trees, while `globals.css` media queries (767/1023px) *also* reposition the same elements. Likely source of subtly inconsistent responsive behavior. | 🟡 Medium |
| 4.8 | Minor: raw `<img>` for screenshots instead of Next's `<Image>`, forgoing optimization. | 🟢 Low |

---

## 5. Documentation cleanup (done)

Removed as part of this investigation — all superseded, and in places factually wrong when checked against current code (e.g. claimed a hardcoded API key and a missing `os` import that do not exist in the current source):

- `plan/BACKEND-PLAN.md`, `plan/FRONTEND-PLAN.md`, `plan/IMPLEMENTATION-MASTER.md`, `plan/MASTER-GAP-ANALYSIS.md`
- `temp-test/BACKEND-PLAN.md`, `temp-test/FRONTEND-PLAN.md` (untracked, older "WebOS" naming, fully superseded)
- `progress.md` (referenced a `plan/UI-UX-OVERHAUL.md` that no longer exists)

**Still stale, not yet addressed:** the root `README.md` describes the stack as "Vite + React + Vanilla CSS" — it's actually Next.js 16 + React 19 + Tailwind 4. Worth a rewrite once the architecture settles rather than twice.

---

## Priority Matrix (all areas combined)

| Priority | Item | Area |
|---|---|---|
| 🔴 P0 | No auth on HTTP routes or WS upgrade — fail-open middleware, unauthenticated socket | Auth |
| 🔴 P0 | Dark mode class add-then-remove bug | UI |
| 🔴 P0 | Sub-agent tool calls never recorded (`startToolCall` never invoked) | Metrics |
| 🔴 P0 | Sub-agent metrics never persisted (`addSubagent` family dead code) | Metrics |
| 🔴 P0 | Dual styling system (inline styles vs Tailwind) | UI |
| 🟠 P1 | No device/session identity model (blocks URL+OTP entirely) | Auth |
| 🟠 P1 | Global (not per-device/session) policy config | Auth |
| 🟠 P1 | No real cost tracking; token counts are heuristic, not real usage | Metrics |
| 🟠 P1 | `toolCalls` reducer type-confusion bug; Action Feed field mismatch; latency unit mismatch | Metrics |
| 🟠 P1 | `--radius` undefined; monolithic `page.tsx`; dead error-boundary/orphaned components | UI |
| 🟠 P1 | TTS mute doesn't stop playback; no barge-in/interrupt coordination with STT | TTS |
| 🟡 P2 | Sub-agent tree fully ephemeral (no persistence across restarts) | Metrics |
| 🟡 P2 | Blob URL leak; buffered (non-streamed) TTS proxy | TTS |
| 🟡 P2 | Accessibility gaps on hand-rolled interactive elements | UI |
| 🟢 P3 | Per-session TTS voice profiles; README rewrite; duplicated TTS config constants | Misc |

---

## What this means for the three things you asked about

1. **Metrics/observability** — this is fixable without a redesign: most of the wiring exists (`SubagentTracker`, per-tool latency, action feed shape) and just needs the dead call-sites connected and the frontend field names corrected. Real cost/token accounting needs a new source of truth (parse actual provider `usage` from LiteLLM responses instead of estimating from character counts).
2. **URL + OTP multi-device pairing** — this is a genuinely new subsystem: device identity, token issuance, per-device policy scoping, and a WS auth handshake, layered on top of (not instead of) the existing session/harness model. It's the most architecturally invasive of the four asks.
3. **UI overhaul** — the "college project" feeling traces to a small number of root causes (dead dark-mode toggle, two competing styling systems, one 580-line god component, orphaned scaffolding) rather than needing a ground-up rebuild. A worthwhile question before I draft the phased plan: how much of the *component inventory* (chat, panels, settings, monitoring) do you want to keep and re-skin vs. rebuild from scratch on a single design system?

Next: a short discussion on UI direction, then the phased implementation plan.
