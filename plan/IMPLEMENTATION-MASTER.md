# AegisAgent — Implementation Master Plan

> **Status:** 🟡 Plans Finalized — Awaiting review and implementation
> **Last Updated:** 2026-07-10
> **Base Commit:** `b34600e` — plans committed

---

## Phase Overview

| Phase | Name | Status | Plan File |
|---|---|---|---|
| 0 | Critical Bug Fixes | ⬜ Not Started | BACKEND-PLAN.md §0 |
| 1 | Backend: Code Modularization | ⬜ Not Started | BACKEND-PLAN.md §1 |
| 2 | Backend: Agent Harness Abstraction | ⬜ Not Started | BACKEND-PLAN.md §2 |
| 3 | Backend: Metrics System Fix | ⬜ Not Started | BACKEND-PLAN.md §3 |
| 4 | Backend: Sub-Agent Deep Tracking | ⬜ Not Started | BACKEND-PLAN.md §4 |
| 5 | Backend: Security Hardening | ⬜ Not Started | BACKEND-PLAN.md §5 |
| 6 | Backend: Reliability | ⬜ Not Started | BACKEND-PLAN.md §6 |
| 7 | Backend: Observability | ⬜ Not Started | BACKEND-PLAN.md §7 |
| 8 | Backend: API Enhancements + Workspace Preview | ⬜ Not Started | BACKEND-PLAN.md §8 |
| F1 | Frontend: Theme System | ⬜ Not Started | FRONTEND-PLAN.md §2 |
| F2 | Frontend: State Architecture | ⬜ Not Started | FRONTEND-PLAN.md §7 |
| F3 | Frontend: Layout + Chat Redesign | ⬜ Not Started | FRONTEND-PLAN.md §3-4 |
| F4 | Frontend: Detail Panel + Sub-Agent Tracking | ⬜ Not Started | FRONTEND-PLAN.md §5-6 |
| F5 | Frontend: Polish (Commands, Notif, A11y) | ⬜ Not Started | FRONTEND-PLAN.md §8 |

---

## Backend Implementation Order

### Phase 0 — Critical Fixes (0.5h)
- [ ] Fix missing `os` import in `server.js`
- [ ] Remove hardcoded LiteLLM API key from `server.js` and `security-config.json`
- [ ] Guard `ws.currentPrompt` null reference
- [ ] Gitignore `security-config.json`

### Phase 1 — Modularization (6h)
- [ ] Extract: `env.js`, `config.js`, `ws/session-helpers.js`
- [ ] Extract: `harnesses/picode/parser.js` (from `ws/pi-parser.js`)
- [ ] Extract: `services/tts.js`, `services/plan-generator.js`
- [ ] Extract: `ws/agent-spawner.js` (dependency-injected)
- [ ] Extract: `ws/handler.js`, `ws/index.js`
- [ ] Extract: `routes/config.js`, `sessions.js`, `models.js`, `notifications.js`
- [ ] Create: `middleware/error-handler.js`, `request-id.js`
- [ ] Rewrite: `server.js` entry point (~100 lines)

### Phase 2 — Harness Abstraction (3.5h)
- [ ] Create: `harnesses/interface.js` (abstract base)
- [ ] Create: `harnesses/normalizer.js`
- [ ] Refactor: PiCode into `harnesses/picode/` (index + spawner)
- [ ] Add: harness config to `security-config.json`
- [ ] Add: harness selector in SettingsPanel

### Phase 3 — Metrics Fix (2h)
- [ ] Fix: `recordInputTokens` → `recordOutputTokens` in `metrics.js`
- [ ] Add: `recordInputTokens` call on user prompt
- [ ] Add: `aggregateSubagentTokens` for proper rollup
- [ ] Enrich: metrics WebSocket event with input/output/reasoning breakdown
- [ ] Add: Claude Code-style cost estimation

### Phase 4 — Sub-Agent Deep Tracking (3h)
- [ ] Enhance: `SubagentTracker` with `addReasoningDelta`, `addTextDelta`, `getFullDetail`
- [ ] Wire: sub-agent deep events in `agent-spawner.js`
- [ ] Add: `GET /api/sessions/:id/subagent/:subagentId` endpoint

