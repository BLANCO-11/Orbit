# AegisAgent — Platform Extensions Plan

> **Date:** 2026-07-11
> **Scope:** Session profiles, harness-agnostic tool/extension management, event channels, sandboxes, durable resume.
> **Prompted by:** studying [withastro/flue](https://github.com/withastro/flue) — a code-first agent *framework*. We borrow its concepts (agent definitions, channels, sandboxes) and keep our *form* (a human-in-the-loop operator console).
>
> **STATUS: all five phases ✅ implemented and verified live** (commits `748e113`, `ccf73ca`, `3f7e4e6`, `9d745d9`, `68b0efb`). See per-phase "Verify" notes — each was driven against the running app, not just typechecked.

---

## 0. The boundary (non-negotiable)

AegisAgent is a **local-first operator console** — a human watches and steers agents through a UI. It is **not** a deployable framework. Every feature below must land as something you *operate from the console*, not a code SDK.

**Explicit non-goals** (what we will NOT copy from Flue):
- No `defineAgent()` code API / TypeScript authoring surface for end users.
- No deploy-to-CI/Workers targets.
- No headless-only product — headless runs (event channels) always surface back into the console's session list, timeline, and metrics.

Everything below is a console feature with a UI. If a feature can't be operated and observed from the console, it's out of scope.

---

## 1. What we learned → what we build

| Flue concept | Our version | Status |
|---|---|---|
| `defineAgent({model,tools,skills,sandbox,instructions})` | **Session profiles** — a named, saveable bundle of harness+mode+prompt+effort+skills+tools, picked in one click | new (Phase 2) |
| Typed tools / per-agent tool set | **Harness-agnostic tool contract** — each harness self-reports its tools; profiles carry a per-harness allow/deny set | new (Phase 1) |
| Skills packages (`SKILL.md`) | already shipped (`skills/<name>/SKILL.md`) | ✅ done |
| MCP integration | already shipped (connector registry) | ✅ done |
| Channels (Slack/GitHub events trigger agents) | **Event channels** — inbound webhooks start a session with a profile, headless, surfaced in the console | new (Phase 3) |
| Sandboxes (local/virtual/remote container) | **Sandbox dimension** — host (today) / ephemeral container / remote-adapter | new (Phase 4) |
| Durable execution / checkpoint recovery | **Resume** — reconnect to an interrupted session and continue | new (Phase 5) |

Reconciliation with earlier decisions: the greenlit **"Extensions" rail tab** becomes the **"Agents" rail tab** (session profiles), because tools/extensions are one *dimension* of a profile, not a standalone concept. The **global default + per-session override** decision maps directly: a profile is the reusable default; the composer chips remain the per-session override.

---

## 2. Phase 1 — Harness-agnostic tool contract (foundation)

Make tool/extension enumeration and application a **harness responsibility**, so no `if (harnessType === 'pi')` ever leaks into the backend or UI. (Design agreed in chat.)

### Backend
- `harnesses/interface.js`: add
  - `async listTools()` → `[{ id, name, source, description, enabledByDefault }]`
  - `connect()` already accepts options; formalize `excludeTools: string[]`.
- `harnesses/picode/index.js`:
  - `listTools()` = built-ins (`read/bash/edit/write/grep/find`, with descriptions) ∪ extensions parsed from `pi list` / `~/.pi/agent/settings.json` `packages[]` ∪ observed tool names.
  - `connect()` applies `--exclude-tools` (already added for the browser fix — generalize to read from options).
  - A per-harness-type **observed-tools cache**: when `tool_call_start` reports a tool name we haven't catalogued, record it (so the available list self-populates, incl. `mcp_*` connector tools). Persist to a small JSON.
- `harnesses/remote/index.js` (`RemoteHarness`): `listTools()` sends `{type:'list_tools'}` over the adapter socket; the adapter replies by calling its *local* harness's `listTools()`. `adapter/aegis-adapter.js` handles that message.
- `server.js`: `GET /api/harnesses/:id/tools` → routes to local pi or the right adapter, returns the merged list. `excludeTools` flows through `start_task` → `handleStartTask` → harness options (already partly wired).

### Frontend
- No dedicated UI yet — this phase is the contract. The Agents tab (Phase 2) consumes `/api/harnesses/:id/tools`.

### Verify
- `GET /api/harnesses/local/tools` returns pi's built-ins + extensions (incl. `pi-web-access`) + observed `mcp_lightpanda_*`.
- Spawning with an `excludeTools` set drops those tools (confirm via `--exclude-tools` in the pi args and absence of the tool in a run).
- A remote adapter reports *its* tools over the relay.

---

## 3. Phase 2 — Session profiles (the unifying abstraction)

A profile bundles everything the composer chips set today into one named, reusable object.

```
Profile {
  id, name, description,
  harnessType,               // 'picode' (which local/remote instance is chosen at run time)
  mode,                      // chat | plan | edit | yolo
  effort,                    // fast | balanced | deep
  promptId,                  // prompt library id
  skills: string[],          // skill ids
  toolPolicy: {              // per-harnessType, tighten-only over defaults
    excluded: string[]
  },
  sandbox: 'host',           // extended in Phase 4
  createdAt, updatedAt
}
```

### Backend
- DB schema v7: `profiles` table (`id, name, config_json, created_at, updated_at`). Migration in `db.js`.
- `routes/profiles.js`: `GET/POST/PUT/DELETE /api/profiles`; seed a couple of defaults on first run ("Quick chat", "Safe edit", "Deep research").
- `server.js` `start_task`: accept `profileId`. Load the profile server-side and use its fields as **defaults**; any explicit field on the message **overrides** (so the composer chips are per-session overrides, exactly the greenlit model). This server-side expansion is also what event channels (Phase 3) use, since they have no UI.

### Frontend
- **New "Agents" rail tab** (replaces the planned standalone Extensions tab): list profiles as cards; create/edit/delete. The editor sets harness type, mode, effort, prompt (from library), skills (multi-select), and **tools** — fetched live from `GET /api/harnesses/:type/tools`, grouped by source (built-ins · each extension · MCP connectors), each a toggle. Disabling writes to `toolPolicy.excluded`.
- **Composer: a Profile picker chip** (leftmost). Selecting a profile sets all the other chips to its values; the user can still override any chip for this one session. "Save current as profile…" captures the current chip state.
- The existing chips (harness/mode/prompt/effort/skills) stay as the override layer.

### Verify
- Create a profile with `pi-web-access` disabled + deep effort; select it; the composer reflects it; a run excludes those tools and uses the reasoning model.
- Override a chip after picking a profile → the override wins for that session only; the profile is unchanged.

---

## 4. Phase 3 — Event channels (proactive triggers)

Let external events start a session with a profile, headless, and surface it in the console. This is the biggest new capability and the clearest "operations product" differentiator.

### Prerequisite refactor — session bus (decouple from a single WS)
Today `createHarnessEventEmitter(ws, …)` hardwires one dashboard socket. Refactor to a **session bus**:
- A session has a set of subscriber **sinks**; harness events fan out to all sinks **and always persist** to the session store.
- Sink types: `DashboardSink` (wraps a ws — many can attach/detach), `HeadlessSink` (persist + fire notifications only).
- `sendWithSession` becomes `bus.emit(sessionId, msg)`. Dashboard clients attach on connect, detach on close; a session with zero viewers keeps running and persisting.
- Bonus: this also fixes multi-device viewing (several dashboards watching one session) for free.

### Backend
- DB: `channels` table (`id, name, type, secret_hash, profile_id, prompt_template, enabled, created_at`).
- `routes/channels.js`:
  - `GET/POST/PUT/DELETE /api/channels`.
  - `POST /api/channels/:id/webhook` — the public receiver. Verify signature per type (GitHub HMAC-SHA256, Slack signing secret, generic bearer). On valid event: build a prompt from `prompt_template` + the event payload, create a session, run the profile **headlessly** via the session bus, and fire a notification (existing `aegis-notify` / notifications router) on completion.
- Rate-limit + replay protection on the webhook.

### Frontend
- **Channels section in the Agents tab** (or its own sub-view): create a channel → pick type, pick a profile, set a prompt template (with payload variables), get the generated webhook URL + secret. Show recent triggers (last N, with the resulting session linked).
- Event-triggered sessions appear in the normal session list (a small "channel" badge), fully replayable in the timeline like any other.

### Verify
- Create a "GitHub issue triage" channel → a signed test webhook starts a session running the chosen profile; the session appears in the list with full timeline + metrics; a notification fires. An unsigned/replayed request is rejected.

---

## 5. Phase 4 — Sandboxes (isolation, not just filtering)

Our security-guard is a denylist on a host process; Flue runs agents in containers. Add a **sandbox dimension** to profiles.

- `sandbox: 'host' | 'container' | 'remote'`.
  - `host` — today's behavior.
  - `remote` — run on a paired remote harness (already built; this just surfaces it as a sandbox choice).
  - `container` — spawn the harness inside an ephemeral Docker container (Docker is already a dependency for Lightpanda) with the workspace bind-mounted and network optionally restricted. A `SandboxedHarness` wrapper around `docker run … pi …`, or the adapter protocol pointed at a container.
- **Honest caveats** (write these in the UI): container mode needs pi + node + LiteLLM reachability inside the container and careful creds/workspace mounting; it is the heaviest lift and ships last. It matters most for `yolo` mode.

### Verify
- A profile with `sandbox: container` runs a `yolo` task whose file writes land in the container's mounted workspace and cannot touch host paths outside it.

---

## 6. Phase 5 — Durable resume

pi already persists its own conversation per `--session-id`, so "resume context" is largely respawn-with-same-id. The gap is an **interrupted in-flight turn**.

### Backend
- Mark a session `running` when a turn starts, `idle`/`done` when it ends; persist the active prompt + turn state.
- On backend restart or harness death mid-turn: detect `running` sessions, and offer resume — respawn the harness with the same session-id (pi restores context); optionally re-issue the interrupted prompt.
- Sub-agent tree + metrics already persist (Phase 1 of the original program), so the observability survives.

### Frontend
- A "resume" affordance on a session that was interrupted (banner in the timeline). One click respawns and continues.

### Verify
- Kill the harness mid-turn; the session shows "interrupted"; resume continues from persisted context, not from scratch.

---

## 7. Sequencing & rationale

1. **Phase 1 (tool contract)** — foundation; unblocks 2 and keeps us harness-agnostic.
2. **Phase 2 (profiles)** — highest leverage, absorbs the greenlit Extensions/tools work, unifies the composer.
3. **Phase 3 (channels)** — the standout new capability; needs the session-bus refactor (which also improves multi-device viewing).
4. **Phase 4 (sandboxes)** — real isolation; heaviest; remote already covers part of it.
5. **Phase 5 (resume)** — robustness for long autonomous runs; lightest of the new work thanks to pi's own persistence.

Each phase is independently shippable and verified against the running console (drive the real app, not just typecheck), consistent with how the prior program was executed.

---

## 8. What this deliberately does not add
- No end-user code/SDK surface. Profiles are edited in the UI, stored as data — never authored as TypeScript.
- No CI/serverless deploy targets.
- Headless (channel) runs are never invisible: they always land in the session list with full timeline, metrics, and trace.
