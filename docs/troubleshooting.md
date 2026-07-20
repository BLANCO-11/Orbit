# Troubleshooting

## Runs

### A run comes back `needs_review`
The agent finished but didn't leave a valid `artifacts/RESULT.json`. This is the
contract refusing a false success — not a plumbing error. Common causes:

- **Weak model** skipped the reporting step. The backend already sends one
  auto-nudge turn; if it still fails, use a stronger model (Settings › Models) or
  `effort: "deep"`.
- **`RESULT.json` is malformed.** Check `raw.resultJsonErrors` in the contract —
  it lists the exact schema problems.
- Inspect the artifacts anyway via `GET /api/workspace/file?session=…&path=…`.

### A run ends `timeout`
It hit a watchdog. Either the task genuinely hung (no harness events for
`ORBIT_RUN_IDLE_MS`, default 180s) or exceeded the absolute backstop
(`ORBIT_RUN_MAX_MS`, default ~20 min). Raise them per-run via the `timeouts`
field, or globally via env. A script that `sleep`s forever will always time out —
by design.

### A run ends `error`
The agent turn failed (provider/content-policy/rate-limit/spawn) or was cancelled.
The `error` field has a hint; full detail is in the session logs
(`GET /api/sessions/:id` → `logs`, or the server log).

### The run never leaves `running`
- Confirm the backend can reach your LLM endpoint (`GET /api/models`).
- Check the server log for spawn errors.
- The watchdogs guarantee a terminal status eventually; if it's stuck past
  `ORBIT_RUN_MAX_MS`, check that the process isn't blocked on a slow image pull
  (see below).

## Sandbox / Docker

### First container run is slow, then fine
`--pull missing` fetches the image once on first use, then caches it. Pre-pull to
avoid the cold start:

```bash
docker pull nikolaik/python-nodejs:python3.12-nodejs22-slim
```

### `Docker isn't available` / runs fall back to host
The container sandbox needs a reachable Docker daemon. The run API **downgrades
container→host** automatically (so it still returns a terminal contract), but for
real isolation:

- On a bare-metal host: ensure `docker info` works for the backend's user.
- **Inside a Dockerized Orbit** (`orbit-orbit-1`): the container has no Docker by
  default, so runs execute in the orbit container's own filesystem. For true
  per-run container isolation, mount the host socket into the orbit service:
  `-v /var/run/docker.sock:/var/run/docker.sock` (docker-out-of-docker).

### Air-gapped host
Set `ORBIT_SANDBOX_PULL=never` and pre-load the image (`docker load`), or point
`ORBIT_SANDBOX_IMAGE` at an internal registry tag you've mirrored.

### Generated python/node scripts fail to run in the sandbox
The default image ships both. If you overrode `ORBIT_SANDBOX_IMAGE` with a
node-only or python-only image, scripts in the other language will fail — use an
image with both, or a base with the language you need.

## Auth

### `401 Unauthorized`
- Send the key as `x-api-key: <key>` or `Authorization: Bearer <key>`.
- If `ORBIT_SUPERADMIN_KEY` is set, dev-mode is off — you need a valid key.
- Verify with `GET /api/auth/whoami`.

### `403 Forbidden` on secrets/connectors writes
Writes require **member+**; viewers are read-only. Mint a member key
(see [Authentication](./integration/authentication.md)).

### `404` on a run/session that exists
Tenant isolation: you can only see your own tenant's runs/sessions. A run created
by tenant A returns 404 to tenant B — that's the isolation working.

## Secrets & connectors

### The script can't read my secret
- The env-var **name** must match exactly (`os.environ["NAME"]`).
- Reserved names (`ORBIT_*`, `OPENAI_*`, `PATH`, `HOME`, `NODE_*`, …) are
  **not** injected — rename the secret.
- Confirm it exists: `GET /api/secrets` (shows names + `hasValue`).

### `${secret:NAME}` shows up literally in a connector
The name doesn't exist for that tenant (typo, or created under a different
tenant). Unknown references are intentionally left literal (never resolved
cross-tenant). Fix the name or add the secret.

### A tenant connector's stdio `command` isn't found in the container
Host-absolute `command` paths may not resolve inside the container sandbox. Use
an HTTP (`url`) connector, or an image that contains the command.

## Ports & connectivity

- Backend REST + WS: **:6800**. Dashboard: **:6801** (proxies `/api`).
- The backend binds `127.0.0.1` only. To expose it, set `HOST=0.0.0.0`, set
  `ORBIT_SUPERADMIN_KEY`, and firewall the port to your proxy. See the reverse-
  proxy recipes in the [README](../README.md#reverse-proxy-tls--websocket-harness).

## Database

- Driver resolution: `ORBIT_DB_DRIVER` → else `DATABASE_URL` → postgres → else
  sqlite. Check the boot log line `[DB] Using <driver> adapter.`
- Schema migrations run automatically on boot (`[DB] Migrated … to version N`).
- Encrypted data (secrets, tokens) becomes unreadable if `ORBIT_SECRET` changes
  or the generated key file is lost — pin `ORBIT_SECRET` for portability.

## Still stuck?

- Server log: `/tmp/orbit-backend.log` (via `restart-orbit.sh`) or
  `docker logs orbit-orbit-1` (Compose).
- Run the offline test suite to confirm the core is healthy:
  `npm test`.
- Endpoint reference: [`../API.md`](../API.md).
