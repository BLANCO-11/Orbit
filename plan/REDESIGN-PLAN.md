# AegisAgent — Product Redesign Plan

> **Date:** 2026-07-10
> **Source of truth for the target UI:** `plan/aegis-console-mock.html` (approved interactive mock, also published as a Claude artifact). Open it in a browser; toggle **Design notes** for the rationale behind each decision.
> Supersedes all earlier plan documents (deleted; recoverable from git history).

---

## 1. What AegisAgent is

A **local-first agent-operations console**. Think Cursor's agent panel, but harness-agnostic and self-hosted:

- **Harnesses do the work** — pi-code today; opencode or any CLI tomorrow, via an adapter protocol. Local (child process) or remote (WS + token). Multiple harnesses can run on one machine, each with its own policy scope.
- **Devices drive it** — laptop, phone, tablet. Paired via URL + OTP with a scope chosen at pairing time (chat+voice / read-only / full control).
- **Connectors extend it** — MCP tool servers (github, slack, grafana, …) registered once at the console, exposed to every harness session, gated by policy like any other capability.
- **Skills specialize it** — reusable instruction packs, attachable per session from the composer or always-on from Settings.
- **Policies govern it** — a capability × mode matrix (allow/ask/block), enforced budgets (cost/tokens/sub-agent depth), per-device and per-harness overrides. Approvals surface **in the timeline**, where the action fires.
- **Everything is observable** — provider-reported usage (never estimated), per-turn reasoning, and end-to-end sub-agent traces (task, own reasoning, own tools, own metrics), all persisted.
- **Voice is a first-class I/O** — the existing sentence-level TTS pipeline stays; reasoning is never spoken; barge-in mutes agent audio when the user speaks.

## 2. Information architecture

One icon rail, four surfaces (mobile: same four as bottom nav; inspector segments become swipe-up sheets):

| Surface | Job |
|---|---|
| **Console** | Sessions list · unified activity timeline **⇄ Mission view** · contextual inspector · composer |
| **Fleet** | Pair devices & harnesses (one OTP flow) · harness registry · device registry with revoke |
| **Connectors** | MCP tool-server registry (github, lightpanda browser, slack, …) · auth · per-tool allow/ask/block |
| **Policies** | Capability × mode matrix · budgets & limits · per-device overrides |
| **Settings** | Models (LiteLLM endpoint/keys/models/thinking) · prompt directives · skills · voice · memory/compaction |

Two orthogonal session axes, deliberately not merged: **permission mode** (Chat/Plan/Edit/Yolo — what the agent may do) and **effort profile** (fast/balanced/deep — model routing + reasoning budget). **Mission view** is a toggle on the Console center column, not a separate tab: the same session data projected as the agent's own phase breakdown — tasks with owner (main or sub-agent), status, cross-check gates, and re-plans tagged with the reasoning turn that introduced them. Deep-effort sessions default to having it available; there is never a second source of truth.

Killed on purpose: the 5-tab right panel (one tab was clipped offscreen), the second settings entry point, the chat-column-plus-hidden-metrics layout, the "Paired devices 0" footer row.

## 3. The Console (the big change)

### 3.1 Unified timeline (center, primary surface)
One chronological stream — chat is woven in, not a separate column. Entry types:

- **User message** (with originating device label)
- **Plan card** — steps with done/now/next state, approval timestamp
- **Tool call** — verb + target + latency; expandable output
- **Edit card** — file + diffstat; click → diff in inspector Preview
- **Reasoning accordion** — per turn, collapsed by default, shows its own token count, marked "not spoken" (excluded from TTS)
- **Sub-agent lane** — nested card with lineage color, task text, its own tool calls streaming live, per-agent usage footer, "full trace →" link
- **Approval gate** — fires inline when policy says `ask`; states: pending (Approve once / Deny) → approved+output or denied+replan
- **Assistant message** — with TTS chip (voice, duration) when spoken

Left gutter: timestamp + node on a vertical thread. Sub-agent nodes carry the lineage color.

### 3.2 Inspector (right, 348px, contextual)
Four segments — **Overview / Workspace / Preview / Trace**:

