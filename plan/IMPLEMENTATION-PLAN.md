# AegisAgent — Phased Implementation Plan

> **Date:** 2026-07-10
> **Companion doc:** [`INVESTIGATION-REPORT.md`](./INVESTIGATION-REPORT.md) — every item below traces to a verified finding there.
> **Sequencing (confirmed):** correctness/security bugs first → UI overhaul → metrics accuracy → auth/multi-device pairing. Each phase is independently shippable; don't build the redesign or new subsystems on top of the known-broken state.

---

## Design system for Phase 1 (confirmed direction)

- **Single styling system**: shadcn/ui primitives + Tailwind tokens only. No hand-rolled `style={{...}}` objects. This directly kills the dual-system root cause (Investigation §4.2).
- **Light theme is default and primary**; dark theme is a first-class second pass built on the same tokens — not the other way around, since the current dark-mode bug (§4.1) means light is the only theme that's ever actually been visually verified.
- **Depth via layered surface tokens**, shared across both themes: `surface-0` (page background) → `surface-1` (cards/panels) → `surface-2` (raised panels, sidebars) → `surface-3` (overlays: modals, popovers, command palette, toasts). Each layer step gets a small shadow/border/elevation bump.
- **Frost/blur reserved for `surface-3` only** — modals, the command palette, popovers, floating notification toasts, and the right detail panel when it's a mobile overlay. Everything below that is flat, clean shadcn. This gives "character" without the everything-is-glass look that reads as unfinished.
- Fix `--radius` (Investigation §4.3) as part of standing up the token set — it's currently referenced but undefined.

---

## Phase 0 — Correctness & Security Bug Fixes

**Goal:** stop building on top of known-broken state. All items here are small, mechanical, and independently testable — no architectural risk.

| Item | File(s) | Why first |
|---|---|---|
| Fix dark-mode class toggle (`add` then immediate `remove`) | `hooks/useTheme.ts:61-65` | Blocks any real verification of the dark theme during the Phase 1 redesign |
| Make auth middleware actually deny when unauthenticated, or explicitly document it as dev-mode-only with a loud startup warning | `middleware/auth.js:10-14` | Currently silently fail-open; must be true before any network exposure beyond localhost |
| Add minimal WS handshake check (shared secret / session-scoped token) as a stopgap ahead of full pairing in Phase 3 | `ws/index.js:9-17` | Same reason — cheap now, full solution is Phase 3 |
| Wire `SubagentTracker.startToolCall`/`endToolCall` into the `subagent_tool_start`/`subagent_tool_end` event handlers | `server.js` (handler section), `subagent-tracker.js:217-243` | This is the single biggest correctness gap against "track tool calls for sub-agents" — currently a no-op |
| Wire `metrics.js` `addSubagent`/`updateSubagent`/`addSubagentToolCall`/`completeSubagent` call sites | `server.js`, `metrics.js:326-411` | Sub-agent data is currently never persisted — dead code sitting next to the exact feature the user asked for |
| Fix `parentId` hardcoded to `null` on subagent spawn | `server.js:395` | Required for the nested tree the UI already renders to ever show real nesting |
| Fix `toolCalls` reducer type-confusion bug (function passed instead of number) | `hooks/useWebSocket.ts:58`, `providers/AegisProvider.tsx:137` | Visibly broken tile during every tool call today |
| Fix Action Feed field mismatch (`feed.text`/`type==="start"`/`timestampEnd` vs. actual backend shape) | `metrics.js:224-230`, `components/MetricsPanel.tsx:468-509` | Every feed entry currently renders "undefined...Completed at undefined" |
| Fix latency unit mismatch (ms rendered as "s") | `metrics.js:444`, `panels/AgentTab.tsx:20` | Trivial fix, visibly wrong number today |
| TTS: mute should call `stopSpeaking()`, not just flip state | `page.tsx:540-543` | Currently audio keeps playing after mute |
| TTS: revoke blob URLs after playback | `hooks/useTTS.ts:53` | Memory leak on long sessions |

**Exit criteria:** dark mode toggles correctly; sub-agent tool calls show real data end-to-end for at least one nested sub-agent; the three frontend metric-display bugs are gone; mute actually mutes.

---

## Phase 1 — UI Overhaul

**Scope (confirmed): re-skin, not rebuild.** Keep the current component inventory and information architecture (chat, detail panel tabs, settings, monitoring) — consolidate the styling layer underneath it.

