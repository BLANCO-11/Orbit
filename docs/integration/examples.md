# End-to-end examples

The full parent-app flow — register a secret + connector, submit a task, poll the
contract, fetch the script — in curl, Python, and Node. Set `BASE` and `KEY`
first.

```bash
BASE=http://localhost:6800      # backend API port
KEY=orb_live_…                  # a tenant member key (or the superadmin key)
```

> In dev-mode (no `ORBIT_SUPERADMIN_KEY`), any value for `KEY` works and you
> operate in the shared local tenant.

## curl

```bash
# 1. Stash a secret (encrypted, tenant-scoped). The value never leaves the sandbox.
curl -s -X POST "$BASE/api/secrets" -H "x-api-key: $KEY" \
  -H 'Content-Type: application/json' \
  -d '{"name":"DEMO_TOKEN","value":"s3cr3t"}'

# 2. Register a datasource MCP connector (its env can reference the secret).
curl -s -X POST "$BASE/api/connectors" -H "x-api-key: $KEY" \
  -H 'Content-Type: application/json' \
  -d '{"name":"watchlist","command":"node","args":["/srv/watchlist-mcp.js"],
       "env":{"DS_TOKEN":"${secret:DEMO_TOKEN}"}}'

# 3. Submit the task.
RUN=$(curl -s -X POST "$BASE/api/run" -H "x-api-key: $KEY" \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Use the get_watchlist MCP tool for the list and https://api.open-meteo.com/v1/forecast for data. Generate a Python script that fetches per-item data and writes ../artifacts/report.md. The token is in $DEMO_TOKEN (do not print it). Smoke-test it, then follow the script-gen skill.","mode":"yolo"}')
RID=$(echo "$RUN" | jq -r .runId)
SID=$(echo "$RUN" | jq -r .sessionId)

# 4. Poll until terminal.
while :; do
  C=$(curl -s "$BASE/api/run/$RID" -H "x-api-key: $KEY" | jq -c .run)
  ST=$(echo "$C" | jq -r .status)
  echo "status=$ST"
  case "$ST" in succeeded|failed|timeout|error|needs_review) break;; esac
  sleep 2
done
echo "$C" | jq '{status, tests, primaryArtifact}'

# 5. Fetch the generated script.
P=$(echo "$C" | jq -r .primaryArtifact.path)
curl -s "$BASE/api/workspace/file?session=$SID&path=$P" -H "x-api-key: $KEY"
```

## Python

```python
import time, requests

BASE, KEY = "http://localhost:6800", "orb_live_…"
H = {"x-api-key": KEY, "Content-Type": "application/json"}
TERMINAL = {"succeeded", "failed", "timeout", "error", "needs_review"}

# 1–2. Setup (idempotent upserts).
requests.post(f"{BASE}/api/secrets", headers=H,
              json={"name": "DEMO_TOKEN", "value": "s3cr3t"}).raise_for_status()
requests.post(f"{BASE}/api/connectors", headers=H, json={
    "name": "watchlist", "command": "node", "args": ["/srv/watchlist-mcp.js"],
    "env": {"DS_TOKEN": "${secret:DEMO_TOKEN}"},
}).raise_for_status()

# 3. Submit.
run = requests.post(f"{BASE}/api/run", headers=H, json={
    "prompt": ("Use the get_watchlist MCP tool for the list and "
               "https://api.open-meteo.com/v1/forecast for data. Generate a Python "
               "script that writes ../artifacts/report.md. The token is in $DEMO_TOKEN "
               "(do not print it). Smoke-test it, then follow the script-gen skill."),
    "mode": "yolo",
}).json()
run_id, session_id = run["runId"], run["sessionId"]

# 4. Poll.
while True:
    c = requests.get(f"{BASE}/api/run/{run_id}", headers=H).json()["run"]
    print("status:", c["status"])
    if c["status"] in TERMINAL:
        break
    time.sleep(2)

print("tests:", c.get("tests"), "primary:", c.get("primaryArtifact"))

# 5. Fetch the script.
if c["status"] == "succeeded":
    path = c["primaryArtifact"]["path"]
    script = requests.get(f"{BASE}/api/workspace/file",
                          headers=H, params={"session": session_id, "path": path}).text
    print(script)
```

## Node (fetch)

```js
const BASE = "http://localhost:6800", KEY = "orb_live_…";
const H = { "x-api-key": KEY, "Content-Type": "application/json" };
const TERMINAL = new Set(["succeeded", "failed", "timeout", "error", "needs_review"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = (m, p, body) =>
  fetch(`${BASE}${p}`, { method: m, headers: H, body: body && JSON.stringify(body) }).then((r) => r.json());

// 1–2. Setup.
await api("POST", "/api/secrets", { name: "DEMO_TOKEN", value: "s3cr3t" });
await api("POST", "/api/connectors", {
  name: "watchlist", command: "node", args: ["/srv/watchlist-mcp.js"],
  env: { DS_TOKEN: "${secret:DEMO_TOKEN}" },
});

// 3. Submit.
const { runId, sessionId } = await api("POST", "/api/run", {
  prompt: "Use get_watchlist for the list and https://api.open-meteo.com/v1/forecast for data. " +
          "Write ../artifacts/report.md. Token is in $DEMO_TOKEN (don't print it). " +
          "Smoke-test it, then follow the script-gen skill.",
  mode: "yolo",
});

// 4. Poll.
let c;
do { ({ run: c } = await api("GET", `/api/run/${runId}`)); console.log("status:", c.status); if (!TERMINAL.has(c.status)) await sleep(2000); }
while (!TERMINAL.has(c.status));
console.log(c.tests, c.primaryArtifact);

// 5. Fetch the script.
if (c.status === "succeeded") {
  const res = await fetch(`${BASE}/api/workspace/file?session=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(c.primaryArtifact.path)}`, { headers: H });
  console.log(await res.text());
}
```

## One-shot (long-poll)

For short tasks, skip the poll loop with `?wait=true`:

```bash
curl -s -X POST "$BASE/api/run?wait=true&timeoutMs=120000" -H "x-api-key: $KEY" \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"…","mode":"yolo"}' | jq '.run.status'
```

Returns the contract when terminal, or `202` if it's still running (then poll).

## Re-running against a session (versioning)

Pass the `sessionId` from a prior run to refine on the same context — a new `seq`
with its own contract and artifact snapshot:

```bash
curl -s -X POST "$BASE/api/run" -H "x-api-key: $KEY" -H 'Content-Type: application/json' \
  -d "{\"sessionId\":\"$SID\",\"prompt\":\"Now add a --json flag to the script.\",\"mode\":\"yolo\"}"

curl -s "$BASE/api/sessions/$SID/runs" -H "x-api-key: $KEY" | jq   # version history
```

## Reference harness

A runnable, self-checking version of this flow (weather + crypto domains, tenant
A/B isolation, hang→timeout) ships in the repo:

- [`tests/e2e/run-e2e.js`](../../tests/e2e/run-e2e.js) — the live driver.
- [`tests/e2e/stub-mcp-server.js`](../../tests/e2e/stub-mcp-server.js) — a tiny
  stdio MCP datasource exposing `get_watchlist()`.

```bash
ORBIT_URL=http://localhost:6800 ORBIT_SUPERADMIN_KEY=… node tests/e2e/run-e2e.js weather
```
