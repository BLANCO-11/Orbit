# Orbit — Permissions, Execution Isolation & Plan Tool

> Build plan for the security/isolation model Orbit converged on (July 2026).
> Read the mental model first — the build steps only make sense against it.
> Branch: `feat/metrics-reliability-and-fleet`.

## Mental model (the whole thing in one place)

Three **separate** levers. Don't conflate them:

| Lever | Governs | Mechanism | Failure it stops |
|-------|---------|-----------|------------------|
| **Permissions** | *reach* — what paths the agent may touch | backend policy gate on every tool call (`policy-engine.js`) | agent wandering / writing outside its zone |
| **Isolation (container)** | *blast radius of execution* — what a spawned process can do | run pi in Docker for untrusted work | harmful code (a spawned process runs as YOU on host, ungated) |
| **Git / throwaway files** | *file undo* — recovering trashed work | git in the workspace, or throwaway container files | destruction *inside* an allowed folder |

**The boundary is TRUST, not build-vs-run:**
- **Host** = trusted operation (edit your projects, manage your machine, run your own known commands). Orbit as your operator.
- **Container** = anything you'd run untrusted/unknown code for (a sketchy repo, `npm install` of random packages, "build me an app"). Execution confined; can't touch your system beyond a mount; dies with the container.

**Key truth that drives the design:** Orbit's permission gate controls the agent's *tool calls* — it does NOT sandbox the *processes those tools spawn*. `bash node x.js` runs as the user with full OS privileges, invisible to the gate. So the shell denylist is only a partial net; **the container is the only real protection against harmful execution.** Therefore untrusted execution must be containerizable.

**"Build in normal folders + safe execution" is achieved by** running a session in a container with the host workspace **mounted**: files stay on-host (editable, persistent), execution can't escape to the wider system, and **git is the undo** for the mounted workspace. If even the workspace must be untouchable → don't mount (throwaway files).

---

## Session-based isolation & directory layout (the maintenance/tracking backbone)

**Decision: isolation is per SESSION.** Each session gets its own directory tree and (when sandboxed) its own container, keyed by `sessionId`. Sessions cannot see each other's files. This is the unit for tracking, cleanup, and management.

**Proposed layout** (default — refine as needed):
```
~/.orbit/                              # Orbit home — OFF the source tree
├── sessions/
│   └── <sessionId>/                   # one session = one isolation boundary
│       ├── workspace/                 # agent's writable working dir  ← per-session SAFE ZONE
│       ├── artifacts/                 # deliverables to keep (builds, reports, exports)
│       └── tmp/                       # scratch — safe to wipe
└── shared/                            # optional cross-session assets (explicit opt-in only)
```

How the three levers bind to this:
- **Permissions (reach):** a session's default safe zone = its own `workspace/` (+ `artifacts/`, `tmp/`). Writes anywhere else — including *another session's* dir — fall outside the allow-set → JIT consent. So sessions are isolated by *permission* even on the host, before any container.
- **Isolation (blast radius):** a sandboxed session's container is `orbit-sess-<sessionId>`, mounting **only** that session's dir. Filesystem-isolated from other sessions and from the host.
- **Lifecycle:** created lazily on first session use; **reaped when the session is deleted** (guard `artifacts/` — warn before removing deliverables) or after an idle TTL.

**Agent awareness (required):** the agent must know its own layout. Because the paths are session-specific, inject them **dynamically at spawn** (`connect()` knows `sessionId`) into the system prompt — e.g. "Your workspace is `~/.orbit/sessions/<id>/workspace`. Put deliverables in `artifacts/`, scratch in `tmp/`. You are scoped to this session and cannot reach other sessions; writing elsewhere will ask the user." This keeps the agent oriented for maintenance/tracking and stops it from dumping files at random.

---

## Current state (what already exists — do NOT rebuild)

- **Permission gate**: `policy-engine.js` capability×mode matrix (`write_workspace`/`write_outside`/`shell`/`network`/…, allow/ask/block), evaluated in `server.js` `tool_call_start`. Enforced for the agent AND sub-agents (session-scoped) — **inheritance & no-bypass are already structural**.
- **JIT consent**: `edit_permission_request` → `ApprovalBanner.tsx` offers **Allow once** / **Allow for session**; `allow_session` persists to a per-session allow-set (`sessionAllowedPaths`).
- **Container harness**: `harnesses/container/index.js` — runs pi in an ephemeral `docker run --rm` with pi/node runtime (ro), `~/.pi` (rw), and the workspace (rw) mounted; `--network host` to reach LiteLLM/Lightpanda. Opt-in via profile `sandbox: "container"`.
- **Shell guard**: `security-config.json` `shellCommands` (blockedCommands, allowedPrefixes, requireApproval).

## The real bug + the gaps

1. **🔴 Safe zone = the source repo.** `PROJECT_ROOT = repo root` and `allowedWritePaths = [<repo>, /tmp]`. The agent's free-write zone is **Orbit's own code** — it can rewrite itself. This is the priority fix.
2. No **hard blocklist** that user consent cannot override (source, `~/.ssh`, system dirs).
3. JIT consent lacks **"Always allow this folder"** (the bridge from in-chat consent → durable policy).
4. Container is **ephemeral (`--rm`) + host-mounted** — no per-session durability, no git-undo story, not the default for untrusted execution, Preview not auto-wired.

---

## Build plan