1. **Tokens** — stand up the surface/depth/radius/spacing/typography token set described above; light theme first, dark theme second, both against the same tokens so they can't drift again.
2. **Migrate inline styles → Tailwind/shadcn** across the ~29 files currently using `style={{...}}` (chat, panels, layout, monitoring). Mechanical, file-by-file, testable by visual diff.
3. **Selective frost treatment** on `surface-3` components only: command palette (new, see Phase 1 polish below), modals, popovers, notification toasts, mobile overlay panels.
4. **Break up `page.tsx`** (580 lines, 23 `useState` calls, 27-prop drilling into `SettingsPanel`) — consolidate settings state into one object/reducer slice instead of individually-named state+setter pairs, and move remaining page-level orchestration into the existing hook pattern (`useSessions`, `useAgent`, `useTTS`, `useSTT`) rather than leaving it inline.
5. **Remove or wire up dead/orphaned files**: `layout/RightPanelShell.tsx` (unused, `@ts-nocheck`), `ui/kbd.tsx`, `ui/scroll-area.tsx` (unused scaffolding). Fix `ComponentErrorBoundary`'s unused `fallback` prop and actually wrap individual panels with it instead of one full-page boundary around the whole app — a render error in one widget shouldn't take down the dashboard.
6. **Collapse the duplicate responsive system** — pick one source of truth (recommend the JS `useResponsive` hook driving conditional rendering) and remove the parallel CSS-media-query repositioning in `globals.css`, aligning the breakpoints (currently 768/1024 in JS vs. 767/1023 in CSS).
7. **Accessibility pass** on hand-rolled interactive elements (`WorkspaceTab.tsx`, `ChatMessage.tsx`, `AgentTab.tsx`) — real `role`/`tabIndex`/keydown handling, not just visual parity.
8. **Product-polish items** (these are what actually make it feel "finished," not just "consistent"): loading/skeleton states for config/model/session fetches, message timestamps, message actions (copy, retry, edit-and-resend), confirmation dialogs for destructive actions (delete session, kill agent, YOLO mode acknowledgment), command palette (`Ctrl+K`), notification center, keyboard shortcuts.
9. **Voice UX polish** (pairs with Phase 0's TTS fixes): barge-in — stop TTS when the user starts speaking, mute the mic while TTS is speaking so the agent can't hear itself; autoplay-block feedback instead of silently skipping; per-session voice assignment so concurrent agents are distinguishable by voice.

**Exit criteria:** zero `style={{...}}` occurrences outside genuinely dynamic values (e.g. computed positions); one design system; light and dark both visually verified; `page.tsx` under ~150 lines; no orphaned files.

---

## Phase 2 — Metrics & Observability Accuracy

**Goal:** the scaffolding already exists (nested tree, per-tool latency, action feed) — this phase is about real data sources and surfacing what's already collected, not new architecture.

1. **Real token accounting** — parse actual `usage`/`prompt_tokens`/`completion_tokens` from LiteLLM responses instead of the character-count heuristic (`estimateTokens`). Flip `tokens.estimated` to reflect ground truth vs. fallback per-call.
2. **Real cost tracking** — add a model pricing table and compute actual cost from real token counts; wire it into the `metrics.cost` field the frontend already has a tile for.
3. **Surface already-collected data**: `latency.perTool` and `latency.perPhase` exist and persist but never reach the frontend — add them to `toFrontendUpdate()` and a corresponding UI breakdown (e.g. per-tool latency chart in the Agent tab).
4. **Persist `SubagentTracker` across restarts** — wire the existing `toJSON()`/`fromJSON()` methods into session save/load instead of losing sub-agent history on every harness restart.
5. **Move from snapshot-blob to a real ledger** (stretch goal, evaluate after 1-4 land): a per-turn metrics table instead of overwriting one JSON blob per session, enabling metrics-over-time views instead of only "current state."
6. **Reasoning tracking correction** — `reasoningSteps` currently counts streaming chunks, not logical turns; redefine and surface it meaningfully, or drop it if chunk-count isn't a useful signal.

**Exit criteria:** a session's metrics panel shows real (not estimated) token counts and a real cost figure; per-tool latency is visible in the UI; sub-agent metrics survive a harness restart.

---

## Phase 3 — Auth Layer + Multi-Device Harness Connection (URL + OTP pairing)

**Goal:** the feature that doesn't exist yet at all — most architecturally invasive phase, correctly sequenced last since it depends on Phase 0's auth stopgap and benefits from Phase 1/2's stabilized surfaces.

1. **Device/connection identity model** — new DB table (`devices`: id, label, created_at, last_seen, revoked_at), replacing the current "sessionId is the only identity" model.
2. **Pairing flow** — `POST /api/pair/start` generates a short-lived OTP + a pairing URL (dashboard-hosted, scannable/shareable); the connecting harness/device redeems the OTP once for a long-lived device token. OTP expiry (e.g. 5 min) and single-use enforcement.
3. **WS auth handshake** — the upgrade handler validates a device token before accepting the connection or processing any message (replaces the Phase 0 shared-secret stopgap).
4. **Re-key session state by `(deviceId, sessionId)`** instead of `sessionId` alone; remove the "kill sibling session on this socket" behavior (`server.js:102-109`) so multiple agents on one device and N concurrent devices are both real, supported states.
5. **Per-device policy scoping** — `security-guard` config resolved per device instead of one global object; eliminate the `process.env.AEGIS_MODE` global fallback (a live cross-session race today) in favor of the mode already being passed explicitly as a parameter.
6. **Device management UI** — a panel to view paired devices, see which is active, rename, and revoke access; pairing URL/OTP display flow for adding a new device.

**Exit criteria:** two physically separate devices can each pair via URL+OTP, run independent agent sessions concurrently, with policy and metrics correctly scoped per device and no cross-device state bleed.

---

## Rough Sequencing / Effort

| Phase | Focus | Relative effort | Depends on |
|---|---|---|---|
| 0 | Correctness/security bug fixes | Low (days) | — |
| 1 | UI overhaul (re-skin) | Medium-High | Phase 0 (esp. dark mode + error boundaries) |
| 2 | Metrics accuracy | Medium | Phase 0 (subagent tracking wiring) |
| 3 | Auth + device pairing | High | Phase 0 (auth stopgap), benefits from 1/2 being stable |

Phases 1 and 2 don't depend on each other and can run concurrently once Phase 0 is done, if you want to parallelize. Phase 3 should stay last — it's the biggest net-new subsystem and the one most likely to reshape assumptions (`activeSessions` keying, policy scoping) that the other phases touch.