- **Overview** — usage tiles (tokens in/out, cost, tool calls, latency p50/p95) tagged `provider-reported`; tokens-per-turn chart (in/out series `#8781ec`/`#1baf7a`, CVD-validated); context meter; budget meter; sub-agent list with lineage dots; slowest-tools bars; turn-latency sparkline.
- **Workspace** — file tree of the session workspace with M/A change badges; click file → Preview.
- **Preview** — context-sensitive: diffs, images, HTML, markdown. Empty state explains how to fill it.
- **Trace** — full detail for a selected sub-agent: task, spawn lineage/model/depth, its own metric tiles, its own interleaved reasoning+tool timeline, its returned result. Streams live while the sub-agent runs; persisted after.

### 3.3 Composer (compact)
Single-line textarea + one quiet row of uniform accordion chips: **mode** (Chat/Plan/Edit/Yolo with one-line descriptions; yolo styled danger), **harness**, **prompt** (from the prompt library), **effort** (fast/balanced/deep), **skills** (attach/detach, "+ add skill"), then dictate mic, TTS toggle, Send.

### 3.4 Prompt library
Stored system prompts, managed in Settings, selected per session from the composer. Ships with `standard` (aegis default) plus frontier-style prompts (`claude-style`, `gemini-style`, `codex-style` — the `prompts/` dir already holds early versions, e.g. `claude-fable-5.md`). The selected prompt is inherited by the main agent **and every sub-agent it spawns**; mode directives (plan/edit/yolo) are appended on top of it, not mixed into it. Users can add prompts by paste, file, or URL.

## 4. Backend concepts the UI requires

1. **Device identity** — `devices` table (id, name, scope, token-hash, created, last_seen). OTP pairing endpoint issues short-lived codes (~5 min); successful pairing mints a long-lived device token. WS upgrade authenticates the token. Revocation kills tokens + live sockets.
2. **Harness identity & adapter protocol** — harnesses register like devices (same OTP flow, `aegis-adapter` CLI for remote). `harness_instances` table; several per machine, each with policy scope. Transport: local spawn (today) or authenticated WS (remote).
3. **Real usage accounting** — parse provider `usage` (prompt/completion tokens) from LiteLLM responses; per-model pricing map → cost. Persist per turn AND per agent (main + each sub-agent). The word "estimated" disappears from the UI.
4. **Sub-agent observability, end to end** — every spawn records task, parent, depth; `subagent_tool_start/end` and reasoning events are captured (the `SubagentTracker.startToolCall` / `metrics.addSubagent` family exists but is currently never invoked — wire it); tracker state serialized with the session so traces survive restarts.
5. **Policy engine v2** — capability × mode matrix replaces the global config blob; scoped per device and per harness; `ask` results emit an `approval_request` event that renders as a timeline gate; budgets enforced server-side (pause at cap, ask to continue).
6. **Connectors (MCP)** — registry of MCP servers (command or URL + auth); tools namespaced `connector.tool`; exposed to harness sessions; every call passes through the policy engine and lands in the timeline/metrics like any tool.
7. **Skills** — directory of instruction packs (`skills/<name>/SKILL.md`); session-attach injects into the system prompt; always-on flag in Settings.
8. **TTS (keep, polish)** — engine stays; mute stops playback immediately; barge-in (mic activity pauses audio); blob URLs revoked; reasoning and tool output never spoken.

## 5. Design system (from the mock)

- Dark-committed ops console. Ground `#0f0f13`, panel `#15151b`, raised `#1b1b23`, line `#262631`; ink `#e9e9f1` / `#9d9db0` / `#64647c`; accent iris `#8781ec`.
- Status: ok `#3fbf87`, warn `#d9a44a`, danger `#e06666` — never used as chart series.
- Chart series (validated for CVD + contrast on dark): in `#8781ec`, out `#1baf7a`. Sub-agent lineage: `#1baf7a`, `#d98f4a`, then extend.
- Type: system sans for UI; monospace (`ui-monospace` stack) is the data voice — metrics, paths, timestamps, OTP, diffs.
- Real semantics this time: headings, `role="tab"`, focus-visible states, keyboard reachability. No `@ts-nocheck`, no `props: any`.
