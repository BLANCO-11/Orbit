# User guide

Using the Orbit console (the dashboard at `http://localhost:6801`). For the
concepts referenced here, see [Concepts](./concepts.md).

## Navigation

A left icon rail switches between the main surfaces:

- **Console** — the chat + agent workspace (default).
- **Fleet** — paired remote devices and multi-agent delegation.
- **Connectors** — MCP tool servers.
- **Policies** — the permission matrix, budgets, allowed/blocked paths.
- **Admin** — tenants, API keys, members, observability, SSO *(role-gated)*.
- **Settings** — models, TTS, web access, UI.

## Console

The main workspace. One stream shows the assistant's reply, its per-turn
reasoning, tool calls, and any sub-agents.

### Modes

Pick the permission mode for the turn:

| Mode | Use it for |
|---|---|
| `chat` | Q&A and conversation; read-only capabilities. |
| `plan` | Getting a structured plan without changing anything. |
| `edit` | Letting the agent create/modify files. |
| `yolo` | Full autonomy — shell, network, writes — within the hard blocklist. |

The mode maps to the [policy matrix](./concepts.md#policy--modes); a blocked tool
call surfaces a suggestion to switch modes rather than silently failing.

### Effort

The per-turn effort chip decides which model runs and how much pre-planning
happens:

- **fast** — response model, no pre-planning (chat / quick lookups).
- **balanced** — response model, plans genuine multi-step work (default).
- **deep** — reasoning model, plans multi-step work (dense reasoner).

### Inspector tabs

- **Overview** — the reply and summary.
- **Preview** — rendered output (markdown/HTML) of artifacts.
- **Console** — raw agent I/O.
- **Workspace** — a file browser over the session's `workspace/` + `artifacts/`;
  open, preview, and download generated files.
- **Trace** — every sub-agent with its own task, tool calls, and tokens.
- **Logs** — the full event log for the session.

### Mission board

The agent's structured plan (via the `orbit-plan` tool) rendered as a live
checklist with dependencies — the canonical "what's the plan" surface.

## Connectors

Register MCP tool servers the agent can call. Each connector is **stdio**
(`command` + `args` + `env`) or **remote** (`url`). Connectors you add are
scoped to your tenant; Orbit's own servers (fleet/notify/search/…) show as
shared. Connector `env` can reference `${secret:NAME}` — see below.

## Policies

- **Capability × mode matrix** — allow / ask / block per capability per mode.
- **Budgets** — per-session cost, token, and sub-agent-depth caps (0 = unlimited).
- **Paths** — allowed paths and a consent-proof hard blocklist.
- **Sandbox default** — host or container.

Changes hot-reload on the next turn.

## Profiles, prompts, and skills

- **Profiles** — named templates bundling harness type, mode, effort, prompt,
  skills, tool policy, and sandbox. Load one per session to avoid re-selecting.
- **Prompt library** — swap the base system prompt (`prompts/*.md`). `standard`
  and `orbit-system` are protected defaults.
- **Skills** — reusable instruction packs (`skills/<name>/SKILL.md`) attached per
  session and inherited by sub-agents. (The [Run API](./integration/run-api.md)
  auto-attaches the `script-gen` skill.)

## Fleet (multi-agent)

Pair remote devices or local runtimes and let one chat **delegate** subtasks.
Delegates inherit the lead's rights (capped) and their activity streams back into
the lead's Trace. Pairing uses a short code minted by the operator — see the
protocol in [`../API.md`](../API.md).

## Channels

Trigger a saved profile **unattended** on a schedule or from a verified webhook
(GitHub/Slack HMAC, or a Bearer token). Useful for recurring jobs and
event-driven runs.

## Admin & multi-tenancy *(optional)*

For multi-user deployments: create tenants, mint tenant-scoped API keys, assign
roles (admin/member/viewer), view per-tenant observability, and toggle enterprise
OIDC SSO. A single-user/household deploy needs none of this — it degrades to
dev-mode or a single superadmin key. See
[Authentication](./integration/authentication.md).

## Settings

- **Models** — the response model and the reasoning model (used by `deep`).
- **TTS / Voice** *(optional)* — voice output; barge-in; shown only when a TTS
  backend is configured.
- **Web access** — enable the native browse fallback (Lightpanda MCP is the
  default page reader).
- **UI** — visibility toggles.

## Voice *(optional)*

When a TTS backend is configured, conversational replies can be spoken (with a
dedicated `<tts>` block), and speech-to-text is available for input. Task-heavy
output stays silent by default rather than reading a code dump aloud.
