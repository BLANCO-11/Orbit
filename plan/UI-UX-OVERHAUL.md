# AegisAgent OS Assistant — UI/UX Overhaul Plan

> **Target:** Sleek, elegant, professional interface with proper responsive design
> **Framework:** Next.js 16 + React 19 + Tailwind CSS 4 + Shadcn UI + Lucide Icons
> **Layer Depth Rule:** 3 distinct visual layers enforced via CSS custom properties and Tailwind classes

---

## 1. App Nature & Layout Structure

### 1.1 What This App Does

AegisAgent is a **local personal assistant console** providing:
- Real-time chat with an AI agent that can run terminal commands, edit files, and browse the web
- **Agent orchestration** with subagents, approval guard (HITL), and execution plans
- **Session management** (multiple conversations, each with its own logs/metrics/approvals)
- **Live browser viewport** via Lightpanda headless browser
- **Speech I/O** (STT/TTS) for voice interaction
- **Security dashboard** (allowed paths, blocked paths, auto-approve rules)
- **Live metrics**: tool calls, token usage, cost, subagent orchestration, action feed

### 1.2 Core User Workflows

1. **Chat → Execute → Monitor** (primary loop)
2. **Search/switch sessions → Review history → Resume**
3. **Configure agent settings → Set security policies → Save**
4. **Review approval requests → Approve/Deny in real-time**

### 1.3 Layout Structure (Desktop → Tablet → Mobile)

```
┌─────────────────────────────────────────────────────────────────┐
│  HEADER (status logo, controls, mode selector, status dot)      │  ← 56px fixed
├─────────────────┬──────────────────────┬────────────────────────┤
│                 │                      │                        │
│  SESSION LIST   │   MAIN CONTENT       │   METRICS / SETTINGS   │
│  (collapsible)  │   AREA               │   (right panel)        │
│                 │                      │                        │
│  • Search       │  ┌──────────────┐    │  ┌──────────────────┐  │
│  • Session 1    │  │ Chat Messages│    │  │ Session Metrics  │  │
│  • Session 2    │  │ (scrollable) │    │  │ Subagent Orches. │  │
│  • Session 3    │  │             │    │  │ Action Feed      │  │
│  • Session 4    │  │             │    │  │ Approval Guard   │  │
│                 │  └──────────────┘    │  └──────────────────┘  │
│                 │                      │                        │
│                 │  ┌──────────────┐    │                        │
│                 │  │ Input Area   │    │                        │
│                 │  │ [message] ▶  │    │                        │
│                 │  └──────────────┘    │                        │
│                 │                      │                        │
├─────────────────┴──────────────────────┴────────────────────────┤
│  APPROVAL BANNER (overlay, shown only when HITL triggered)      │
└─────────────────────────────────────────────────────────────────┘
```

**Responsive breakpoints:**
| Breakpoint | Width | Layout |
|---|---|---|
| `xl` | ≥1280px | 3-column: sidebar (260px) + main + right panel (380px) |
| `lg` | ≥1024px | 2-column: collapsible sidebar (toggle) + main, right panel as overlay/drawer |
| `md` | ≥768px | 1-column: main fills, sidebar/right panel as slide-over drawers |
| `sm` | ≥640px | 1-column full-width with bottom nav for mobile |
| `xs` | <640px | 1-column, stacked layout, floating action input |

---

## 2. Layer Depth Rule (3-Layer System)

### Layer 1 — App Foundation (Background)
```
z-index: 0
Background color + subtle radial gradient + optional mesh texture
No interaction — purely visual canvas
```

### Layer 2 — Container Panels (Surface cards)
```
z-index: 10
All .glass-panel, .tui-panel, .sidebar-panel, cards, sections
Backdrop blur + subtle border + soft shadow
These are "containers" — elevated from bg but not interactive on their own
```

### Layer 3 — Interactive Elements (Controls & Content)
```
z-index: 20
Buttons, inputs, switches, tooltips, dropdowns, toggles, scrollbars
High contrast, clear focus rings, hover states, active press states
These sit on top of panels and invite interaction
```

