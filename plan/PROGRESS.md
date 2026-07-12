# Orbit — Implementation Progress

> Tracks execution of `plan/IMPLEMENTATION-PLAN.md` against the approved mock
> (`plan/orbit-console-mock.html`). Updated 2026-07-11.

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
- **Remote harness adapter**: `orbit-adapter` CLI redeems a pairing code, connects over authenticated WS, runs a local pi and bridges every event; backend `RemoteHarness` + `/api/harnesses`; composer harness picker. Verified end-to-end: a remote adapter registered and a session ran through it, streaming back to the dashboard.

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

## UX Hardening & Capability Batch (July 2026) ✅
> Full handoff: **`plan/UX-HARDENING-PLAN.md`**.

- ✅ Metrics reliability: session-switch reset fixed (client can't clobber backend-owned metrics) + **turn-end DB upsert** (fixed reset-on-refresh); reported usage authoritative, estimate never shown as truth.
- ✅ Durable chat (persist on turn settle) + streaming flicker fix (memoized `ChatMessage` + stick-to-bottom autoscroll).
- ✅ Active device shown in header; Mission board renders live `[TODO]/[DONE]` checklist status.
- ✅ **Fleet (orchestrated lead)**: `orbit-fleet` MCP server + `fleet.js` + `/api/fleet`; delegate to device → headless run → answer back; shows as sub-agent lanes. Auto-registered in `.pi/mcp.json`.
- ✅ **Two-way Telegram bridge** (`telegram-bridge.js`): pairing-gated inbound + outbound alerts. `TELEGRAM_DISABLE=1` opt-out.
- ✅ **Preview + Console** inspector tabs (Live iframe / File render; operator shell via `/api/console/exec`).
- ✅ API key generated (inactive in gitignored `.env`).
- ✅ **Notifications split + systemic notify tool + self-docs (item 2):** `notify-bus.js` (one bus → typed `web`/`desktop`/`channel` sinks; web & channel no longer cross-pollute); `mcp-server-notify` (`orbit-notify`: `send_message`/`notify`, a **network** tool that kills the chat-mode shell escalation — no more `bash`+curl); `prompts/orbit-system.md` self-docs prompt always injected; `./orbit-notify` bash instruction removed from all prompts.
- ✅ **Layout cleanup (item 3):** removed the duplicate settings Cog from the icon rail (header gear is the single entrypoint); desktop sessions sidebar now collapses via a header toggle; composer chips (Profile/Harness/Prompt/Effort/Skills) collapsed behind a **⚙ Run config** popover, leaving Mode + mic + Send inline.

---

## Reliability, Web & Plan Batch (July 12, 2026) ✅ built · ⚠️ not yet committed / needs restart+rebuild to go live
> All verified in isolation (unit + screenshots); **the user's running backend/dashboard were stale during testing** — restart `server.js` + rebuild the dashboard to actually run this.

- ✅ **Stop button during bash — fixed.** pi spawns `detached` (own process group); `cancel()` kills the whole group (SIGTERM→SIGKILL) + rpc cancel. The old bare-PID kill left in-flight `curl`/`bash` running. Verified: group-kill takes down the child tree.
- ✅ **Web search (fixes the "spiral").** Root cause: no working *search* (Lightpanda reads URLs but can't query engines; engines captcha-block bots). Added `mcp-server-search` (`orbit-search`, keyless DuckDuckGo-HTML) verified on the exact query that spiraled. Priority: native pi `web_search` **only if a key is configured** (else skipped so it never pops the Google sign-in) → `orbit-search` → Lightpanda reads result URLs. Search=find / Lightpanda=read, direct-nav-first, never scrape engines — in `orbit-system.md`.
- ✅ **Anti-flail stop.** A turn is force-cancelled after 40 tool calls or 6 consecutive empty/errored results (+ message + notification). Classifier verified.
- ✅ **Video transcripts.** `mcp-server-transcript` (`orbit-transcript`, InnerTube) — Lightpanda can't read YouTube captions; this returns the real transcript. Verified (51k-char Hindi captions). Earlier "report from transcript" was **not** fabrication — the agent had pip-installed `youtube-transcript-api` via bash; the transcript tool replaces that fragile improvisation.
- ✅ **Lightpanda = essential service.** `lightpanda.js` auto-ensures the browser container on boot with `--restart unless-stopped` (it had died 32h ago and nothing restarted it → agents went web-blind → `code_search`/hallucination). Verified create/revive/boot paths.
- ✅ **Web-access model.** SEARCH vs BROWSE split; `network: chat` → `allow` (browsing shouldn't force a mode change); native web-access tools gated by `config.webAccess.enabled` (Lightpanda mandatory browser).
- ✅ **Anti-fabrication guards.** `orbit-system.md`: never present unretrieved info as findings; thin/blocked tool output = failure, report it; Lightpanda `browser_get_content` flags thin content.
- ✅ **Todo/Plan tool** (`orbit-plan`): `plan_write`/`plan_update` (DAG-ready) → per-session backend interception → `plan_state` WS → DB v11 `plan_steps` → live **Mission checklist** (done/active/blocked + deps) + Mission-toggle progress badge. Restart-safe. Rendering/persistence screenshot-verified; live agent-use needs a real turn. Full plan: **`plan/PERMISSIONS-SANDBOX-PLAN.md` (Phase C)**.
- Six MCP servers auto-register: `lightpanda, orbit-fleet, orbit-notify, orbit-transcript, orbit-search, orbit-plan`.

---

## Next: Permissions & Execution Isolation 🔜
> Full plan: **`plan/PERMISSIONS-SANDBOX-PLAN.md`**. Model: permissions = *reach* (backend gate) · container = *blast radius of execution* (untrusted code) · git = *file undo*. **Host = trusted operation; container = running anything untrusted.**
- 🔴 **Priority bug:** the safe zone is the Orbit source repo — the agent can write its own code. Retarget writes to `~/.orbit/workspace`; add a consent-proof hard blocklist (source, `~/.ssh`, system dirs).
- Add **"Always allow this folder"** to the consent prompt (bridges in-chat consent → durable Policies allow-list); surface safe zone / allow-list / blocklist / matrix in the Policies view.
- Make the container the session-id-keyed, durable, git-backed **untrusted-execution box** (+ auto-Preview wiring), opt-in via a Sandbox/Build profile — host stays default.
- **Session-based isolation** is the model: each session gets `~/.orbit/sessions/<id>/{workspace,artifacts,tmp}` (its per-session safe zone + container mount); sessions can't see each other. The **agent is told its own layout at spawn** for proper tracking/maintenance.

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
