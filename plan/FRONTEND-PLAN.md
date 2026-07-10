# AegisAgent — Frontend Design Vision & Implementation Plan

> **Status:** 📋 Finalized — Awaiting implementation
> **Inspired by:** Claude Code, Linear, Apple Design, Vercel
> **Philosophy:** Terminal elegance meets modern product design — minimal, fast, intentional.

---

## Table of Contents

1. [Design Philosophy](#1-design-philosophy)
2. [Theme System](#2-theme-system)
3. [Layout Architecture](#3-layout-architecture)
4. [Component Design Vision](#4-component-design-vision)
5. [Sub-Agent Deep Tracking UI](#5-sub-agent-deep-tracking-ui)
6. [Workspace Preview Panel](#6-workspace-preview-panel)
7. [Architecture Refactor Plan](#7-architecture-refactor-plan)
8. [Implementation Order](#8-implementation-order)

---

## 1. Design Philosophy

### 1.1 Core Principles

AegisAgent is a power tool. It shouldn't look like a toy. Every pixel should earn its place.

| Principle | What it means |
|---|---|
| **Content-first** | Chrome fades. The agent's output is the star. Surfaces are neutral canvases. |
| **Information dense, not cluttered** | Show everything the user needs, nothing they don't. Use visual hierarchy, not walls of text. |
| **Terminal elegance** | Monospace where it matters (code, logs, reasoning). Sans-serif where it doesn't (chat, labels). |
| **Immediate feedback** | Every action has a micro-animation. Nothing teleports. Nothing freezes silently. |
| **Keyboard-native** | Everything reachable without a mouse. Power users shouldn't slow down. |
| **Personal** | The user should feel ownership. Themes are customizable. Layout is adaptable. |

### 1.2 Visual References

**Claude Code** — The baseline. Information-dense terminal UI. Clean monospace reasoning. Subtle color usage. No unnecessary chrome. The way it shows tool calls inline with the conversation flow is the gold standard.

**Linear** — Typography. The Inter font stack, the weight hierarchy, the way sections breathe with whitespace. The command palette (Cmd+K) interaction pattern.

**Apple Design** — Surface treatment. Frosted glass panels with proper backdrop blur. Border radii that feel organic, not mechanical. The haptic feedback of `scale(0.98)` on press.

**Vercel** — Dark theme color palette. Deep-space backgrounds with subtle radial ambient light. Accent colors that pop without screaming. The way code blocks are presented.

### 1.3 What We're NOT Doing

- ❌ Retro TUI box-drawing characters as the primary aesthetic (they're a data display format, not a UI style)
- ❌ Heavy gradients, glow effects on everything
- ❌ Animated backgrounds or particle effects
- ❌ Rounded avatars with gradients
- ❌ Emoji-heavy UI
- ❌ Three different styling approaches in the same codebase

---

## 2. Theme System

### 2.1 Architecture

Themes are **CSS custom property maps** stored as JSON. The dashboard loads a theme, applies it to `:root`, and the entire UI responds. Users can create, edit, save, export, and import themes.

```
Theme = {
  id: string,
  name: string,
  mode: "dark" | "light",
  colors: { ...90+ tokens },
  typography: { fontSans, fontMono, scale },
  radii: { sm, md, lg, xl, full },
  spacing: { base, ... },
  isBuiltin: boolean,
  isCustom: boolean,
}
```

### 2.2 Built-in Themes

#### Dark Theme — "Deep Space" (Default)

The Claude Code-inspired dark theme. Deep navy-black background with subtle purple-blue ambient light. Cool-toned neutrals.

| Token | Value | Usage |
|---|---|---|
| `--bg-base` | `#08080c` | App background |
| `--bg-ambient-1` | `rgba(30, 30, 60, 0.6)` | Top-left radial glow |
| `--bg-ambient-2` | `rgba(20, 10, 30, 0.4)` | Bottom-right radial glow |
| `--surface-primary` | `rgba(22, 22, 30, 0.6)` | Main panels |
| `--surface-secondary` | `rgba(28, 28, 38, 0.4)` | Nested panels |
| `--surface-elevated` | `rgba(35, 35, 48, 0.8)` | Hover/active panels |
| `--border-subtle` | `rgba(255, 255, 255, 0.04)` | Dividers |
| `--border-default` | `rgba(255, 255, 255, 0.07)` | Card borders |
| `--border-strong` | `rgba(255, 255, 255, 0.14)` | Focus/active |
| `--text-primary` | `#ececee` | Body, headings |
| `--text-secondary` | `#8b8b90` | Labels, descriptions |
| `--text-tertiary` | `#52525a` | Placeholders, disabled |
| `--text-inverse` | `#08080c` | On accent bg |
| `--accent-primary` | `#6c5ce7` | Primary (purple) |
| `--accent-success` | `#00d68f` | Success |
| `--accent-warning` | `#ffaa00` | Warning/pending |
| `--accent-danger` | `#ff3b5c` | Error/destructive |
| `--accent-info` | `#54a0ff` | Info |

#### Light Theme — "Frost"

Clean, bright, airy. White surfaces with subtle cool undertones. High contrast for readability.

| Token | Value | Usage |
|---|---|---|
| `--bg-base` | `#f8f8fa` | App background |
| `--bg-ambient-1` | `rgba(230, 235, 250, 0.5)` | Top-left glow |
| `--bg-ambient-2` | `rgba(240, 235, 250, 0.4)` | Bottom-right glow |
| `--surface-primary` | `rgba(255, 255, 255, 0.75)` | Main panels |
| `--surface-secondary` | `rgba(245, 245, 250, 0.55)` | Nested panels |
| `--surface-elevated` | `rgba(255, 255, 255, 0.9)` | Hover/active |
| `--border-subtle` | `rgba(0, 0, 0, 0.05)` | Dividers |
| `--border-default` | `rgba(0, 0, 0, 0.1)` | Card borders |
| `--border-strong` | `rgba(0, 0, 0, 0.18)` | Focus/active |
| `--text-primary` | `#1a1a1e` | Body, headings |
| `--text-secondary` | `#6b6b73` | Labels, descriptions |
| `--text-tertiary` | `#9b9ba3` | Placeholders |
| `--accent-primary` | `#5b4cdb` | Primary |
| `--accent-success` | `#00b37a` | Success |
| `--accent-warning` | `#e69500` | Warning |
| `--accent-danger` | `#e62e4d` | Error |
| `--accent-info` | `#3b8cff` | Info |

#### Additional Built-ins (6 total)

- **"Forest"** — Dark green-tinted. For late-night coding.
- **"Ocean"** — Dark blue-tinted. Calm, focused.
- **"Sepia"** — Warm light theme. Paper-like.
- **"High Contrast"** — Pure black/white. Accessibility.

### 2.3 Custom Theme Support

**Dashboard integration:** Settings → Themes tab shows:
- Built-in theme gallery (click to apply, instant preview)
- "Create Custom Theme" button → theme editor panel
- Color picker for every token (grouped: Background, Surfaces, Borders, Text, Accents)
- Live preview as you edit
- Export theme as JSON file
- Import theme from JSON file
- Reset to default

**Storage:** Custom themes stored in `localStorage` under `aegis-custom-themes`. Active theme ID in `aegis-active-theme`. Falls back to `"deep-space"`.

### 2.4 Implementation

**`hooks/useTheme.js`** (rewrite existing):
```js
function useTheme() {
  // Returns: { theme, themes, activeThemeId, setTheme, createTheme, updateTheme, deleteTheme, exportTheme, importTheme }
  // Loads active theme on mount, applies CSS vars to :root
  // Syncs to localStorage
}
```

**`lib/themes.js`** — All built-in theme definitions as JS objects. Each theme is a flat map of CSS token → value.

**Applying a theme:**
```js
function applyTheme(theme) {
  const root = document.documentElement;
  Object.entries(theme.colors).forEach(([key, value]) => {
    root.style.setProperty(key, value);
  });
  root.classList.toggle('dark', theme.mode === 'dark');
  root.classList.toggle('light', theme.mode === 'light');
}
```

---

## 3. Layout Architecture

### 3.1 Spatial Organization

The layout is a **4-zone system** with intentional information hierarchy:

```
┌─────────────────────────────────────────────────────────────┐
│  HEADER (48px)                                              │
│  [logo]                    [status] [theme] [notif] [menu]  │
├───────────┬──────────────────────┬──────────────────────────┤
│           │                      │                          │
│ SESSIONS  │   MAIN CONTENT       │   DETAIL PANEL           │
│ (260px)   │                      │   (360px)                │
│           │  ┌────────────────┐  │                          │
│ • Search  │  │ Chat / Output  │  │  Tab: Agent Activity     │
│ • Today   │  │                │  │  Tab: Workspace          │
│   Session │  │ Messages flow   │  │  Tab: Execution Plan    │
│   Session │  │ Tool calls      │  │  Tab: Logs              │
│ • Yest.   │  │ inline          │  │                          │
│           │  └────────────────┘  │  Active sub-agent cards   │
│           │                      │  with live status +       │
│           │  ┌────────────────┐  │  expandable detail        │
│           │  │ Input Bar      │  │                          │
│           │  │ [mode][mic][>] │  │                          │
│           │  └────────────────┘  │                          │
│           │                      │                          │
├───────────┴──────────────────────┴──────────────────────────┤
│  BOTTOM NAV (mobile only)                                   │
└─────────────────────────────────────────────────────────────┘
```

**Zone 1 — Header (48px):**
- Logo + "AegisAgent" text on left
- Center: empty (breathing room)
- Right: connection status dot + theme toggle + notification bell + more menu
- No thick borders. A 1px subtle bottom border. Clean.

**Zone 2 — Sessions Sidebar (260px, collapsible):**
- "New Session" button at top
- Search bar below
- Date-grouped session list
- Each session: title, 1-line preview, timestamp
- Active session has a 3px left accent bar
- Hover shows delete button
- Double-click to rename inline

**Zone 3 — Main Content (flex: 1):**
- Chat area with messages flowing bottom-up
- No message bubbles — clean left-aligned text blocks with roles indicated by subtle left-border color
- Tool calls inline with the message flow (collapsible, not in a sidebar)
- Input bar pinned to bottom
- Mode badge above input when active

**Zone 4 — Detail Panel (360px, tabbed):**
- Tabs: "Agent" | "Workspace" | "Plan" | "Logs"
- Agent tab: sub-agent tree, live metrics, approval queue
- Workspace tab: file tree + preview pane (split vertically)
- Plan tab: reasoning history
- Logs tab: system output with filtering

### 3.2 Responsive Behavior

| Breakpoint | Width | Layout |
|---|---|---|
| Desktop | ≥1280px | 4-zone: sidebar + main + detail panel |
| Laptop | ≥1024px | Sidebar collapses to icon rail (48px). Detail panel toggles as overlay. |
| Tablet | ≥768px | Sidebar hidden. Detail panel as slide-over drawer. |
| Mobile | <768px | Full-width main. Bottom tab bar. All panels as full-screen overlays. |

**Collapse behaviors:**
- Sidebar: `Ctrl+B` toggles. Icon rail shows session icons only. Hover expands to full width temporarily.
- Detail panel: `Ctrl+J` toggles. Slides from right.

### 3.3 Typography System

**Font stack:**
```
Sans: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
Mono: "JetBrains Mono", "SF Mono", "Fira Code", "Cascadia Code", monospace
```

**Scale (1.25 ratio — Major Third):**

| Token | Size | Weight | Line | Usage |
|---|---|---|---|---|
| `text-xs` | 0.7rem (11px) | 500 | 1.4 | Timestamps, badges, micro-labels |
| `text-sm` | 0.8rem (12.8px) | 450 | 1.5 | Secondary text, session previews |
| `text-base` | 0.9rem (14.4px) | 450 | 1.55 | Body, chat messages |
| `text-lg` | 1.1rem (17.6px) | 550 | 1.4 | Section titles, panel headers |
| `text-xl` | 1.4rem (22.4px) | 600 | 1.3 | Page titles |
| `text-2xl` | 1.75rem (28px) | 700 | 1.2 | Brand, hero |

**Font features:** `"cv02", "cv03", "cv04", "cv11"` for Inter alternates.
**All text:** `-webkit-font-smoothing: antialiased`

---

## 4. Component Design Vision

### 4.1 Chat Messages

**Claude Code style — text blocks, not bubbles.**

```
┌─ User Message ─────────────────────────────────────────────┐
│ │ You                                    [copy] 12:34 PM   │
│ │                                                          │
│ │ Read the file at src/utils/helpers.ts and explain what   │
│ │ the debounce function does.                              │
│ └──────────────────────────────────────────────────────────┘

┌─ Agent Response ───────────────────────────────────────────┐
│ │ AegisAgent                              [copy] 12:34 PM  │
│ │                                                          │
│ │ The `debounce` function in helpers.ts wraps a function   │
│ │ to limit how often it can fire. It uses a closure to     │
│ │ track a timeout ID and clears it on each call.           │
│ │                                                          │
│ │ ▼ read_file · helpers.ts             0.3s  [expanded]    │
│ │   ┌─────────────────────────────────────────────────┐    │
│ │   │ export function debounce<T extends (...args:    │    │
│ │   │ any[]) => any>(fn: T, delay: number) {          │    │
│ │   │   let timeout: ReturnType<typeof setTimeout>;   │    │
│ │   │   ...                                           │    │
│ │   └─────────────────────────────────────────────────┘    │
│ │                                                          │
│ │ ▼ grep_search · "debounce"           0.1s  [collapsed]   │
│ └──────────────────────────────────────────────────────────┘
```

**Design decisions:**
- No bubbles. Messages are full-width text blocks with a colored left border.
- User messages: 3px `--accent-primary` left border, no background.
- Agent messages: 3px `--text-tertiary` left border, no background.
- Timestamp and copy button appear on the same line as role label, right-aligned.
- Tool calls are collapsible sections within the message flow. A 2px colored left-border identifies the tool type (blue=read, amber=write, green=success, red=error).
- Tool outputs shown in a monospace code block with subtle bg.

**Copy interaction:** Click "copy" → icon changes to checkmark → reverts after 2s.

### 4.2 Input Bar

A single cohesive input strip anchored at the bottom of the main content area.

```
┌─────────────────────────────────────────────────────────────┐
│ [plan ▼] [standard ▼]  │  Type a message...         │ [mic] [tts] [→] │
└─────────────────────────────────────────────────────────────┘
```

- **Mode selector:** Left side. Dropdown with Plan / Edit / YOLO / Chat. Current mode shown as compact pill.
- **Prompt type:** Left side, next to mode. Standard / Fable-5 dropdown.
- **Text area:** Auto-growing. Min 1 row, max 6 rows. No border — just a clean text field.
- **Action buttons:** Right side. Mic (for voice input), TTS toggle (speaker icon with status color), Send (arrow-right in accent color).
- **While processing:** Send button becomes red Stop button. Textarea disabled with "Agent is working..." placeholder.
- **Keyboard:** Enter to send. Shift+Enter for newline. Escape to cancel. Up/Down for input history.

### 4.3 Session List

Clean, minimal sidebar list. Think Apple Mail's sidebar.

```
┌──────────────────────────────┐
│ [+ New Session]              │
│ ┌────────────────────────┐   │
│ │ 🔍 Search sessions...  │   │
│ └────────────────────────┘   │
│                              │
│ TODAY                        │
│ ┃ Fix the login bug          │
│   Last assistant message...  │
│ ┃ Add dark mode toggle       │
│   Sure, I'll update the...   │
│                              │
│ YESTERDAY                    │
│ ┃ Refactor auth middleware   │
│   I've analyzed the code...  │
│ ┃ Deploy to staging          │
│   The deployment completed.. │
│                              │
│ LAST WEEK                    │
│ ┃ Initial setup              │
│   All dependencies installed │
└──────────────────────────────┘
```

- Active session has the 3px accent bar on the left.
- Hover shows subtle background highlight + delete icon.
- Double-click title to rename inline.
- Delete requires confirmation (small popover: "Delete this session? [Cancel] [Delete]").

### 4.4 Right Panel Tabs

**Tab bar design:**
```
┌──────────────────────────────────────┐
│ [Agent] [Workspace] [Plan] [Logs]    │
├──────────────────────────────────────┤
│                                      │
│   (tab content)                      │
│                                      │
└──────────────────────────────────────┘
```

Underline indicator on active tab. Smooth slide transition.

**Agent tab layout:**
- Top: Session metrics summary (3 cards in a row: Tokens, Tool Calls, Cost)
- Middle: Sub-agent tree (expandable cards, see §5)
- Bottom: Approval queue (collapsed by default, expands when pending)

**Workspace tab layout:**
- Top half: File tree (see §6)
- Resizable splitter
- Bottom half: File preview (see §6)

**Plan tab:** Reasoning history (existing ExecutionPlan, enhanced with better streaming).

**Logs tab:** System output with filtering (All | System | Tool Calls | Errors) and auto-scroll toggle.

### 4.5 Header

```
┌──────────────────────────────────────────────────────────────┐
│ ◉ AegisAgent               ● Connected  ☀  🔔  ⋯          │
└──────────────────────────────────────────────────────────────┘
```

- Logo: small dot (8px) + "AegisAgent" in font-weight 600.
- Connection indicator: green dot + "Connected" or red dot + "Reconnecting...".
- Theme toggle: sun/moon icon.
- Notification bell: with unread count badge.
- More menu (⋯): Settings, Keyboard Shortcuts, About.

### 4.6 Command Palette

`Ctrl+K` opens a Spotlight-style overlay.

```
┌─────────────────────────────────┐
│ 🔍 Type a command...            │
├─────────────────────────────────┤
│ → New Session        Ctrl+N     │
│   Switch Session     Ctrl+[1-9] │
│   Toggle Sidebar     Ctrl+B     │
│   Toggle Detail Panel Ctrl+J    │
│   Toggle Theme                  │
│   Compact Memory                │
│   Stop Agent         Escape     │
│   Open Settings                 │
│   Export Sessions               │
│   Import Sessions               │
└─────────────────────────────────┘
```

- Fuzzy search as you type.
- Arrow keys + Enter to select.
- Escape to close.
- Shows keyboard shortcut on the right.
- Recent actions at top.

---

## 5. Sub-Agent Deep Tracking UI

### 5.1 Design Goal

Sub-agents should have the **same visibility as the main agent**. The user should see exactly what each sub-agent is doing: its reasoning, its tool calls, its outputs, its token consumption.

### 5.2 Sub-Agent Tree Card

Each sub-agent is a card in the Agent tab of the detail panel:

```
┌─ Subagent: "Backend Security Audit" ───────────────────────┐
│ ● WORKING · 2 tools · 450 tokens · 1.2s                    │
│                                                             │
│ ▼ Reasoning                                                │
│   "I need to check the auth middleware for vulnerabilities. │
│    First, let me read the current implementation..."        │
│                                                             │
│ ▼ Tool Calls (2)                                           │
│   ✓ read_file · middleware/auth.js          0.3s            │
│   ◉ grep_search · "validateToken"          running...      │
│                                                             │
│ Mode: EDIT (inherited)    Started: 12:34:56 PM              │
│ [Expand Full View]                                          │
└─────────────────────────────────────────────────────────────┘
```

**States:**
- `spawning` — pulsing dot, "Spawning..."
- `reasoning` — brain icon, streaming reasoning text
- `working` — gear icon, current tool name
- `blocked` — shield icon, waiting for approval
- `completed` — checkmark, collapsed with summary
- `failed` — X icon, error message

**"Expand Full View"** opens a modal/overlay showing the sub-agent's complete conversation: all messages, all reasoning steps, all tool calls with full outputs. Same visual treatment as the main chat area but read-only.

### 5.3 Sub-Agent Metrics Per Card

Each sub-agent card shows:
- Tool call count
- Token consumption (reasoning + output)
- Elapsed time
- Inherited mode badge
- Last action description

### 5.4 Implementation Data Flow

Backend sends `subagent_metrics` WebSocket events enriched with:
```json
{
  "type": "subagent_metrics",
  "subagents": [{
    "id": "sa-123",
    "name": "Backend Security Audit",
    "status": "working",
    "mode": "edit",
    "toolCalls": [{ "name": "read_file", "status": "done", "latencyMs": 300 }],
    "reasoning": "I need to check the auth middleware...",
    "tokens": { "reasoning": 200, "output": 250, "total": 450 },
    "currentAction": "grep_search",
    "elapsedMs": 1200
  }]
}
```

Frontend renders the cards from this data stream.

---

## 6. Workspace Preview Panel

### 6.1 Design

The Workspace tab in the detail panel is a split view:

```
┌──────────────────────────────────────┐
│ [Agent] [Workspace] [Plan] [Logs]    │
├──────────────────────────────────────┤
│ 📁 workspace/                        │
│ ├─ 📁 src/                           │
│ │  ├─ 📁 components/                 │
│ │  ├─ 📁 hooks/                      │
│ │  └─ 📄 app.tsx                     │
│ ├─ 📁 tests/                         │
│ ├─ 📄 package.json                   │
│ ├─ 📄 README.md                      │
│ └─ 📄 tsconfig.json                  │
│                                      │
│ ─────── drag to resize ───────       │
│                                      │
│ ┌─ Preview: README.md ───────────┐  │
│ │                                │  │
│ │  # My Project                  │  │
│ │                                │  │
│ │  A description of the project  │  │
│ │  with **markdown** support.    │  │
│ │                                │  │
│ └────────────────────────────────┘  │
│                                      │
│ [Raw] [Preview] [Split]             │
└──────────────────────────────────────┘
```

### 6.2 Features

- **File tree:** Navigate the workspace directory. Folders expand/collapse. Click file to preview.
- **Resizable splitter:** Drag the divider between tree and preview.
- **Preview modes:**
  - `.md` → rendered markdown
  - `.json` → syntax-highlighted with collapsible nodes
  - `.js/.ts/.jsx/.tsx` → syntax-highlighted code
  - images → image preview
  - other → raw text
- **Breadcrumb:** Shows current path above preview.
- **Refresh:** Manual refresh button (file tree auto-refreshes on tool_call_end events).
- **Open in editor:** Button to open the file in the system's default editor (via backend endpoint).

### 6.3 Backend API Needed

```
GET /api/workspace/tree?path=/workspace
→ { tree: [{ name, type: "file"|"directory", path, size, modified }] }

GET /api/workspace/file?path=/workspace/src/app.tsx
→ { content, language, size, modified }

GET /api/workspace/preview?path=/workspace/README.md
→ { html: "<h1>My Project</h1>...", raw: "# My Project..." }
  (Backend renders markdown → HTML for safe preview)
```

---

## 7. Architecture Refactor Plan

### 7.1 Current Problem

`page.js` is 1218 lines. It holds all state, all WebSocket handling, all TTS logic, all session management, and all rendering logic. It's unmaintainable.

### 7.2 Target Architecture

```
dashboard/src/
├── app/
│   ├── globals.css              # Theme system + base styles
│   ├── layout.js                # Providers wrapper
│   └── page.js                  # Thin orchestrator (~80 lines)
├── providers/
│   └── AegisProvider.jsx        # Context + useReducer
├── hooks/
│   ├── useWebSocket.js          # WS lifecycle + reconnect
│   ├── useSessions.js           # Session CRUD + persistence
│   ├── useAgent.js              # Agent state: messages, logs, metrics, plan
│   ├── useTTS.js                # Streaming TTS queue
│   ├── useSTT.js                # Speech recognition
│   ├── useTheme.js              # Theme management (rewrite)
│   ├── useKeyboardShortcuts.js  # Global shortcuts
│   └── useDebounce.js           # Utility
├── components/
│   ├── chat/
│   │   ├── ChatArea.jsx         # Main chat column
│   │   ├── ChatMessage.jsx      # Single message block
│   │   ├── ChatInput.jsx        # Input bar
│   │   └── ToolCallCard.jsx     # Inline tool call
│   ├── layout/
│   │   ├── AppShell.jsx         # Responsive shell
│   │   ├── Header.jsx           # App header
│   │   ├── Sidebar.jsx          # Session list
│   │   └── BottomNav.jsx        # Mobile nav
│   ├── panels/
│   │   ├── DetailPanel.jsx      # Tabbed right panel
│   │   ├── AgentTab.jsx         # Sub-agent tracking
│   │   ├── WorkspaceTab.jsx     # File tree + preview
│   │   ├── PlanTab.jsx          # Reasoning history
│   │   └── LogsTab.jsx          # System logs
│   ├── widgets/
│   │   ├── CommandPalette.jsx   # Ctrl+K overlay
│   │   ├── NotificationCenter.jsx
│   │   ├── ApprovalBanner.jsx
│   │   └── ThemeEditor.jsx      # Custom theme creator
│   └── ui/                      # Shadcn primitives
└── lib/
    ├── themes.js                # Built-in theme definitions
    ├── constants.js             # Design tokens
    ├── sanitize.js              # DOMPurify wrapper
    └── format.js                # Date/time formatters
```

### 7.3 State Management

**React Context + useReducer** (no external library needed for this scope):

```js
const AegisContext = createContext();

const initialState = {
  // Chat
  messages: [],
  logs: [],
  
  // Agent tracking
  executionPlan: "",
  reasoningHistory: [],
  subAgents: [],           // NEW: sub-agent states
  workspace: { tree: [], activeFile: null },  // NEW
  
  // Status
  status: "idle",
  connectionState: "disconnected",
  
  // Metrics
  metrics: { toolCalls: 0, tokens: 0, cost: 0, latency: 0 },
  
  // UI
  expandedTools: {},
  activeDetailTab: "agent",
  sidebarOpen: false,
  
  // Theme
  activeThemeId: "deep-space",
  
  // Approvals
  approvalRequest: null,
  approvalsHistory: [],
  
  // TTS
  voiceState: "audio",
};
```

**Actions (~30 types):** SET_STATUS, ADD_MESSAGE, UPDATE_MESSAGE, ADD_TOOL_START, ADD_TOOL_END, SET_SUBAGENTS, UPDATE_SUBAGENT, SET_WORKSPACE_TREE, SET_ACTIVE_FILE, SET_METRICS, SET_THEME, etc.

---

## 8. Implementation Order

### Phase 1: Theme System (Foundation)
| # | Task | Effort |
|---|---|---|
| 1.1 | Create `lib/themes.js` with 6 built-in themes (deep-space, frost, forest, ocean, sepia, high-contrast) | 1h |
| 1.2 | Rewrite `hooks/useTheme.js` — load/apply/save themes, custom theme CRUD | 1.5h |
| 1.3 | Rewrite `globals.css` — use only CSS vars from theme system, remove all hardcoded colors | 2h |
| 1.4 | Create `components/widgets/ThemeEditor.jsx` — color picker UI for custom themes | 1.5h |
| 1.5 | Update `SettingsPanel` with Themes tab | 0.5h |
| 1.6 | Fix all CSS variable references in ALL components to match theme token names | 1h |

### Phase 2: State Architecture
| # | Task | Effort |
|---|---|---|
| 2.1 | Create `providers/AegisProvider.jsx` with full reducer + context | 2h |
| 2.2 | Create `hooks/useWebSocket.js` | 1.5h |
| 2.3 | Create `hooks/useSessions.js` | 1.5h |
| 2.4 | Create `hooks/useAgent.js` | 1h |
| 2.5 | Create `hooks/useTTS.js` + `hooks/useSTT.js` | 1h |
| 2.6 | Refactor `page.js` to thin orchestrator (~80 lines) | 1.5h |

### Phase 3: Layout + Chat Redesign
| # | Task | Effort |
|---|---|---|
| 3.1 | Redesign `AppShell.jsx` with 4-zone layout | 1h |
| 3.2 | Redesign `Header.jsx` — clean, minimal | 0.5h |
| 3.3 | Redesign `Sidebar.jsx` (SessionList) — Apple Mail style | 1h |
| 3.4 | Redesign `ChatMessage.jsx` — text-block style, inline tools | 2h |
| 3.5 | Redesign `ChatInput.jsx` — clean input strip | 1h |
| 3.6 | Redesign `ChatArea.jsx` — compose new components | 0.5h |

### Phase 4: Detail Panel + Sub-Agent Tracking
| # | Task | Effort |
|---|---|---|
| 4.1 | Create `panels/DetailPanel.jsx` with tab system | 0.5h |
| 4.2 | Create `panels/AgentTab.jsx` — sub-agent cards with deep tracking | 2h |
| 4.3 | Wire sub-agent WebSocket events enriched from backend | 1h |
| 4.4 | Create `panels/WorkspaceTab.jsx` — file tree + preview | 2h |
| 4.5 | Create `panels/PlanTab.jsx` — enhanced reasoning history | 0.5h |
| 4.6 | Create `panels/LogsTab.jsx` — filtered log viewer | 0.5h |

### Phase 5: Polish
| # | Task | Effort |
|---|---|---|
| 5.1 | Command Palette (`Ctrl+K`) | 1.5h |
| 5.2 | Notification Center | 1h |
| 5.3 | DOMPurify markdown sanitization | 0.5h |
| 5.4 | Skeleton loading states | 1h |
| 5.5 | Error boundaries | 0.5h |
| 5.6 | Keyboard shortcuts (full set) | 0.5h |
| 5.7 | Message virtualization (react-virtual) | 1h |
| 5.8 | Accessibility audit + fixes | 1.5h |

**Total: ~29 hours**

---

## Appendix A: CSS Variable Reference (All Tokens)

Every component MUST use ONLY these variables. No hardcoded colors anywhere.

```
Background:     --bg-base, --bg-ambient-1, --bg-ambient-2
Surfaces:       --surface-primary, --surface-secondary, --surface-elevated
Borders:        --border-subtle, --border-default, --border-strong
Text:           --text-primary, --text-secondary, --text-tertiary, --text-inverse
Accent:         --accent-primary, --accent-success, --accent-warning, --accent-danger, --accent-info
Muted accents:  --accent-primary-muted, --accent-success-muted, etc. (8% opacity versions)
Spacing:        --space-1(4px) through --space-16(64px)
Radii:          --radius-sm(6px), --radius-md(10px), --radius-lg(14px), --radius-xl(18px), --radius-full
Typography:     --font-sans, --font-mono
Sizes:          --header-height(48px), --sidebar-width(260px), --detail-panel-width(360px)
Motion:         --duration-50, --duration-150, --duration-300, --duration-500
                --ease-out-expo, --ease-in-out-smooth
```

## Appendix B: Component Visual Specs Quick Reference

| Component | Background | Border | Font | Padding |
|---|---|---|---|---|
| Header | --surface-primary | --border-subtle bottom | --text-primary, 600 | 0 --space-5 |
| Sidebar | --surface-secondary | --border-subtle right | --text-primary | --space-3 |
| Detail Panel | --surface-secondary | --border-subtle left | — | --space-4 |
| Chat message (user) | transparent | 3px left --accent-primary | --text-primary | --space-3 |
| Chat message (agent) | transparent | 3px left --text-tertiary | --text-primary | --space-3 |
| Tool call card | --surface-secondary | 2px left --accent-info | --font-mono, --text-sm | --space-2 --space-3 |
| Input bar | --surface-primary | --border-default | --text-base | --space-2 --space-3 |
| Sub-agent card | --surface-secondary | --border-default | — | --space-3 |
| Command palette | --surface-elevated | --border-strong | --text-base | — |