### Overlays & Modals (Z-Index Escalation)
```
z-index: 30 — Dropdowns, popovers, selects
z-index: 40 — Modals, drawers, slide-overs
z-index: 50 — Approval banners, toast notifications
z-index: 60 — Tooltips
```

---

## 3. Color Palette — Light & Dark Themes

### 3.1 Dark Theme (Default — The "Deep Space" palette)

| Token | Hex/OKLCH | Usage |
|---|---|---|
| **Layer 1: Background** | | |
| `--bg-base` | `oklch(0.13 0 0)` | Primary app background |
| `--bg-radial-1` | `oklch(0.17 0.03 265)` | Top-left ambient glow (cool) |
| `--bg-radial-2` | `oklch(0.15 0.02 340)` | Bottom-right ambient glow (warm) |
| **Layer 2: Surfaces** | | |
| `--surface-primary` | `oklch(0.18 0.005 265 / 0.7)` | Main panel backgrounds |
| `--surface-secondary` | `oklch(0.22 0.008 265 / 0.5)` | Sub-panels, nested cards |
| `--surface-elevated` | `oklch(0.25 0.01 265 / 0.75)` | Hovered/active panels |
| `--border-subtle` | `oklch(0.3 0.01 265 / 0.35)` | Card borders, dividers |
| `--border-default` | `oklch(0.35 0.015 265 / 0.45)` | Input borders, panel edges |
| `--border-strong` | `oklch(0.5 0.02 265 / 0.3)` | Focus rings, active borders |
| **Layer 3: Content** | | |
| `--text-primary` | `oklch(0.97 0 0)` | Headings, body text |
| `--text-secondary` | `oklch(0.72 0.01 265)` | Secondary labels, descriptions |
| `--text-tertiary` | `oklch(0.55 0.015 265)` | Placeholders, disabled, hints |
| `--text-inverse` | `oklch(0.13 0 0)` | Text on accent backgrounds |
| **Accent — Amethyst (Primary)** | | |
| `--accent-primary` | `oklch(0.55 0.18 280)` | Primary buttons, links, active states |
| `--accent-primary-hover` | `oklch(0.60 0.20 280)` | Button hover |
| `--accent-primary-glow` | `oklch(0.55 0.18 280 / 0.25)` | Glow effects |
| `--accent-primary-muted` | `oklch(0.55 0.18 280 / 0.12)` | Subtle accent bg |
| **Accent — Emerald (Success)** | | |
| `--accent-success` | `oklch(0.60 0.18 150)` | Success states, completion |
| `--accent-success-muted` | `oklch(0.60 0.18 150 / 0.12)` | Success bg |
| **Accent — Amber (Warning)** | | |
| `--accent-warning` | `oklch(0.75 0.18 80)` | Warning, pending, in-progress |
| `--accent-warning-muted` | `oklch(0.75 0.18 80 / 0.12)` | Warning bg |
| **Accent — Rose (Danger)** | | |
| `--accent-danger` | `oklch(0.60 0.22 25)` | Errors, destructive actions |
| `--accent-danger-muted` | `oklch(0.60 0.22 25 / 0.12)` | Error bg |
| **Accent — Sky (Info)** | | |
| `--accent-info` | `oklch(0.65 0.15 240)` | Informational, system messages |
| `--accent-info-muted` | `oklch(0.65 0.15 240 / 0.12)` | Info bg |

### 3.2 Light Theme (The "Clear Frost" palette)

