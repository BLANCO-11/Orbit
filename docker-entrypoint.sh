#!/usr/bin/env bash
# Run the backend and the dashboard in one container. The dashboard proxies
# /api and /api/ws to the backend on 127.0.0.1:6800, so both must share this
# network namespace. NOTE: do NOT set a global PORT env — the backend and the
# dashboard BOTH read process.env.PORT and would collide; leave them on their
# defaults (6800 / 6801).
set -euo pipefail

node agent-backend/server.js &
backend=$!
node dashboard/server.js &
dashboard=$!

shutdown() { kill "$backend" "$dashboard" 2>/dev/null || true; }
trap shutdown TERM INT

# If either process exits, tear down the other so the container restarts clean.
wait -n "$backend" "$dashboard"
shutdown
wait || true
