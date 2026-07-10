# AegisAgent — Implementation Master Plan

> **Status:** 🔴 Audit Phase — Plans being drafted
> **Last Updated:** 2026-07-10
> **Base Commit:** `aef37b6` — baseline snapshot

---

## Phase Overview

| Phase | Name | Status | Owner |
|---|---|---|---|
| 0 | Critical Bug Fixes | ⬜ Not Started | TBD |
| 1 | Frontend UI/UX Professional Overhaul | 📋 Plan Drafting | Frontend Specialist |
| 2 | Backend Architecture & Gaps | 📋 Plan Drafting | Backend Specialist |
| 3 | Architecture & DevOps Hardening | ⬜ Not Started | TBD |
| 4 | Testing Infrastructure | ⬜ Not Started | TBD |
| 5 | Documentation & Polish | ⬜ Not Started | TBD |

---

## Phase 0: Critical Bug Fixes (MUST DO FIRST)

These are confirmed bugs that will cause crashes or security issues.

- [ ] Fix missing `os` import in `agent-backend/security-guard.js` (add `const os = require("os");`)
- [ ] Sanitize markdown output before `dangerouslySetInnerHTML` (add DOMPurify or similar)
- [ ] Remove hardcoded LiteLLM API key fallback from `agent-backend/server.js:18`
- [ ] Fix all CSS variable name mismatches (see §1.2 of gap analysis)
- [ ] Add `os` import to security-guard.js (line 1)

---

## Phase 1: Frontend UI/UX Overhaul

**Plan File:** `plan/FRONTEND-PLAN.md`
**Specialist:** Senior Frontend Engineer agent

### 1.1 Architecture Refactor
- [ ] Extract `page.js` into domain-specific hooks:
  - `useWebSocket(sessionId)` — WebSocket lifecycle + message dispatch
  - `useSessionManager()` — session CRUD + persistence
  - `useTTS()` — streaming TTS queue
  - `useSpeechRecognition()` — STT
  - `useAgentState()` — messages, logs, metrics, execution plan
- [ ] Create centralized state store (React Context or Zustand)
- [ ] Add ErrorBoundary wrapper
- [ ] Resolve all CSS variable mismatches (use only design-token variables)

### 1.2 Component Enhancement
- [ ] Add loading/skeleton states for all async operations
- [ ] Add proper timestamps on chat messages
- [ ] Add message actions (copy, retry, edit)
- [ ] Add confirmation dialogs for destructive actions
- [ ] Implement message list virtualization (react-window or similar)

### 1.3 UI/UX Professional Polish
- [ ] Design proper onboarding flow (guided setup)
- [ ] Add keyboard shortcuts (Ctrl+K command palette, Ctrl+N new session, etc.)
- [ ] Add smooth theme transition animation
- [ ] Add responsive font scaling
- [ ] Add session rename functionality
- [ ] Add notification center component
- [ ] Improve screenshot viewer (zoom, pan, fullscreen)
- [ ] Add offline/connection status indicator
- [ ] Improve settings panel organization (collapsible sections)
- [ ] Add estimated time/progress for long operations

### 1.4 Accessibility
- [ ] Fix all focus management
- [ ] Ensure WCAG 2.1 AA contrast for both themes
- [ ] Add screen reader announcements for dynamic content
- [ ] Add `aria-*` attributes to all interactive elements

---

## Phase 2: Backend Architecture & Gaps

**Plan File:** `plan/BACKEND-PLAN.md`
**Specialist:** Senior Backend Engineer agent

### 2.1 Code Modularization
- [ ] Split `server.js` into domain modules:
  - `routes/config.js`
  - `routes/sessions.js`
  - `routes/models.js`
  - `routes/notifications.js`
  - `ws/handler.js`
  - `ws/pi-parser.js`
  - `middleware/error-handler.js`
  - `middleware/validator.js`
- [ ] Add Express error handling middleware
- [ ] Add input validation (Zod or Joi schemas)

### 2.2 Security Hardening
- [ ] Add API key authentication middleware
- [ ] Add rate limiting on HTTP and WebSocket
- [ ] Restrict CORS to dashboard origin only
- [ ] Add HTTPS support docs/configuration
- [ ] Encrypt sensitive session data at rest

### 2.3 Reliability
- [ ] Add graceful shutdown handling (SIGTERM/SIGINT)
- [ ] Add MCP client reconnection with exponential backoff
- [ ] Add health check endpoint (`GET /api/health`)
- [ ] Add environment validation on startup
- [ ] Clean up temp prompt files after session ends
- [ ] Implement backup retention policy (keep last 10 backups)
- [ ] Make Pi binary paths configurable via env vars

### 2.4 Observability
- [ ] Add structured logging (pino or winston)
- [ ] Add Prometheus metrics export endpoint
- [ ] Add request ID middleware for tracing
- [ ] Log all API errors with stack traces

### 2.5 Feature Gaps
- [ ] Hybrid plan prompt configurable
- [ ] Session TTL enforcement on all query paths
- [ ] Configurable metrics save interval
- [ ] Session rename API endpoint
- [ ] Message-level timestamps in session storage

---

## Phase 3: Architecture & DevOps

- [ ] Create `docker-compose.yml` for full stack
- [ ] Add environment variable validation script
- [ ] Add npm scripts for common operations
- [ ] Create `.env.example` with all required vars
- [ ] Set up CI/CD pipeline (GitHub Actions)
- [ ] Add pre-commit hooks (linting, formatting)

---

## Phase 4: Testing Infrastructure

- [ ] Set up Jest/Vitest for backend testing
- [ ] Set up React Testing Library for frontend
- [ ] Add API endpoint tests
- [ ] Add WebSocket protocol tests
- [ ] Add DB operation tests
- [ ] Add security guard comprehensive tests
- [ ] Add Pi RPC parser tests
- [ ] Add E2E tests (Playwright)

---

## Phase 5: Documentation

- [ ] Update README.md (correct framework references)
- [ ] Create API documentation (OpenAPI spec)
- [ ] Create architecture overview diagram
- [ ] Create CONTRIBUTING.md
- [ ] Create CHANGELOG.md
- [ ] Document all environment variables

---

## Progress Log

| Date | What | Who |
|---|---|---|
| 2026-07-10 | Baseline commit `aef37b6` | System |
| 2026-07-10 | Master gap analysis created | System |
| 2026-07-10 | Frontend & Backend specialist agents spawned | System |

---

## References

- `plan/MASTER-GAP-ANALYSIS.md` — Full deficiency report
- `plan/UI-UX-OVERHAUL.md` — Existing UI/UX design system plan
- `plan/FRONTEND-PLAN.md` — (pending) Frontend specialist implementation plan
- `plan/BACKEND-PLAN.md` — (pending) Backend specialist implementation plan
- `progress.md` — Previous progress tracking