| Token | Hex/OKLCH | Usage |
|---|---|---|
| **Layer 1: Background** | | |
| `--bg-base` | `oklch(0.97 0.005 265)` | Primary app background |
| `--bg-radial-1` | `oklch(0.95 0.02 265)` | Ambient glow |
| `--bg-radial-2` | `oklch(0.93 0.015 340)` | Ambient glow |
| **Layer 2: Surfaces** | | |
| `--surface-primary` | `oklch(0.99 0 0 / 0.75)` | Main panels (frosted glass) |
| `--surface-secondary` | `oklch(0.96 0.005 265 / 0.6)` | Sub-panels |
| `--surface-elevated` | `oklch(1 0 0 / 0.85)` | Hovered/active panels |
| `--border-subtle` | `oklch(0.85 0.01 265 / 0.4)` | Card borders |
| `--border-default` | `oklch(0.78 0.015 265 / 0.5)` | Input borders |
| `--border-strong` | `oklch(0.65 0.02 265 / 0.4)` | Focus rings |
| **Layer 3: Content** | | |
| `--text-primary` | `oklch(0.15 0 0)` | Headings, body text |
| `--text-secondary` | `oklch(0.40 0.01 265)` | Secondary labels |
| `--text-tertiary` | `oklch(0.55 0.015 265)` | Placeholders, hints |
| `--text-inverse` | `oklch(0.97 0 0)` | Text on accent bg |
| **Accent — same hues, adjusted lightness** | | |
| `--accent-primary` | `oklch(0.50 0.22 280)` | Primary buttons |
| `--accent-primary-hover` | `oklch(0.55 0.24 280)` | Hover |
| `--accent-primary-glow` | `oklch(0.50 0.22 280 / 0.15)` | Glow |
| `--accent-primary-muted` | `oklch(0.50 0.22 280 / 0.08)` | Muted bg |
| Same success/warning/danger/info with adjusted lightness | | |

### 3.3 Theme Toggle Strategy
- `prefers-color-scheme` media query for initial load
- Manual toggle stored in `localStorage('aegis-theme')`
- Class-based: `<html class="dark">` or `<html class="light">`
- CSS custom properties swap via `.dark` / `.light` selectors
- Transition: `color-scheme: 0.3s ease, background-color: 0.3s ease`

---

## 4. Typography System

### Font Stack
```css
--font-sans: 'Inter', system-ui, -apple-system, sans-serif;
--font-mono: 'JetBrains Mono', 'Fira Code', monospace;
```

### Type Scale (modular scale 1.2 — Minor Third)
| Token | Size | Weight | Line Height | Usage |
|---|---|---|---|---|
| `text-xs` | 0.7rem (11px) | 500 | 1.3 | Labels, timestamps, badges |
| `text-sm` | 0.8rem (13px) | 500 | 1.4 | Secondary text, descriptions |
| `text-base` | 0.925rem (15px) | 500 | 1.5 | Body, chat messages |
| `text-lg` | 1.1rem (18px) | 600 | 1.4 | Section titles |
| `text-xl` | 1.35rem (22px) | 700 | 1.3 | Panel headers |
| `text-2xl` | 1.6rem (26px) | 700 | 1.2 | Page titles |
| `text-3xl` | 1.9rem (30px) | 800 | 1.1 | Hero/brand |

### Font Features
```css
font-feature-settings: "cv02", "cv03", "cv04", "cv11"; /* Inter stylistic alternates */
-webkit-font-smoothing: antialiased;
-moz-osx-font-smoothing: grayscale;
text-rendering: optimizeLegibility;
```

---

## 5. Spacing System

### 5.1 Grid Units (4px base)
```css
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;
--space-8: 32px;
--space-10: 40px;
--space-12: 48px;
--space-16: 64px;
```

### 5.2 Layout Spacing Rules
- **Panels**: 20px gap between panels in grid
- **Panel padding**: 20px (desktop), 16px (tablet), 12px (mobile)
- **Section spacing within panels**: 20px between sections
- **Form fields**: 12px gap between label + input, 10px between field groups
- **List items**: 6px gap between compact items, 10px between standard items

### 5.3 Border Radii
```css
--radius-sm: 6px;    /* Buttons, inputs, tags */
--radius-md: 10px;   /* Cards, panels */
--radius-lg: 14px;   /* Large panels, modals */
--radius-xl: 18px;   /* Context menus, tooltips */
--radius-full: 9999px; /* Pills, badges, avatars */
```

---

## 6. Component Class Hierarchy

All components follow a strict **Base → Variant → Size → State** naming convention.

### 6.1 Primitive UI Components (Shadcn-fixed)

