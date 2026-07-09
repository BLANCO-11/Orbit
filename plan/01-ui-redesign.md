# 01 — Complete UI Redesign

## Problem

The current UI is a developer debug console, not a sellable product. Specific issues:

1. **~2200 lines of `page.js`** — nearly all inline styles (`style={{...}}`), no component decomposition
2. **Mixed visual metaphors** — Retro TUI panels (`tui-panel` with double borders + neon blue) alongside Shadcn glassmorphism cards
3. **No coherent brand identity** — The name "AegisAgent" appears, but no logo, no color system, no typography hierarchy
4. **Two competing layout modes** — "Show Logs" toggle switches between a 2-column roadmap view and single-column chat; confusing
5. **Settings are buried** — The right-side settings panel is crammed with security configs, model selectors, TTS settings, and file path lists — all visible at once
6. **Sessions sidebar is bare** — Just a list with trash icons, no search, no date grouping, no session preview
7. **No empty state / onboarding** — First-time users see a blank screen with "AegisAgent Active" text
8. **No responsive design** — Fixed layouts, no mobile support

## Root Cause

The UI was built as a functional prototype — focus on getting the agent working, not on user experience. The developer used inline styles for speed, and the visual design was never consolidated.

## Solution

### Phase 1: Component Architecture (No visual changes yet)

**Goal:** Extract inline styles into proper components using Tailwind classes

- [ ] Create `src/components/ChatMessage.jsx` — renders a single message bubble (user/assistant), handles tool calls
- [ ] Create `src/components/ChatInput.jsx` — the multi-line textarea with Shift+Enter support + auto-grow (see plan 03)
- [ ] Create `src/components/SessionList.jsx` — sidebar session list with search, date grouping, preview
- [ ] Create `src/components/MetricsPanel.jsx` — the metrics grid (latency, tokens, cost, tool calls)
- [ ] Create `src/components/ToolCallCard.jsx` — collapsible tool call display with expand/collapse
- [ ] Create `src/components/ExecutionPlan.jsx` — roadmap/plan display
- [ ] Create `src/components/LogViewer.jsx` — console log terminal view
- [ ] Create `src/components/SettingsPanel.jsx` — the settings sidebar
- [ ] Create `src/components/ApprovalBanner.jsx` — HITL approval prompt
- [ ] Create `src/components/Header.jsx` — top navbar
- [ ] Create `src/components/StatusIndicator.jsx` — status dot + text
- [ ] Create `src/components/ScreenshotViewer.jsx` — browser preview

### Phase 2: Visual Redesign

**Goal:** Coherent, modern, professional look

#### Brand Identity
- [ ] Define a color system: primary purple (#7c3aed), dark bg (#0a0a0b), accent teal for success states
- [ ] Define typography: Outfit (headings) + Inter (body) + JetBrains Mono (code)
- [ ] Add subtle branding: favicon, logo mark, loading states

#### Layout Changes
- [ ] **Remove** the retro TUI panel styling (`.tui-panel` class)
- [ ] **Replace** the "Show Logs / Hide Logs" toggle with a proper tab system or resizable split pane
- [ ] **Move** settings to a modal or a dedicated settings page (not a sidebar)
- [ ] **Clean up** the sessions sidebar — add search, session preview on hover, date grouping
- [ ] **Add** an onboarding/empty state with quick action cards ("Browse the web", "Run code", "Analyze files")

#### Visual Polish
- [ ] Remove the dual layout mode (single-column is cleaner)
- [ ] Use Tailwind `@apply` consistently instead of inline styles
- [ ] Add smooth transitions, loading skeletons, and proper focus states
- [ ] Fix the `bg-radial-glow` to be more subtle
- [ ] Ensure consistent border-radius, spacing, and shadow systems

### Phase 3: Responsive Design
- [ ] Add mobile breakpoints
- [ ] Collapsible sidebar on small screens
- [ ] Stack panels vertically on mobile

## Files to Change

```
dashboard/src/app/page.js          # Major refactor - extract components
dashboard/src/app/globals.css      # Remove tui-panel, consolidate CSS
dashboard/src/app/layout.js        # Add metadata, favicon
dashboard/src/components/          # New component files (see list above)
dashboard/src/lib/utils.js         # No changes needed
```

## Implementation Order

1. Extract components (no visual changes) → safe refactor
2. Redesign globals.css (remove tui, consolidate variables)
3. Apply new design to each component
4. Add responsive breakpoints
5. Add onboarding/empty state

## References

See [reference.md](./reference.md) for Shadcn UI component patterns, Tailwind v4 docs, and design inspiration.