### Phase 5 — Security (3.5h)
- [ ] Add: Zod validation (`middleware/validator.js`)
- [ ] Add: API key auth (`middleware/auth.js`)
- [ ] Add: Rate limiting (`middleware/rate-limiter.js`)
- [ ] Add: CORS restriction
- [ ] Add: Session encryption in `db.js`
- [ ] Add: Temp file cleanup

### Phase 6 — Reliability (3h)
- [ ] Add: Graceful shutdown handler
- [ ] Add: MCP client reconnection
- [ ] Add: `GET /api/health`
- [ ] Add: Backup retention policy
- [ ] Add: Configurable metrics save interval

### Phase 7 — Observability (2.5h)
- [ ] Add: Pino structured logging
- [ ] Add: Prometheus metrics endpoint

### Phase 8 — API + Workspace (2.5h)
- [ ] Add: `PATCH /api/sessions/:id` (rename)
- [ ] Add: Enhanced `searchSessions` with pagination
- [ ] Add: TTS health check
- [ ] Add: Hybrid plan prompt configurability
- [ ] **Add: Workspace Preview API** — tree, file, preview, open-in-editor

---

## Frontend Implementation Order

### F1 — Theme System (6h)
- [ ] Create `lib/themes.js` — 6 built-in themes
- [ ] Rewrite `hooks/useTheme.js` — load/apply/save/custom themes
- [ ] Rewrite `globals.css` — use only CSS vars from theme system
- [ ] Create `ThemeEditor.jsx` — color picker UI
- [ ] Update SettingsPanel with Themes tab
- [ ] Fix all CSS variable references in ALL components

### F2 — State Architecture (7.5h)
- [ ] Create `providers/AegisProvider.jsx` — context + reducer
- [ ] Create `hooks/useWebSocket.js`
- [ ] Create `hooks/useSessions.js`
- [ ] Create `hooks/useAgent.js`
- [ ] Create `hooks/useTTS.js` + `hooks/useSTT.js`
- [ ] Refactor `page.js` → thin orchestrator (~80 lines)

### F3 — Layout + Chat Redesign (6h)
- [ ] Redesign `AppShell.jsx` — 4-zone layout
- [ ] Redesign `Header.jsx` — clean, minimal
- [ ] Redesign `Sidebar.jsx` — Apple Mail style
- [ ] Redesign `ChatMessage.jsx` — text-block style, inline tools
- [ ] Redesign `ChatInput.jsx` — clean input strip
- [ ] Redesign `ChatArea.jsx`

### F4 — Detail Panel + Sub-Agent Tracking (6h)
- [ ] Create `panels/DetailPanel.jsx` with tab system
- [ ] Create `panels/AgentTab.jsx` — sub-agent cards with deep tracking
- [ ] Wire enriched sub-agent WS events
- [ ] Create `panels/WorkspaceTab.jsx` — file tree + preview (split pane)
- [ ] Create `panels/PlanTab.jsx` — enhanced reasoning history
- [ ] Create `panels/LogsTab.jsx` — filtered log viewer

### F5 — Polish (7.5h)
- [ ] Command Palette (`Ctrl+K`)
- [ ] Notification Center
- [ ] DOMPurify markdown sanitization
- [ ] Skeleton loading states
- [ ] Error boundaries
- [ ] Keyboard shortcuts (full set)
- [ ] Message virtualization
- [ ] Accessibility audit + fixes

---

## Total Estimates

| Area | Hours |
|---|---|
| Backend (Phases 0-8) | ~28h |
| Frontend (Phases F1-F5) | ~33h |
| Testing (both) | ~6h |
| **Grand Total** | **~67h** (2-3 weeks) |

---

## Progress Log

| Date | Event |
|---|---|
| 2026-07-10 | Baseline commit `aef37b6` |
| 2026-07-10 | Master gap analysis created |
| 2026-07-10 | Frontend + Backend plans drafted (v1) |
| 2026-07-10 | Plans revised: added design vision, harness abstraction, metrics fix, sub-agent deep tracking, workspace preview, custom themes |
| 2026-07-10 | Plans committed at `b34600e` — awaiting review |

---

## Reference Files

- `plan/MASTER-GAP-ANALYSIS.md` — Full deficiency report (19.5KB)
- `plan/FRONTEND-PLAN.md` — Design vision + implementation (30KB)
- `plan/BACKEND-PLAN.md` — Architecture + all phases (72KB)
- `plan/IMPLEMENTATION-MASTER.md` — This file
- `progress.md` — Older progress tracking
