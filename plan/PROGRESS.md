# AegisAgent — Implementation Progress

> Tracks execution of `plan/IMPLEMENTATION-PLAN.md` against the approved mock
> (`plan/aegis-console-mock.html`). Updated 2026-07-11.

## Legend
✅ done & verified · 🟡 partial

---

## Phase 1 — Metrics truth ✅
- Provider-reported `usage` normalized → `usage` event; schema v2 `tokens.reported`; estimated→reported flip (source-tagged, per-sub-agent credit)
- Directional $/1M pricing; per-turn ledger (persisted, source-flip-safe)
- `usage_update` WS message; honest estimated-vs-reported UI labels; `PROTOCOL.md`
- **Confirmed live**: a real deep session reported 68,361 tok (59k in / 9.3k out) and $0.01 from reported usage.

## Phase 2 — Console rebuild ✅
- Icon rail (Console / Fleet / Connectors / Policies / Settings); inspector segments Overview / Workspace / Trace / Logs
- **Trace** = end-to-end sub-agent view; tokens-per-turn chart; per-turn reasoning accordions
- Fleet / Connectors / Policies views

## Phase 2b — Effort profiles + Mission ✅
- **Effort profiles** fast / balanced / deep — model routing + planning depth, threaded to the harness; composer chip
- **Mission view** — Timeline ⇄ Mission toggle; live projection of the real execution plan into a phase board + sub-agent overlay (parses pi's real STEP/[TODO] format). Verified populated in a live deep+plan session.

## Phase 3 — Identity, pairing, scopes, remote ✅
- Device identity + URL/OTP pairing (verified); **device scopes** (full / chat_voice / read_only) enforced on start_task
- **Concurrent sessions** (kill-sibling removed)
- **Remote harness adapter**: `aegis-adapter` CLI redeems a pairing code, connects over authenticated WS, runs a local pi and bridges every event; backend `RemoteHarness` + `/api/harnesses`; composer harness picker. Verified end-to-end: a remote adapter registered and a session ran through it, streaming back to the dashboard.

## Phase 4 — Policies & budgets ✅
- Enforced budgets (cost / token / sub-agent-depth caps); config hot-reload; save no longer kills sessions
- **Editable capability × mode matrix** via `policy-engine.js` (allow/ask/block) — the source of truth the backend enforces, replacing hardcoded mode gates; click-to-cycle UI, persisted
- **Per-device overrides** (tighten-only) — DB + `PATCH /api/devices/:id/policy` + engine enforcement. Verified: global allow→block for one device only.

## Phase 5 — Connectors & skills ✅
- **MCP connector registry** — `McpRegistry` owns `.pi/mcp.json`; GET/POST/DELETE `/api/connectors`; live status + tool listing; stdio + remote HTTP; add/remove UI. Verified against a real `@modelcontextprotocol/server-filesystem`.
- Skills (`skills/*/SKILL.md`, `/api/skills`, composer picker, sub-agent inheritance); prompt library (`/api/prompts`, traversal-safe)

## Phase 6 — Voice polish + hardening 🟡
- ✅ Barge-in; TTS mute stops playback; blob URLs revoked; TTS streamed; autoplay indicator; endpoint/model constants
- ✅ README updated; orphan removal; `@ts-nocheck` dropped from composer files
- 🟡 Broader a11y sweep + remaining `@ts-nocheck` on pre-existing/shadcn files (functional, low-risk backlog)

---

## Remaining backlog (small, non-blocking)
- Broader accessibility sweep and removal of the remaining `@ts-nocheck` suppressions (mostly shadcn primitives + older components).
- Mission parser is best-effort over free-form plans; it would sharpen if the harness emitted structured plan events (phase/task/status/owner) — a harness-capability enhancement, not a console gap.
- The `ask` policy decision surfaces an approval gate but is advisory (pi in rpc mode doesn't pause mid-tool); a true blocking-ask needs a harness permission callback.

## Commits (this program, newest first)
- `feat: Phase 2b — Mission view (live projection over real plan + sub-agents)`
- `feat: Phase 3 — remote harness adapter (harness-agnostic, dial-in)`
- `feat: Phase 4 complete — editable policy matrix + per-device overrides`
- `feat: Phase 2b — effort profiles (fast/balanced/deep)`
- `feat: Phase 3 — device scopes + concurrent sessions`
- `feat: Phase 5 — MCP connector registry`
- `feat: Phase 5 skills system + Phase 6 TTS streaming/config dedupe`
- `feat: Phase 6 — autoplay-blocked voice indicator`
- `feat: Phase 4 (part) — enforced budgets + config hot-reload`
- `feat: prompt library + voice barge-in`
- `feat: Phase 2 console rebuild — icon rail IA, inspector segments, trace + reasoning`
- `feat: Phase 1 metrics truth — provider-reported usage, turn ledger, directional cost`
