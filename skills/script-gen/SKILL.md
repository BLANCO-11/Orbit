---
name: script-gen
description: Generate, smoke-test, and self-report a runnable data/integration script with a machine-readable RESULT.json
---

# Script generation (run-API contract)

You are producing a **runnable script** for a parent application that will read
your result as structured data — not prose. Follow this contract exactly; the
backend validates it and reports `needs_review` if it is missing or malformed.

## Where things go
- Put the finished script in **`../artifacts/`** (e.g. `../artifacts/fetch.py`).
- Put any generated report/output in **`../artifacts/`** too (e.g. `../artifacts/report.md`).
- Do all scratch work in the current working directory or `../tmp/`.

## Secrets — reference, never inline
- Credentials are provided to you as **environment variables**, by name only.
  The task tells you the variable name (e.g. `DEMO_TOKEN`); the value is already
  in the run's environment.
- Your script MUST read them from the environment — `os.environ["DEMO_TOKEN"]`
  (Python) or `process.env.DEMO_TOKEN` (Node). **Never** hard-code, echo, print,
  or write a secret value into any file, log line, or `RESULT.json`.

## Datasources
- If the task names an MCP tool (e.g. `get_watchlist`), call that tool to obtain
  the working set, then have the script fetch per-item data from the given API
  URL(s).

## Smoke-test before finishing
1. Run the script once in a bounded, non-destructive way — a `--dry-run`, a
   single-item fetch, or a small sample. Capture its exit status and output.
2. If it fails, fix the script and re-run until it passes (or until you can
   explain the failure). Do not claim success you did not observe.

## Emit `../artifacts/RESULT.json` (required, last step)
Write EXACTLY this shape (extra keys are ignored, these are validated):

```json
{
  "ok": true,
  "summary": "one line describing what the script does and that it ran",
  "primaryArtifact": "fetch.py",
  "tests": {
    "ran": true,
    "passed": true,
    "command": "python fetch.py --dry-run",
    "output": "…trimmed stdout/stderr from the smoke test…"
  }
}
```

Rules for `RESULT.json`:
- `ok` (boolean) and `tests` (object with boolean `ran` + `passed`) are **required**.
- `passed` must reflect the **actual** smoke-test outcome. If the test failed,
  set `ran:true, passed:false` and put the error in `tests.output` — the backend
  marks the run `failed`, which is correct and useful. Do not fake a pass.
- `primaryArtifact` is the script's filename inside `artifacts/`.
- `tests.output` is trimmed and must contain **no secret values**.

Finish only after both the script and a valid `RESULT.json` are in `artifacts/`.
