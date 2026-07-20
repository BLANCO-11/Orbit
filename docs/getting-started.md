# Getting started

## Prerequisites

- **Node.js 22+** (the backend uses `node:sqlite`).
- **pi** (`@earendil-works/pi-coding-agent`) on `PATH` for the default local
  harness — or run the Docker image, which bakes it in.
- An **LLM endpoint** (OpenAI-compatible). Configure it in `.env` /
  Settings › Models.
- **Docker** (optional) — only needed for the container sandbox and the Compose
  deployment.

## Install & run

### Option A — local (dev)

```bash
git clone <repo> && cd Orbit
./setup.sh                 # installs deps for backend + dashboard
cp .env.example .env       # then edit: LLM endpoint, key, ports
npm run dev                # backend :6800 + dashboard :6801
# open http://localhost:6801
```

### Option B — Docker Compose (prod-style, Postgres)

```bash
docker compose up -d --build          # orbit + postgres + lightpanda
# open http://localhost:6801
```

The Compose stack runs the backend on **:6800** and the dashboard on **:6801**,
uses Postgres, and persists data under the `orbit-data` volume
(`ORBIT_HOME=/data/orbit-home`). Source is **baked into the `orbit:latest`
image**, so rebuild (`docker compose up -d --build orbit`) to pick up code
changes.

> The dev override (`docker-compose.dev.yml`) bind-mounts source for HMR — see
> the [README](../README.md#docker).

## Ports

| Port | Serves |
|---|---|
| **6800** | Backend REST API + WebSocket (`/api/*`, `/api/ws`). The canonical API port. |
| **6801** | Dashboard UI. Proxies `/api` to the backend, so REST also works here. |

The backend binds to `127.0.0.1` only. To expose it beyond loopback, set
`ORBIT_SUPERADMIN_KEY` first (see [Authentication](./integration/authentication.md)).

## Your first task (UI)

1. Open `http://localhost:6801`.
2. Pick a **mode** (start with `chat`) and an **effort** (`balanced`).
3. Type a request and send. Watch the reply stream, with reasoning, tool calls,
   and any sub-agents in the inspector tabs.
4. For work that writes files or runs commands, switch to `edit` or `yolo` — the
   [policy matrix](./concepts.md#policy--modes) governs what each mode allows.

See the [User guide](./user-guide.md) for the full console tour.

## Your first task (headless API)

```bash
# In dev-mode (no ORBIT_SUPERADMIN_KEY set) every caller is superadmin.
BASE=http://localhost:6800

# Submit a run and wait (long-poll) for the contract.
curl -s -X POST "$BASE/api/run?wait=true&timeoutMs=120000" \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Write a Python script that prints the 10 largest files under the current dir, smoke-test it, and follow the script-gen skill.","mode":"yolo"}'
```

You get back a **result contract** (status, artifacts, tests, usage). See the
[Run API](./integration/run-api.md) for the full shape and the poll-based
(non-blocking) pattern.

## Next steps

- [Concepts](./concepts.md) — the mental model.
- [Configuration](./configuration.md) — env vars and settings.
- [Integration guide](./integration/README.md) — build on the backend.
