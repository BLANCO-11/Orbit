# 04 — Session Persistence Hardening

## Problem

Session persistence is partially implemented but has race conditions and reliability issues:

1. **Fire-and-forget save** — The `updateCurrentSession` function calls `fetch(.../api/sessions)` without awaiting, and errors are silently caught. If the backend is down, session data is lost.
2. **localStorage fallback is fragile** — localStorage has a ~5MB limit, no TTL, and can be cleared by the user
3. **No sync mechanism** — If multiple tabs are open, session state becomes inconsistent
4. **DB runs locally** — The SQLite database (`aegis.db`) is in `agent-backend/` and gets committed to git (it's currently modified)
5. **No session export/import** — Users can't back up or share sessions
6. **No session search** — The sidebar only shows a flat list with truncation

## Root Cause

Sessions were added as an afterthought — the `updateCurrentSession` pattern fires on every state change without debouncing, and the API calls are fire-and-forget. The `db.js` uses `node:sqlite` (Node 22+ built-in) which is fine but uses JSON serialization for structured fields (`messages`, `logs`, `metrics`).

## Solution

### Phase 1: Fix Current Implementation

**Debounce saves** — Don't save on every keystroke; debounce to once per second:

```javascript
// In page.js
const saveSessionDebounced = useRef(
  debounce((session) => {
    fetch(`${backendHttpUrl}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(session)
    }).catch(e => console.warn("Session save failed:", e));
  }, 1000)
).current;
```

**Add save confirmation** — Track the last saved state and only save when changed:

```javascript
const lastSavedState = useRef(null);

const saveIfChanged = (session) => {
  const stateKey = JSON.stringify({ messages: session.messages, logs: session.logs });
  if (stateKey !== lastSavedState.current) {
    lastSavedState.current = stateKey;
    saveSessionDebounced(session);
  }
};
```

**Add reconnection save** — On WebSocket reconnect, re-save the current session:

```javascript
// In connectWebSocket, after ws.onopen:
saveSessionDebounced(currentSession);
```

### Phase 2: Backend Improvements

**Backend (`agent-backend/db.js`):**
- [ ] Add auto-backup: periodically write a JSON export to a `backups/` directory
- [ ] Add migration support: add a `schema_version` field to handle future changes
- [ ] Add TTL: auto-delete sessions older than 30 days (configurable)
- [ ] Add search: SQLite FTS5 for session title/content search

**Backend (`agent-backend/server.js`):**
- [ ] Add `GET /api/sessions/search?q=...` endpoint for search
- [ ] Add `POST /api/sessions/export` and `POST /api/sessions/import` endpoints
- [ ] Add `GET /api/sessions/:id/messages` — paginate messages for large sessions

### Phase 3: Frontend Improvements

**Dashboard:**
- [ ] Add search bar to the session sidebar
- [ ] Add session date grouping ("Today", "Yesterday", "Last 7 days", "Older")
- [ ] Add session preview on hover (first few chars of last message)
- [ ] Add export button per session (download as JSON)
- [ ] Add delete confirmation dialog (not just click-to-delete)

### Phase 4: Future-Proofing

- [ ] Consider IndexedDB as primary storage (larger limit, better for structured data)
- [ ] Consider server-side session storage for multi-device sync
- [ ] Add compression for large session payloads

## Files to Change

```
agent-backend/db.js             # Add backup, migration, TTL, search
agent-backend/server.js         # Add search/export/import endpoints, pagination
dashboard/src/app/page.js       # Add debounce, save confirmation, reconnection save
dashboard/src/components/SessionList.jsx  # Add search, grouping, preview (new file)
```

## Implementation Order

1. Fix frontend fire-and-forget saves (debounce + state tracking)
2. Add reconnection save
3. Add search and grouping to session sidebar
4. Add backend search/export endpoints
5. Add backup/migration/TTL to db.js

## References

See [reference.md](./reference.md) for SQLite FTS5 docs and IndexedDB patterns.