| Component | Variants | Sizes | States |
|---|---|---|---|
| **Button** | `default`, `outline`, `secondary`, `ghost`, `destructive`, `link` | `xs`, `sm`, `default`, `lg`, `icon-*` | `hover`, `active:scale-98`, `disabled`, `loading` |
| **Input** | `default`, `search` | `sm`, `default` | `focus:ring-2`, `disabled`, `error` |
| **Select** | `default` | `sm`, `default` | `focus`, `disabled` |
| **Switch** | `default`, `accent` | `sm`, `default` | `checked`, `disabled` |
| **Card** | `default`, `interactive` | `sm`, `default` | `hover:border-accent`, `active` |
| **Badge** | `default`, `success`, `warning`, `danger`, `info`, `neutral` | `sm`, `default` | — |
| **Kbd** | hardcoded | — | — |
| **Separator** | `horizontal`, `vertical` | — | — |
| **Tooltip** | `default` | — | `show:z-60` |
| **ScrollArea** | `thin`, `default` | — | — |

### 6.2 Composite Components (App-specific)

| Component | Sub-components | Responsive Behavior |
|---|---|---|
| **AppShell** | `Header`, `Sidebar`, `MainPanel`, `RightPanel` | `lg+`: 3-col grid, `md`: drawers, `sm`: bottom nav |
| **SessionList** | `SearchBar`, `SessionGroup`, `SessionItem` | Collapses to icon-only at `md`, hidden at `sm` |
| **ChatMessage** | `MessageBubble`, `ToolGroupAccordion`, `ToolCallCard` | Full width at `sm`, max-width constraint at `md+` |
| **ChatInput** | `TextArea`, `MicButton`, `SendButton`, `ModeIndicator` | Sticky bottom, expands up to 3 lines |
| **MetricsPanel** | `MetricCard`, `SubagentPanel`, `ActionFeed`, `ApprovalHistory` | Collapses to 2-col grid at `md` |
| **SettingsPanel** | `SectionGroup`, `FieldRow`, `TagList`, `AddRow` | Full-bleed at `sm`, inside drawer |
| **ApprovalBanner** | `CommandPreview`, `ApproveButton`, `DenyButton` | Sticky banner, overlaid at bottom |
| **ExecutionPlan** | `PlanStep`, `ReasoningEntry` | Compact at `sm` |
| **ScreenshotViewer** | `ViewportFrame`, `RefreshButton` | Responsive aspect ratio |
| **LogViewer** | `LogEntry` (system, log, error, success) | Monospace, scrollable |
| **StatusIndicator** | `StatusDot`, `StatusLabel` | Inline in header |

### 6.3 Shared Utility Classes (Tailwind)

```css
/* Surface elevations */
.surface-primary { @apply bg-[var(--surface-primary)] backdrop-blur-xl border border-[var(--border-subtle)]; }
.surface-secondary { @apply bg-[var(--surface-secondary)] backdrop-blur-lg border border-[var(--border-subtle)]; }
.surface-elevated { @apply bg-[var(--surface-elevated)] backdrop-blur-xl border border-[var(--border-default)] shadow-lg; }

/* Interactive layers */
.interactive-primary { @apply text-[var(--text-primary)] hover:bg-[var(--accent-primary-muted)] active:scale-[0.98] transition-all duration-150; }
.interactive-secondary { @apply text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-elevated)]; }

/* Text hierarchy */
.text-hierarchy-primary { @apply text-[var(--text-primary)] font-semibold; }
.text-hierarchy-secondary { @apply text-[var(--text-secondary)]; }
.text-hierarchy-tertiary { @apply text-[var(--text-tertiary)] text-xs; }

/* Focus ring */
.focus-ring-accent { @apply focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]; }

/* Transition defaults */
.transition-default { @apply transition-all duration-150 ease-in-out; }
.transition-smooth { @apply transition-all duration-300 ease-out; }
```

---

## 7. Responsive Behavior Specification

### Header (`<56px` fixed)
```
xl:   [logo] [center controls] [status + mode selector]
lg:   [logo] [center controls] [status + hamburger menu]
md:   [logo] [hamburger] [status]
sm:   [logo] [hamburger]
```