### Phase A — Permission model on host (priority; the daily safety net)
1. **Retarget the safe zone off the source → PER-SESSION.** Default writable zone for a session = `~/.orbit/sessions/<sessionId>/{workspace,artifacts,tmp}` (see layout above). Update `session-helpers.js` (`PROJECT_ROOT`/safe-zone → a per-session `WORKSPACE_ROOT` resolved from `sessionId`), `security-config.json` default `allowedWritePaths` (base `~/.orbit`), and the container harness mount so host + container agree. Create the session dirs lazily on session start; inject the concrete paths into the agent's prompt at spawn.
2. **Hard blocklist (consent-proof).** New `fileSystem.blockedPaths` semantics: paths here are refused even if the user clicks "allow." Seed: the Orbit source dir, `~/.ssh`, `~/.gnupg`, `~/.aws`, `/etc`, `/boot`, `/sys`. Enforce in `isPathAllowed` / `policy-engine` before any allow-set check.
3. **"Always allow this folder" consent option.** Extend `edit_permission_request` + `ApprovalBanner.tsx` with a 3rd action → on accept, persist the folder to a durable `allowedWritePaths` (via `/api/config`), i.e. promote in-chat consent to app policy. Keep allow-once / allow-session as-is.
4. **Subagent inheritance test.** Add a test proving a sub-agent write outside the zone hits the same gate (asserts no-bypass) — it already should; lock it in.
5. **Policies view surfacing.** In `PoliciesView.tsx`: show + edit the safe zone, the durable allow-list, the hard blocklist, and the capability×mode matrix in one place. This is the "durable auth policy" home.

**App vs chat split (the UX answer):** durable policy lives in the app (Policies view); in-the-moment consent lives in chat (the banner); **"Always allow" is the one bridge** that writes chat consent back to app policy.

### Phase B — Execution isolation (container as the untrusted-exec box)
1. **Trust-based routing.** Keep host as default. A **"Sandbox / Build" profile** (`sandbox: "container"`) is the one-click "run this untrusted / build me an app" mode.
2. **Durable, session-id-keyed container.** Replace `--rm` throwaway with a container named `orbit-sess-<sessionId>` that **persists across turns** (so an iterative build survives), workspace mounted rw. Auto-reap when the session is deleted or after an idle TTL.
3. **Git-backed undo for the mounted workspace.** On container-session start, ensure the workspace is a git repo (init if needed) + auto-commit checkpoints, so a destructive run is recoverable (`git reset`). Document this as the workspace undo.
4. **Throwaway option.** For fully-untrusted work, a mode where the workspace lives *inside* the container (not mounted) → nothing on the host is touched; export-to-host is explicit.
5. **Preview wiring.** A dev server started in the container (on a port) is surfaced in the **Preview tab** automatically (detect the port / let the agent declare it via a tool). This is the "build an app + watch it live, safely" payoff.
6. **Honest limits (surface in UI):** a mounted workspace gives *process/system/network* isolation, NOT *file* isolation of the mount (git is the undo). `--network host` today = no network isolation; a stricter bridge is a later option.

### Phase C — Plan / Todo tool (BUILT this session; document + finish)
**✅ Done & verified this session** (needs backend restart + dashboard rebuild to go live):
- `mcp-server-plan` (`orbit-plan`): `plan_write` (ordered steps + `deps` for a DAG) + `plan_update` (per-step status). Auto-registered on boot.
- Backend intercepts the tool calls **per-session** (`applyPlanTool` in `server.js` `tool_call_start`) — the shared MCP process lacks session context, so the backend owns plan state, broadcasts `plan_state` over WS, and persists it. Restart-safe (rehydrates from DB on `plan_update`).
- DB migration v11: `plan_steps` column; save/restore round-trip verified.
- `MissionView` renders the structured checklist (preferred; falls back to the legacy free-text parse) with done/active/blocked icons + DAG "after N" labels. Header **Mission toggle badge** shows live `done/total` + pulse. Persists across refresh/session-switch.
- `orbit-system.md` instructs the agent to drive multi-step work through the tool (one step active at a time).

**🟡 Remaining / optional:**
- **Live verification** with a real agent turn (that the model actually calls `plan_write`/`plan_update` well) — needs the user's env; costs tokens.
- **Always-visible plan preview beside chat** (optional): a compact live checklist in the inspector Overview tab or a collapsible strip atop the chat, so the plan is visible without leaving Timeline. (Mission tab stays the full view.)

---

## Sequencing & acceptance

1. **Phase A first** — it's the actual bug (agent can write its own source) and the everyday net. Independent of containers; applies in host + container modes.
2. **Phase C is basically done** — just restart/rebuild to make it live, then optionally add the beside-chat preview.
3. **Phase B** when the build/untrusted-execution workflow is wanted.

**Acceptance:**
- Agent cannot write to the Orbit source or any blocklisted path — even after the user clicks "allow." ✓
- A write outside the safe zone prompts once; "Always allow" never re-prompts (persisted). ✓
- A sub-agent gets the same gate as its parent (test). ✓
- Untrusted execution can be routed to a container that cannot harm the host beyond the mounted workspace; git recovers the workspace. ✓
- Multi-step tasks show a live checklist in Mission that ticks off as the agent completes steps. ✓ (built)

## Constraints
- Enforcement stays at the **backend tool-call gate** — never rely on the prompt for security (the model can ignore prompts; it cannot bypass the gate).
- Reuse existing pieces (`policy-engine`, `edit_permission` flow, `ContainerHarness`) — extend, don't rewrite.
- `dashboard/AGENTS.md`: this Next.js has breaking changes vs training data — check `node_modules/next/dist/docs/` before new patterns.
