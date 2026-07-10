# AegisAgent — Master Gap Analysis & Deficiency Report

> **Date:** 2026-07-10
> **Scope:** Full-stack audit of agent-backend, dashboard, mcp-server-lightpanda, and orchestration layers.
> **Methodology:** Line-by-line review of every source file. Cross-referenced component CSS variables against design tokens. Traced async flows, WebSocket protocol, security guard rules, and session lifecycle.

---

## Table of Contents

1. [Critical Deficiencies (Must Fix)](#1-critical-deficiencies)
2. [Backend Gaps](#2-backend-gaps)
3. [Frontend Gaps](#3-frontend-gaps)
4. [Architecture & DevOps Gaps](#4-architecture--devops-gaps)
5. [Security Gaps](#5-security-gaps)
6. [UX/UI Gaps](#6-uxui-gaps)
7. [Testing Gaps](#7-testing-gaps)
8. [Documentation Gaps](#8-documentation-gaps)

---

## 1. Critical Deficiencies

These are bugs or missing pieces that will cause runtime failures or security issues.

### 1.1 🚨 `os` module not imported in `security-guard.js`

**File:** `agent-backend/security-guard.js:21`
```js
return inputPath.replace(/^~/, os.homedir());
```

The `os` module is referenced but never required. Any path validation call with a `~` prefix will throw:
```
ReferenceError: os is not defined
```

**Fix:** Add `const os = require("os");` at the top of the file.

### 1.2 🚨 CSS variable name mismatches in frontend components

**Files:** `ChatMessage.jsx`, `MetricsPanel.jsx`, `SettingsPanel.jsx`, `LogViewer.jsx`, `ExecutionPlan.jsx`

Multiple components reference CSS variables that are NOT defined in `globals.css`:

| Variable used (in components) | Defined in globals.css? |
|---|---|
| `--text-main` | ❌ (should be `--text-primary`) |
| `--text-muted` | ❌ (should be `--text-secondary`) |
| `--text-dark` | ❌ (should be `--text-tertiary`) |
| `--border-color` | ❌ (should be `--border-default` or `--border-subtle`) |
| `--border-muted` | ❌ (should be `--border-subtle`) |
| `--primary` | ❌ (should be `--accent-primary`) |
| `--primary-foreground` | ❌ (should be `--text-inverse`) |
| `--primary-hover` | ❌ (should be `--accent-primary-hover`) |
| `--primary-glow` | ❌ (should be `--accent-primary-glow`) |
| `--info` | ❌ (should be `--accent-info`) |
| `--warning` | ❌ (should be `--accent-warning`) |
| `--success` | ❌ (should be `--accent-success`) |
| `--danger` | ❌ (should be `--accent-danger`) |
| `--input-bg` | ❌ |

**Impact:** Many color/style declarations silently fail, causing inconsistent visual rendering. Components may render with browser defaults instead of the designed palette.

### 1.3 🚨 `dangerouslySetInnerHTML` without sanitization

**File:** `dashboard/src/components/ChatMessage.jsx:284`
```jsx
dangerouslySetInnerHTML={renderMarkdown(message.content)}
```

**File:** `dashboard/src/app/page.js` — `renderMarkdown()` function

The markdown is rendered with `marked.parse()` and injected via `dangerouslySetInnerHTML` with NO HTML sanitization. Since the assistant's response comes from an AI model (potentially untrusted content), this is an XSS vector.

**Fix:** Use DOMPurify or similar sanitization after `marked.parse()` and before injection.

### 1.4 🚨 LiteLLM API key hardcoded as fallback

**File:** `agent-backend/server.js:18`
```js
const apiKey = process.env.LITELLM_KEY || "sk-7QU3mNiOzn3Wpgy_qwPn0Q";
```

A real API key is hardcoded in source. This is a credential leak. If this repo is ever made public or shared, the key is exposed.

**Fix:** Remove the fallback. Make `LITELLM_KEY` required. Add validation on startup.

### 1.5 🚨 `page.js` is 1218 lines — monolithic component

The main dashboard page contains:
- WebSocket connection management
- Session CRUD logic
- TTS streaming queue
- Speech recognition
- Markdown rendering
- State management for ~20 pieces of state
- All event handlers for every sub-component
- Configuration fetching

This is unmaintainable at this size. It needs to be broken into custom hooks and smaller components.

---

## 2. Backend Gaps

### 2.1 Monolithic server.js (1315 lines)

`server.js` contains:
- Express server setup
- All API routes
- WebSocket server
- Agent spawning logic
- Pi RPC protocol parsing
- TTS summary generation
- Notification dispatch
- Mode enforcement
- Path validation
- Metrics tracking integration

**Recommendation:** Split into:
- `routes/config.js` — config CRUD
- `routes/sessions.js` — session persistence
- `routes/models.js` — model listing, TTS proxy
- `routes/notifications.js` — notification dispatch
- `ws/handler.js` — WebSocket message dispatch
- `ws/agent-spawner.js` — Pi agent lifecycle
- `ws/pi-parser.js` — stdout JSON line parsing
- `middleware/error-handler.js` — Express error middleware

### 2.2 No Express error handling middleware

There is no centralized error handler. Every route uses inline try/catch with manual `res.status(500).json(...)`. This leads to:
- Inconsistent error response shapes
- Missed errors from unhandled promise rejections
- No error logging aggregation

### 2.3 No input validation on API endpoints

POST bodies are accepted without schema validation:
- `/api/config` — could receive any shape
- `/api/sessions` — no validation of session object shape
- `/api/sessions/import` — only checks for `id` and `title` existence
- `/api/notify` — only checks for `title` presence

### 2.4 No authentication/authorization on API or WebSocket

The backend has zero auth. Anyone on the network can:
- View and delete all sessions
- Change security config (HITL bypass)
- Send prompts as any agent mode
- Execute arbitrary commands through the agent

### 2.5 No rate limiting

WebSocket messages and HTTP endpoints have no rate limiting. A malicious or buggy client could flood the server.

### 2.6 Subagent mode inheritance is tracked but not enforced

`SubagentTracker` correctly tracks mode inheritance, but the security guard (`security-guard.js`) does not use it. When a subagent spawns in YOLO mode under a Plan-mode parent, the subagent's actual operation mode on the Pi side is not separately verified — the agent itself must follow the prompt-level instructions.

### 2.7 Fragile Pi RPC stdout parsing

```js
piProcess.stdout.on("data", (data) => {
  stdoutBuffer += data.toString();
  const lines = stdoutBuffer.split("\n");
  stdoutBuffer = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    try { const item = JSON.parse(line); ... }
    catch (e) { console.log(`[Pi Out Parse Error] ${line}`); }
  }
});
```

If a non-JSON line is sent by Pi, it silently drops. Also, large JSON objects might span line boundaries and get split — the current line-based parsing would fail.

### 2.8 MCP client has no reconnection logic

`mcp-client.js` connects once on startup. If the Lightpanda container restarts or the connection drops, the MCP client is dead for the remainder of the server's lifetime.

### 2.9 DB backups flooding the filesystem

`db.js` creates a backup every 10 saves, but never prunes old backups. The `agent-backend/backups/` directory has 36+ JSON files. 

**Recommendation:** Add backup retention policy (keep last N backups or prune after M days).

### 2.10 Missing `os` import in `security-guard.js` (Critical — see §1.1)

### 2.11 No graceful shutdown

`SIGTERM`/`SIGINT` handling is missing. On shutdown:
- Active Pi processes are not killed
- WebSocket connections are not cleanly closed
- DB is not properly closed
- Metrics are not persisted

### 2.12 Hardcoded `localhost` in notification dispatch

`/api/notify` calls `notify-send` which only works on Linux with a desktop environment. There's no fallback for headless servers or macOS.

### 2.13 Hybrid plan generation prompt is hardcoded

```js
const planPrompt = `You are a reasoning and planning assistant.
Given the following user request, generate a detailed step-by-step plan...
`;
```

This cannot be customized without editing server code.

### 2.14 Temp prompt files are never cleaned up

```js
const tempPromptPath = path.join(tempPromptDir, `system-prompt-${sessionId}.md`);
fs.writeFileSync(tempPromptPath, combinedPrompt, "utf-8");
```

Prompt files accumulate in `workspace/temp/` and are never deleted.

### 2.15 No health check endpoint

No `GET /api/health` endpoint. Cannot be used with load balancers or monitoring tools.

### 2.16 Node.js SQLite sync API usage

`db.js` uses `DatabaseSync` which blocks the event loop during DB operations. For a server handling WebSocket messages, this could cause latency spikes on large DB operations.

### 2.17 Metrics auto-save interval is not configurable

Hardcoded 30-second interval. Should be configurable.

---

## 3. Frontend Gaps

### 3.1 Monolithic page.js (1218 lines) — see §1.5

### 3.2 CSS variable name mismatches — see §1.2

### 3.3 XSS via markdown rendering — see §1.3

### 3.4 No error boundaries

React error boundaries are not implemented. Any unhandled error in a child component will crash the entire app to a white screen.

### 3.5 No loading/skeleton states for async data

- Config fetch shows nothing while loading
- Session switching shows a flash of old content
- Model list fetch has no loading indicator
- WebSocket reconnection has no visual feedback until reconnected

### 3.6 State management is scattered

There is no centralized state store. State is passed through deep prop drilling:
- `page.js` holds all state
- Passes through `AppShell` → `ChatArea` → `ChatInput`
- Some refs, some state, some derived values — inconsistent patterns

### 3.7 WebSocket message handler is a massive switch-case

`ws.onmessage` in `page.js` handles ~15 different message types inline. This is 300+ lines of nested state mutations.

### 3.8 TTS streaming logic is fragile

The TTS queue system:
- Uses Symbol-based session tracking
- Has no error recovery for failed audio playback
- Doesn't handle browser autoplay policies
- Audio blob URLs are never revoked (memory leak)

### 3.9 Speech recognition has no error UX

When STT fails, only `console.error` is called. The user gets no visual feedback about the failure.

### 3.10 Debounced session save to localStorage + backend

Sessions are saved every second via debounce, but:
- If the user closes the tab during that second, the last state is lost
- Backend save failures are silently caught
- localStorage quota errors are not handled

### 3.11 Search in SessionList has no debounce

Every keystroke triggers a filter re-render but also updates localStorage instantly.

### 3.12 "Load older messages" is scroll-based with fragile position restoration

Uses `requestAnimationFrame` to adjust scroll position, which can be janky.

### 3.13 Screenshot viewer is minimal

No zoom, pan, fullscreen, or comparison mode. The screenshot is just an `<img>` with `object-fit: contain`.

### 3.14 No responsive image handling

Screenshots and other images have no responsive breakpoints or lazy loading.

### 3.15 Mixed inline styles and CSS classes

Some components use CSS module classes, some use inline `style` objects, some use Tailwind utility classes. Three different styling approaches in the same codebase.

### 3.16 ChatArea does not virtualize the message list

For sessions with hundreds of messages, all are rendered in the DOM simultaneously. No windowing/virtualization.

### 3.17 `marked` is imported but may have breaking API changes

`marked` v18 uses a different API than v4. The code uses `marked.parse()` which should work, but the import is at the top level of `page.js` where it's client-only.

### 3.18 FOUC (Flash of Unstyled Content) mitigation is incomplete

`ThemeScript.js` exists but is a simple inline script. If the page loads slowly, there may still be a flash.

### 3.19 No offline/PWA support

No service worker, no offline caching, no manifest. The app requires a constant network connection.

### 3.20 Inconsistent component APIs

`ModePrompt` and `ModeBadge` are in the same file but exported as named exports. Other components use default exports. The component organization is inconsistent.

---

## 4. Architecture & DevOps Gaps

### 4.1 No Docker Compose for full stack

The README mentions Docker for Lightpanda but there's no `docker-compose.yml` that brings up:
- Lightpanda browser container
- Agent backend
- Dashboard (Next.js)
- (Optional) LiteLLM proxy

### 4.2 No environment validation on startup

The server doesn't validate that required env vars are set. It just crashes or uses hardcoded fallbacks.

### 4.3 No structured logging

All logs use `console.log` / `console.error`. No log levels, no structured format (JSON), no log aggregation.

### 4.4 No metrics export endpoint

The rich metrics system (token tracking, latency, subagent counts) has no export endpoint for Prometheus or similar monitoring.

### 4.5 Session data has no TTL enforcement at query time

`db.js` has TTL enforcement in `getAllSessions()` but not in `getSession()` or `searchSessions()`. Expired sessions could leak.

### 4.6 Backup rotation is missing

`db.js` creates backups but never cleans them. 36+ backup files accumulated.

### 4.7 Pi CLI binary path is hardcoded

```js
const nodePath = "/home/blanco/.local/share/pi-node/...";
const piPath = "/home/blanco/.local/share/pi-node/...";
```

This only works on the developer's machine. Should use env vars or auto-discovery.

### 4.8 No CI/CD pipeline

No GitHub Actions, no linting in CI, no automated tests, no deployment automation.

### 4.9 MCP server has no health endpoint

No way to check if the browser connection is alive without making a tool call.

### 4.10 Lightpanda connection is not monitored

If the Lightpanda Docker container dies, the MCP client doesn't detect it until the next tool call fails.

---

## 5. Security Gaps

### 5.1 Hardcoded API key in source — see §1.4

### 5.2 No authentication — see §2.4

### 5.3 XSS via unsanitized markdown — see §1.3

### 5.4 No HTTPS support

Both the backend and dashboard use plain HTTP. In a localhost-only deployment this is acceptable, but if exposed on a network, all data (including API keys in config payloads) is transmitted in cleartext.

### 5.5 Security config is writable without auth

Anyone can POST to `/api/config` and disable all security measures (HITL, blocked paths, requireApproval).

### 5.6 Session data stored in localStorage unencrypted

Session history (including API keys visible in config/settings screenshots) is stored in localStorage with no encryption.

### 5.7 No CORS restrictions

```js
app.use(cors());
```

Allows requests from any origin. Should be restricted to the dashboard's origin.

### 5.8 SQLite database has no encryption

`aegis.db` stores all session data (messages, logs, metrics) in plaintext.

### 5.9 temp prompt files may contain API keys

Combined prompts (system + mode-specific) are written to disk in `workspace/temp/` and never cleaned up. If the system prompt contains sensitive directives, they're exposed on disk.

---

## 6. UX/UI Gaps

### 6.1 No onboarding flow

New users see an empty chat with "AegisAgent Active" — no guided setup, no mode explanation, no quick-start.

### 6.2 Mode selection is confusing

There are two places to set mode:
1. The `ModePrompt` shown when no mode is set
2. The `ModeSelector` dropdown in the input bar
3. The settings panel

These can get out of sync and the relationship between "session mode" and "what the agent actually does" is unclear to new users.

### 6.3 No confirmation for destructive actions

- Deleting a session has no confirmation dialog (only the trash icon appears)
- Killing an active agent process has no confirmation
- YOLO mode has no explicit "I understand the risks" acknowledgment

### 6.4 Status indicator is cryptic

The status dot cycles through "thinking", "executing", "done" but there's no explanation of what these mean or how long the operation might take.

### 6.5 No estimated time remaining

Long-running operations show no progress bar or ETA. The user just sees a pulsing dot.

### 6.6 No keyboard shortcuts

Common operations have no keyboard shortcuts:
- `Ctrl+K` for command palette
- `Ctrl+N` for new session
- `Ctrl+Enter` for send
- `Escape` to cancel/interrupt

### 6.7 No dark/light mode transition animation

Theme switching is instant with no smooth transition.

### 6.8 Chat messages don't show timestamps

Individual messages have no "sent at" timestamp. Only session-level timestamps exist.

### 6.9 No message actions

Messages have no:
- Copy button
- Retry button
- Edit-and-resend functionality
- "Copy as markdown" option

### 6.10 No notification center

Proactive notifications go to the desktop and logs, but there's no dedicated notification center in the UI.

### 6.11 Settings panel crammed with too many options

All settings (model, voice, mode, paths, prefixes, compaction, HITL) are in one long scrollable panel. There's no grouping with collapsible sections.

### 6.12 No responsive font scaling

Font sizes are hardcoded in pixels/rem. No relative scaling for large displays or accessibility needs.

### 6.13 Session rename is missing

Sessions auto-name from the first user message but cannot be renamed manually.

---

## 7. Testing Gaps

### 7.1 Only one test file exists

`tests/test_security_guard.js` is the only test. It covers:
- Path validation (5 scenarios)
- Command validation (8 scenarios)

No tests for:
- API endpoints
- WebSocket protocol
- DB operations
- Frontend components
- Agent spawning
- Pi RPC parsing
- Metrics tracking
- Subagent tracker
- Mode enforcement

### 7.2 No test framework configured

`package.json` test script is `echo "Error: no test specified"`.

### 7.3 No frontend tests

No Jest, Vitest, or React Testing Library. Zero component tests.

---

## 8. Documentation Gaps

### 8.1 README is outdated

References "Vite + React + Vanilla CSS" but the project uses Next.js 16 + Tailwind.

### 8.2 No API documentation

No OpenAPI spec, no Postman collection, no inline API docs.

### 8.3 No architecture decision records (ADRs)

No documentation of why certain decisions were made (WebSocket vs SSE, SQLite vs PostgreSQL, etc.).

### 8.4 No contributing guide

No instructions for setting up a dev environment or contributing code.

### 8.5 No changelog

No versioning or changelog tracking.

---

## Summary: Priority Matrix

| # | Issue | Severity | Effort | File(s) |
|---|---|---|---|---|
| 1 | Missing `os` import in security-guard | 🔴 Critical | Low | `security-guard.js` |
| 2 | XSS via unsanitized markdown | 🔴 Critical | Low | `page.js`, `ChatMessage.jsx` |
| 3 | Hardcoded API key in source | 🔴 Critical | Low | `server.js` |
| 4 | CSS variable mismatches (12+ vars) | 🟠 High | Medium | 5+ components |
| 5 | Monolithic page.js (1218 lines) | 🟠 High | High | `page.js` |
| 6 | Monolithic server.js (1315 lines) | 🟠 High | High | `server.js` |
| 7 | No authentication on API/WS | 🟠 High | High | Backend |
| 8 | No error boundaries in React | 🟠 High | Medium | Frontend |
| 9 | No input validation on API | 🟡 Medium | Medium | Backend |
| 10 | No graceful shutdown | 🟡 Medium | Medium | Backend |
| 11 | Backup rotation missing | 🟡 Medium | Low | `db.js` |
| 12 | Hardcoded Pi binary paths | 🟡 Medium | Low | `server.js` |
| 13 | No health check endpoint | 🟡 Medium | Low | Backend |
| 14 | No loading/skeleton states | 🟡 Medium | Medium | Frontend |
| 15 | No keyboard shortcuts | 🟢 Low | Medium | Frontend |
| 16 | No Docker Compose | 🟢 Low | Medium | Root |
| 17 | Missing documentation | 🟢 Low | Medium | Various |
| 18 | No test infrastructure | 🟢 Low | High | Root |