### Main Layout Grid
```
xl:   grid-cols-[260px_1fr_360px]  → 3 columns
lg:   grid-cols-[1fr] + sidebar as collapsible overlay (w-64)
md:   grid-cols-[1fr] + sidebar & right panel as slide-over drawers
sm:   grid-cols-[1fr] + bottom nav with tabs: [Chat] [Logs] [Metrics] [Settings]
```

### Chat Area
```
xl:   max-w-3xl centered, side panels visible
lg:   max-w-full, right panel toggleable
md:   max-w-full full-bleed
sm:   max-w-full, smaller bubbles, compact spacing
```

### Right Panel (Metrics / Settings)
```
xl:   w-[360px] always visible
lg:   w-[340px] slide-over from right, toggle with header button
md:   95vw drawer from right
sm:   full-screen overlay with back button
```

### Sidebar (Sessions)
```
xl:   w-[260px] always visible
lg:   w-64 overlay from left, toggle via hamburger
md:   85vw drawer from left
sm:   full-screen overlay with search at top
```

### Input Area
```
xl:   max-w-3xl constrained
lg:   max-w-3xl
md:   full width
sm:   full width, floating at bottom (safe area padding)
```

---

## 8. Motion & Interaction Design

### Durations & Easing
```css
--ease-out-expo: cubic-bezier(0.19, 1, 0.22, 1);
--ease-in-out-smooth: cubic-bezier(0.65, 0, 0.35, 1);

/* Duration tokens */
--duration-50: 50ms;   /* Micro-interactions (button press) */
--duration-150: 150ms; /* Standard hover/focus */
--duration-300: 300ms; /* Panel transitions */
--duration-500: 500ms; /* Page transitions, modals */
```

### Prescribed Animations

| Animation | Duration | Easing | Usage |
|---|---|---|---|
| `fade-in` | 150ms | ease-out | Elements appearing |
| `slide-up` | 300ms | expo-out | Panels, messages |
| `slide-left` | 300ms | expo-out | Drawers, sidebars |
| `scale-in` | 150ms | expo-out | Dropdowns, tooltips |
| `pulse-glow` | 2s | ease-in-out infinite | Status dot, mic recording |
| `spin` | 1s | linear infinite | Loading spinners |
| `skeleton-pulse` | 1.5s | ease-in-out infinite | Loading skeletons |

### Hover/Focus Standards
- **Buttons**: `scale-[0.98]` on press, subtle bg shift on hover
- **Cards/panels**: `border-color` transition to accent on hover
- **Links**: underline decoration on hover with `transition-all`
- **Inputs**: `ring-2` with accent glow on focus
- **Tooltips**: appear after 300ms delay, fade in 100ms

---

## 9. Accessibility Standards

### Contrast Ratios (WCAG 2.1 AA)
- Text on surface: minimum **4.5:1**
- Large text (≥18px bold): minimum **3:1**
- UI components (borders, icons): minimum **3:1**

### Focus Management
- All interactive elements have visible `:focus-visible` ring
- Focus order follows visual order (LTR)
- `aria-label` on all icon-only buttons
- `role` attributes on custom interactive widgets

### Motion Preferences
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 10. Implementation Roadmap

### Phase 1: Foundation (CSS Architecture)
1. Update `globals.css` with the full 3-layer color palette (both themes)
2. Define all CSS custom properties for spacing, radii, type scale, durations
3. Build base `.surface-*` and `.interactive-*` utility classes
4. Ensure `.dark` / `.light` class switching works end-to-end
5. Add `prefers-reduced-motion` support

### Phase 2: Layout Shell
1. Build `AppShell` component with responsive grid
2. Implement collapsible sidebar (left) with overlay on mobile
3. Implement collapsible right panel with overlay on mobile
4. Build responsive header with hamburger menu
5. Add bottom navigation bar for `sm` breakpoint
6. Test all 5 breakpoints

### Phase 3: Components Refactor
1. Refactor all shadcn UI components to respect new CSS variables
2. Build `Badge`, `Kbd`, `Separator` primitives
3. Refactor `ChatMessage` — cleaner bubble, better markdown rendering
4. Refactor `MetricsPanel` — responsive grid, cleaner cards
5. Refactor `SettingsPanel` — better grouped fields, collapsible sections
6. Refactor `SessionList` — consistent with new spacing/text hierarchy
7. Build `ExecutionPlan` with animated step transitions

