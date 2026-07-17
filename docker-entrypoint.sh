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
# NOTE: do NOT set a global PORT env — the backend and dashboard BOTH read
# process.env.PORT and would collide; leave them on their defaults (6800 / 6801).
set -euo pipefail

echo "[entrypoint] starting Orbit (NODE_ENV=${NODE_ENV:-production})"

node agent-backend/server.js &
backend=$!

( cd dashboard && exec node server.js ) &
dashboard=$!

shutdown() { kill "$backend" "$dashboard" 2>/dev/null || true; }
trap shutdown TERM INT

# If either process exits, tear down the other so the container restarts clean.
wait -n "$backend" "$dashboard"
shutdown
wait || true
