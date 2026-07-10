# AegisAgent — Implementation Progress

> Tracks execution of `plan/IMPLEMENTATION-PLAN.md` against the approved mock
> (`plan/aegis-console-mock.html`). Updated 2026-07-10.

## Legend
✅ done & verified · 🟡 partial · ⬜ not started

---

## Phase 1 — Metrics truth ✅
- ✅ Harness normalizes provider `usage` (any key spelling) → standard `usage` event
- ✅ Schema v2: `tokens.reported` accumulators; first real usage flips session estimated→reported (source-tagged; per-sub-agent credit)
- ✅ Directional $/1M pricing (in/out split; reasoning bills as output)
- ✅ Per-turn ledger (`beginTurn`/`endTurn`) — persisted, capped 100; source-flip-safe baselines
- ✅ `usage_update` WS message; frontend passes through tokensIn/Out/Reasoning, source, turns; honest estimated-vs-reported labels
- ✅ `agent-backend/PROTOCOL.md` documents both wire boundaries
- Note: pre-existing sub-agent wiring in `server.js` (spawn/tool/reasoning/complete) confirmed live; the plan's "dead call-sites" were already connected in an earlier commit.

## Phase 2 — Console rebuild ✅
- ✅ Icon rail (Console / Fleet / Connectors / Policies / Settings) replaces header-tab sprawl
- ✅ Inspector segments: Overview / Workspace / Trace / Logs (Settings is a page; clipped 5th tab gone)
- ✅ **Trace** = end-to-end sub-agent view (task, own reasoning, tool calls + latency, tokens, lineage colors); fixed backend bug where active-only list clobbered the full summary
- ✅ Tokens-per-turn in/out chart (CVD-validated colors, both themes)
- ✅ Reasoning as per-turn inline accordions ("not spoken")
- ✅ Fleet / Connectors / Policies views; removed "Paired devices 0" footer row

## Phase 4 — Policies & budgets 🟡
- ✅ Enforced budgets: per-session cost + token caps (halt at turn start), sub-agent depth cap (blocks over-deep spawns); `budget_exceeded` surfaced in UI
- ✅ Editable Budgets section in Policies view
- ✅ Config **hot-reload** — fixed `getConfig()` returning a startup snapshot (no config change took effect without restart)
- ✅ Config save no longer kills every session — only model/prompt changes cycle sessions
- ✅ Read-only capability × mode matrix reflecting current enforcement
- ⬜ Editable per-cell policy matrix (needs policy-engine-v2 storage schema)
- ⬜ Per-device policy overrides

## Phase 5 — Connectors & skills 🟡
- ✅ Skills: `skills/<name>/SKILL.md` packs; `GET /api/skills`; `resolveSkills()` appends bodies to system prompt (sub-agents inherit); composer SkillSelector; seeded code-review / security-audit / workspace-snapshot
- ✅ Prompt library: `GET/POST /api/prompts` over `prompts/*.md`; composer picker; harness resolves any library id (traversal-safe); mode directives appended on top
- ✅ Connectors view shows live lightpanda MCP status
- ⬜ MCP connector **registry** (add/remove connectors beyond lightpanda)
- ⬜ Settings-page management UI for prompts/skills (managed via composer + files today)

## Phase 6 — Voice polish + hardening 🟡
- ✅ Barge-in: mic start stops TTS immediately
- ✅ TTS mute stops playback; blob URLs revoked (pre-existing, confirmed)
- ✅ TTS streamed through instead of buffered; endpoint/model deduped into constants
- ✅ README updated to the rebuilt architecture
- ✅ Autoplay-blocked indicator (one-time hint when the browser blocks play())
- ⬜ Accessibility sweep; remove remaining `@ts-nocheck`; delete orphaned components

## Phase 3 — Remote harness / identity ⬜ (deferred)
- Device identity table + real OTP token issuance, `aegis-adapter` remote transport, multi-instance harnesses, remove kill-sibling-session behavior. Fleet UI + pairing countdown are in place as the front end for this.

## Phase 2b — Mission view + effort profiles ⬜ (deferred)
- Needs the harness to emit structured plan events (phase/task/status) before Mission can be more than a projection; effort profiles need model-routing config.

---

## Commits (this effort, newest first)
- `feat: Phase 5 skills system + Phase 6 TTS streaming/config dedupe`
- `feat: Phase 4 (part) — enforced budgets + config hot-reload`
- `feat: prompt library + voice barge-in`
- `feat: Phase 2 console rebuild — icon rail IA, inspector segments, trace + reasoning`
- `feat: Phase 1 metrics truth — provider-reported usage, turn ledger, directional cost`