### Phase 4: Polish & Motion
1. Add panel open/close animations (slide, fade)
2. Add message entry animations (staggered slide-up)
3. Add tool call accordion animation (smooth expand/collapse)
4. Add skeleton loading states for async content
5. Add toast notification system for ephemeral feedback

### Phase 5: Responsive QA & Accessibility
1. Test all breakpoints on real devices
2. Verify WCAG 2.1 AA contrast for both themes
3. Test keyboard navigation end-to-end
4. Test screen reader announcements
5. Fix any dark/light mode flicker on initial load

---

## 11. Key Design Principles

1. **Content over chrome** — panels should fade into the background, letting chat content and metrics be the visual focus
2. **Consistent negative space** — every component respects the 4px grid; all spacing is intentional
3. **Color with purpose** — accent colors only used for interactive elements and status indicators; never decorative
4. **3-layer depth is inviolable** — no component ever breaks the bg/surface/control layering without explicit z-index escalation
5. **Mobile first, desktop enhanced** — the layout must work on a phone screen before it gets the 3-column treatment
6. **Every component has one job** — no monolithic components; small composable pieces that are easy to test and maintain

---

## 12. File Structure (Proposed)

```
src/
├── app/
│   ├── globals.css          ← Full design token replacement
│   ├── layout.js            ← AppShell integration
│   └── page.js              ← Dashboard page
├── components/
│   ├── ui/                  ← Shadcn primitives (fixed)
│   │   ├── button.jsx
│   │   ├── card.jsx
│   │   ├── input.jsx
│   │   ├── badge.jsx        ← NEW
│   │   ├── kbd.jsx          ← NEW
│   │   ├── separator.jsx    ← NEW
│   │   ├── tooltip.jsx      ← NEW
│   │   ├── select.jsx
│   │   ├── switch.jsx
│   │   └── scroll-area.jsx
│   ├── layout/              ← NEW: Shell components
│   │   ├── AppShell.jsx
│   │   ├── Header.jsx
│   │   ├── Sidebar.jsx      ← SessionList refactor
│   │   ├── RightPanel.jsx   ← Metrics/Settings toggle
│   │   └── BottomNav.jsx    ← Mobile nav
│   ├── chat/                ← NEW: Chat domain
│   │   ├── ChatArea.jsx
│   │   ├── ChatMessage.jsx
│   │   ├── ChatInput.jsx    ← Refactored input
│   │   ├── ChatEmptyState.jsx
│   │   └── ToolCallCard.jsx
│   ├── monitoring/          ← NEW: Metrics domain
│   │   ├── MetricsPanel.jsx
│   │   ├── MetricCard.jsx
│   │   ├── SubagentPanel.jsx
│   │   ├── ActionFeed.jsx
│   │   └── ApprovalHistory.jsx
│   ├── settings/            ← NEW: Settings domain
│   │   ├── SettingsPanel.jsx
│   │   ├── SecuritySection.jsx
│   │   ├── ModelSection.jsx
│   │   ├── ModeSelector.jsx
│   │   └── CompactSection.jsx
│   └── widgets/             ← Misc
│       ├── ApprovalBanner.jsx
│       ├── ExecutionPlan.jsx
│       ├── LogViewer.jsx
│       ├── ScreenshotViewer.jsx
│       └── SessionList.jsx
├── hooks/                   ← NEW: Custom hooks
│   ├── useTheme.js
│   ├── useResponsive.js
│   ├── useWebSocket.js
│   └── useMediaQuery.js
└── lib/
    ├── utils.js
    └── constants.js          ← NEW: Design tokens as JS constants
```

---

## Summary

This plan provides a **zero-generic** overhaul: every color, every spacing unit, every font size, every component variant is explicitly defined and named. The 3-layer system ensures visual hierarchy without relying on shadows alone. The responsive specification ensures the app works on everything from a phone held in one hand to a 34-inch ultrawide monitor. The phased implementation lets us ship improvements incrementally without a rip-and-replace.
