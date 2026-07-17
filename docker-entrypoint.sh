#!/usr/bin/env bash
# Run the backend and the dashboard in one container. The dashboard proxies
# /api and /api/ws to the backend on 127.0.0.1:6800, so both must share this
# network namespace.
#
# Mode is driven by NODE_ENV (set per Docker target / compose file):
#   production  → dashboard serves the prebuilt .next (dashboard/server.js, dev=false)
#   development → dashboard runs `next dev` with HMR (dashboard/server.js, dev=true)
# dashboard/server.js picks dev vs prod from NODE_ENV itself, so the command is
# the same either way — we just run it from the dashboard/ dir so Next resolves
# its project (and .next) there, not at /app.
#
# Ports/host are FORCED per-process here, overriding whatever the environment (or
# an env_file'd .env) provides. This is deliberate: the backend and dashboard
# both read process.env.PORT, and a host .env often sets PORT=6800 / HOST=0.0.0.0
# for a bare-metal + nginx setup — which would collide (dashboard would grab 6800)
# and expose the backend. In-container the split is fixed: backend on internal
# 127.0.0.1:6800, dashboard (the only published port) on 0.0.0.0:6801.
set -euo pipefail

echo "[entrypoint] starting Orbit (NODE_ENV=${NODE_ENV:-production})"

# Backend PORT is always forced (both processes read process.env.PORT, so a
# shared value would collide). HOST is honored from the environment so an
# EXTERNAL nginx that proxies /api straight to the backend's 6800 can reach it
# (set HOST=0.0.0.0 + publish 6800); it defaults to internal-only 127.0.0.1.
PORT=6800 HOST="${HOST:-127.0.0.1}" node agent-backend/server.js &
backend=$!

( cd dashboard && PORT=6801 exec node server.js ) &
dashboard=$!

shutdown() { kill "$backend" "$dashboard" 2>/dev/null || true; }
trap shutdown TERM INT

# If either process exits, tear down the other so the container restarts clean.
wait -n "$backend" "$dashboard"
shutdown
wait || true
