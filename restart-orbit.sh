#!/usr/bin/env bash
# restart-orbit.sh — run the CURRENT committed code cleanly.
# Kills stale backend/frontend, rebuilds the dashboard, and boots both.
# Use this after pulling changes so you're never testing a stale process.
set -u
cd "$(dirname "$0")"

echo "▸ Stopping anything on 6800/6801…"
fuser -k 6800/tcp 6801/tcp 2>/dev/null
sleep 1

echo "▸ Rebuilding dashboard…"
npm --prefix dashboard run build || { echo "build failed"; exit 1; }

echo "▸ Starting backend (6800) + dashboard (6801)…  (Telegram live)"
# Telegram poller runs (this is your real instance). Set TELEGRAM_DISABLE=1 before
# running this script if you want it off.
nohup node agent-backend/server.js                         > /tmp/orbit-backend.log  2>&1 &
BE=$!
nohup npm --prefix dashboard run start                     > /tmp/orbit-frontend.log 2>&1 &
FE=$!

# Wait for the dashboard to answer.
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:6801 >/dev/null 2>&1; then break; fi
  sleep 1
done

echo "✓ backend pid $BE (log: /tmp/orbit-backend.log)"
echo "✓ frontend pid $FE (log: /tmp/orbit-frontend.log)"
echo "✓ open http://localhost:6801"
echo "  (per-session files live under ~/.orbit/sessions/<id>/workspace)"
