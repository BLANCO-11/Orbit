# Run API & the result contract

A **run** is one versioned execution against a session. You submit a task, then
poll for a typed **result contract**. See [Concepts › Run](../concepts.md#run).

## Submit a run

`POST /api/run`

```jsonc
{
  "prompt": "Fetch weather for my watchlist and write a markdown report.",
  "sessionId": "…",     // optional — omit to start a new session; provide to version an existing one
  "profileId": "…",     // optional — a saved profile (mode/effort/prompt/skills/sandbox)
  "mode": "yolo",        // optional — chat | plan | edit | yolo
  "effort": "balanced",  // optional — fast | balanced | deep
  "sandbox": "container",// optional — host | container | remote
  "timeouts": {           // optional — override the layered watchdogs
    "idleTimeoutMs": 180000,
    "maxRunMs": 1200000
  }
}
```

Response (async):

```json
{ "success": true, "runId": "run_…", "sessionId": "…", "seq": 1, "status": "running" }
```

Connectors and secrets are **not** passed inline — they're resolved from your
tenant at spawn. Runs default to the **container** sandbox (network-on;
downgrades to `host` if Docker is unavailable) and always attach the mandatory
`script-gen` skill so the agent smoke-tests and emits `RESULT.json`.

### Long-poll for short runs

Add `?wait=true&timeoutMs=<ms>` to block until the run is terminal:

```
POST /api/run?wait=true&timeoutMs=120000
```

Returns `{ success, run: <contract> }` when terminal, or `202` +
`{ runId, sessionId, seq, status:"running" }` if it times out (then keep polling).

## Poll a run

`GET /api/run/:runId` → `{ success, run: <contract> }`. Poll until `status` is
terminal. Scoped to your tenant (another tenant's run 404s).

## Cancel a run

`POST /api/run/:runId/cancel` → aborts an in-flight run; it finalizes with a
terminal contract.

## Answer a run (`awaiting_input`)

If the agent calls the built-in `ask_questions` tool, the run pauses at
**`awaiting_input`** (a non-terminal status) and its idle watchdog is suspended
(the absolute backstop still applies). `GET /api/run/:id` then returns the pending
questions:

```jsonc
{ "status": "awaiting_input", "questionId": "q_…",
  "pendingQuestions": [ { "id": "db", "question": "Which datastore?", "kind": "single",
    "options": [ { "label": "Postgres" }, { "label": "Mongo" } ] } ] }
```

Answer with:

```
POST /api/run/:runId/answer
{ "questionId": "q_…", "answers": { "db": "Postgres" } }
```

`answers` is keyed by question id → the selected label(s) (single/multi) or text.
The parked tool call resolves and the run resumes `running`. Unanswered within
`ORBIT_ASK_TIMEOUT_MS` (default 10 min), the tool returns a "no answer" sentinel
and the run continues.

## Version history

`GET /api/sessions/:id/runs` →
`[{ runId, seq, status, summary, startedAt, endedAt }]`, newest first. Each run's
artifacts are snapshotted under `runs/<runId>/artifacts/`, so v1's outputs
survive when v2 rewrites the workspace.

## The result contract

```jsonc
{
  "runId": "run_…", "sessionId": "…", "seq": 1,
  "status": "running|succeeded|failed|timeout|error|needs_review",
  "ok": true,                       // true only when status === "succeeded"
  "summary": "one-line what-happened",
  "primaryArtifact": { "path": "/artifacts/fetch.py", "language": "python", "bytes": 2481 },
  "artifacts": [
    { "path": "/artifacts/report.md", "language": "markdown", "mime": "text/markdown", "bytes": 640 }
  ],
  "tests": { "ran": true, "passed": true, "command": "python fetch.py --dry-run", "output": "…(capped 8KB)" },
  "usage": { "tokens": 42100, "cost": 0.031, "toolCalls": 12 },
  "finalMessage": "…(capped 4KB)",
  "error": null,
  "raw": { "resultJsonPresent": true, "resultJsonValid": true, "resultJsonErrors": [] },

  // Optional, present only when applicable:
  "build": { "buildId": "bld_…", "submitted": true, "status": "passed|failed|error|skipped", "tester": { … }, "artifacts": [ "…" ] },
  "templateCompliance": { "templateId": "…", "ok": false, "violations": [ { "rule": "packages.denied", "detail": "…", "file": "…" } ] }
}
```

- **`build`** — present when the agent ran the `end_build` handoff. A definitive
  tester `failed` flips the run status to `failed`; `skipped` means the external
  facility isn't configured (`ORBIT_TESTER_URL` unset).
- **`templateCompliance`** — present when the run used a `templateId`. **Audit-only:**
  violations are reported but do **not** change the run status.

### Status meanings

| Status | Meaning |
|---|---|
| `running` | Not terminal yet — keep polling. |
| `awaiting_input` | Paused on a built-in `ask_questions` call — answer via `POST /api/run/:id/answer` to resume. Not terminal. |
| `succeeded` | Clean completion **and** a valid `RESULT.json` with `tests.passed: true`. `ok` is `true`. |
| `failed` | The agent reported `ok:false`, or tests ran and failed (`tests.passed:false`). |
| `needs_review` | Completed, but `RESULT.json` is missing or schema-invalid — inspect the artifacts manually. **Never a false success.** |
| `timeout` | Hit the idle watchdog or the absolute backstop. |
| `error` | The agent turn errored (provider/policy/spawn failure) or was cancelled. |

`raw.resultJsonErrors` lists the schema problems when `needs_review`.

## How status is derived

The backend synthesizes a deterministic baseline (status, final message, artifact
listing, usage) and merges in the agent-authored `artifacts/RESULT.json`,
validated against a schema:

- lifecycle `error` / `timeout` / cancelled → that status wins;
- else valid `RESULT.json`, `ok !== false`, tests not-failed → `succeeded`;
- else `ok:false` or tests failed → `failed`;
- else (missing/invalid `RESULT.json`) → `needs_review`.

If a clean run *forgot* to write `RESULT.json`, the backend sends **one** bounded
follow-up turn asking the agent to smoke-test and write it, then re-assesses —
so a capable-but-forgetful model still lands on `succeeded` rather than
`needs_review`.

## The `RESULT.json` contract (agent side)

The `script-gen` skill (auto-attached to every run) instructs the agent to write
`../artifacts/RESULT.json`:

```json
{
  "ok": true,
  "summary": "what the script does and that it ran",
  "primaryArtifact": "fetch.py",
  "tests": { "ran": true, "passed": true, "command": "python fetch.py --dry-run", "output": "…(no secret values)" }
}
```

`ok` (boolean) and `tests` (`{ ran, passed }` booleans) are **required**; the
agent must report the *actual* smoke-test outcome (a real failure → `failed` is
correct and useful). Secret **values** must never appear in the script or
`RESULT.json`.

## Fetch generated files

Use the workspace file API with the contract's artifact paths:

```
GET /api/workspace/file?session=<sessionId>&path=<primaryArtifact.path>
```

Also available: `GET /api/workspace/tree?session=…` to list, and
`GET /api/workspace/preview?session=…&path=…` for a rendered preview.

Ready-to-run examples: [Examples](./examples.md).
