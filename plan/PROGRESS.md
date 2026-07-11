# AegisAgent — Implementation Progress

> Tracks execution of `plan/IMPLEMENTATION-PLAN.md` against the approved mock
> (`plan/aegis-console-mock.html`). Updated 2026-07-11.

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
- Note: pre-existing sub-agent wiring in `server.js` was already connected in an earlier commit (the plan's "dead call-sites" claim was stale).

## Phase 2 — Console rebuild ✅
- ✅ Icon rail (Console / Fleet / Connectors / Policies / Settings)
- ✅ Inspector segments: Overview / Workspace / Trace / Logs
- ✅ **Trace** = end-to-end sub-agent view; fixed backend clobber of the full summary
- ✅ Tokens-per-turn in/out chart (CVD-validated colors, both themes)
- ✅ Reasoning as per-turn inline accordions ("not spoken")
- ✅ Fleet / Connectors / Policies views; removed "Paired devices 0" footer row

## Phase 2b — Effort profiles + Mission 🟡
- ✅ **Effort profiles** fast / balanced / deep — model routing + planning depth, resolved model threaded to the harness; composer EffortSelector chip
- ⬜ **Mission view** — deferred: needs the harness to emit structured plan events (phase/task/status); pi does not currently provide them

## Phase 3 — Identity, pairing, remote 🟡
- ✅ Device identity + URL/OTP pairing (tables, token issuance, WS + HTTP auth) — pre-existing, verified
- ✅ **Device scopes** (schema v6): full / chat_voice / read_only chosen at pairing, enforced on start_task (read-only denied, chat_voice pinned to chat mode); Fleet scope selector + per-device badges
- ✅ **Concurrent sessions**: removed kill-sibling-session behavior
- ⬜ Remote harness `aegis-adapter` transport (WS bridge for opencode/others) + multi-instance registry — Fleet UI is the front end; transport not built

## Phase 4 — Policies & budgets 🟡
- ✅ Enforced budgets: per-session cost + token caps (halt at turn start), sub-agent depth cap; `budget_exceeded` surfaced
- ✅ Editable Budgets section in Policies view
- ✅ Config **hot-reload** — fixed `getConfig()` startup-snapshot bug
- ✅ Config save no longer kills every session
- ✅ Read-only capability × mode matrix reflecting current enforcement
- ⬜ Editable per-cell policy matrix (needs policy-engine-v2 storage that safely replaces the working mode-gate + security-guard enforcement)
- ⬜ Per-device policy overrides (`devices.policy_overrides` column exists, unused)

## Phase 5 — Connectors & skills ✅
- ✅ **MCP connector registry** — `McpRegistry` owns `.pi/mcp.json`; GET/POST/DELETE `/api/connectors`; live per-connector status + tool listing; stdio + remote HTTP transports; ConnectorsView add/remove UI. Verified live against a real `@modelcontextprotocol/server-filesystem`.
- ✅ Skills: `skills/<name>/SKILL.md` packs; `/api/skills`; appended to system prompt (sub-agents inherit); composer SkillSelector; seeded 3 skills
- ✅ Prompt library: `/api/prompts` over `prompts/*.md`; composer picker; traversal-safe id resolution
- 🟡 Settings-page management UI for prompts/skills (managed via composer + files today)

## Phase 6 — Voice polish + hardening 🟡
- ✅ Barge-in; TTS mute stops playback; blob URLs revoked
- ✅ TTS streamed (not buffered); endpoint/model deduped into constants
- ✅ Autoplay-blocked indicator
- ✅ README updated to the rebuilt architecture
- ✅ Orphan removal (`ExecutionPlan.tsx`, `ui/scroll-area.tsx`); `@ts-nocheck` removed from ChatArea/ChatInput
- 🟡 Broader a11y sweep + remaining `@ts-nocheck` removal (24 files still suppressed; mostly shadcn primitives + pre-existing components)

---

## Deferred (with rationale)
1. **Editable policy matrix + per-device overrides** — enforcement is currently spread across `server.js` mode gates + `security-guard.js`. A safe editable matrix needs a policy-engine-v2 that consolidates and replaces that logic; rushing it risks the working guardrails. Budgets (the enforced half of Phase 4) are done.
2. **Remote harness adapter** — device identity + pairing + scopes are done; the remaining piece is the `aegis-adapter` CLI + authenticated WS transport that lets a harness dial in from another machine. New subsystem.
3. **Mission view** — a projection over structured plan events the harness must emit first.

## Commits (this effort, newest first)
- `feat: Phase 2b — effort profiles (fast/balanced/deep)`
- `feat: Phase 3 — device scopes + concurrent sessions`
- `feat: Phase 5 — MCP connector registry`
- `feat: Phase 5 skills system + Phase 6 TTS streaming/config dedupe`
- `feat: Phase 6 — autoplay-blocked voice indicator`
- `feat: Phase 4 (part) — enforced budgets + config hot-reload`
- `feat: prompt library + voice barge-in`
- `feat: Phase 2 console rebuild — icon rail IA, inspector segments, trace + reasoning`
- `feat: Phase 1 metrics truth — provider-reported usage, turn ledger, directional cost`
