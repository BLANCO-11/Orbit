# AegisAgent Dashboard — Frontend Implementation Plan

> **Date:** 2026-07-10
> **Scope:** Full refactor of `dashboard/` — architecture, CSS remediation, component enhancement, polish, accessibility
> **Framework:** Next.js 16 + React 19 + Tailwind CSS 4 + Shadcn UI
> **Baseline:** 36 source files, 1218-line monolithic `page.js`, 14 CSS variable mismatches across 7 components

---

## Table of Contents
1. [Architecture Refactor](#1-architecture-refactor-phase-1)
2. [CSS Variable Remediation](#2-css-variable-remediation-phase-1)
3. [Component Enhancement](#3-component-enhancement-phase-2)
4. [UI/UX Polish](#4-uiux-polish-phase-3)
5. [Accessibility](#5-accessibility-phase-4)
6. [Final File Structure](#6-final-file-structure)
7. [Implementation Order](#7-implementation-order)

---

## 1. Architecture Refactor (Phase 1)

### 1.1 Problem Statement
`dashboard/src/app/page.js` is **1218 lines**. It contains:
- WebSocket connection management (L550-L710)
- 20+ `useState` declarations
- Session CRUD (L260-L450)
- TTS streaming queue (L720-L830)
- Speech recognition (L840-L870)
- Markdown rendering (L430-L470)
- Config fetching (L880-L940)
- All event handlers
- JSX rendering

**Result:** Unmaintainable, untestable, no separation of concerns.

### 1.2 State Management Decision: **React Context + useReducer**

**Reasoning:**
- Zustand: Overkill for this app — 20 pieces of state shared across 12 components, not complex enough to warrant external store.
- Jotai: Too granular for the coupling present (e.g., sending a prompt must touch messages, logs, executionPlan, metrics, and TTS state simultaneously).
- **Context + useReducer**: Co-located with the view, no extra dependency, one `dispatch` surface for the WebSocket handler, easy to persist.

**Architecture:**
```
AegisProvider (Context)
  ├── useAegisState()      → access state (read)
  ├── useAegisDispatch()   → dispatch actions
  └── useAegis()           → convenience hook combining both
```

### 1.3 Custom Hooks — Interface Definitions

#### `hooks/useWebSocket.js`
**Responsibility:** WebSocket lifecycle — connect, reconnect, message parsing, dispatch routing.
```js
function useWebSocket(backendWsUrl) {
  // Returns: { sendMessage, connectionState: 'connected'|'disconnected'|'connecting' }
  // Internal: socketRef, reconnect timer, sessionId tracking
  // On message: parses JSON, dispatches to useAegisDispatch()
}
```

#### `hooks/useSessions.js`
**Responsibility:** Session CRUD, localStorage sync, backend sync, search/filter/group.
```js
function useSessions(backendHttpUrl) {
  // Returns: {
  //   sessions, currentSessionId, groupedSessions,
  //   searchQuery, setSearchQuery,
  //   createSession, switchSession, deleteSession, renameSession,
  //   isLoading
  // }
  // Internal: debounced save (1s), localStorage fallback, URL param sync
}
```

#### `hooks/useAegisReducer.js`
**Responsibility:** Central state reducer + context provider.
```js
// State shape:
const initialState = {
  // Chat
  messages: [],
  logs: [],
  executionPlan: "",
  reasoningHistory: [],
  // Status
  status: "idle", // idle|thinking|executing|waiting_approval|done|error
  // Metrics
  metrics: { toolCalls: 0, latency: 0, tokens: 0, cost: 0, activeSubagents: [], actionFeed: [] },
  approvalsHistory: [],
  // UI
  expandedTools: {},
  visibleCount: 10,
  // Approval
  approvalRequest: null,
  // TTS
  tts: { voiceState: "audio", isPlaying: false },
  // Config
  config: { /* all SettingsPanel state */ },
};

// Actions (~25 action types):
// SET_STATUS, ADD_MESSAGE, UPDATE_LAST_MESSAGE, SET_MESSAGES,
// ADD_LOG, CLEAR_LOGS, SET_EXECUTION_PLAN, ADD_REASONING_GROUP,
// UPDATE_REASONING_ENTRY, SET_METRICS, UPDATE_METRICS,
// TOGGLE_TOOL, SET_VISIBLE_COUNT, SET_APPROVAL_REQUEST,
// ADD_APPROVAL_HISTORY, UPDATE_APPROVAL_HISTORY,
// SET_CONFIG, UPDATE_CONFIG, SET_VOICE_STATE,
// RESET_RUN, SET_SCREENSHOT, SET_SESSION_MODE, ...

function aegisReducer(state, action) { /* switch/case */ }

function AegisProvider({ children }) { /* Context.Provider */ }

function useAegisState() { /* useContext */ }
function useAegisDispatch() { /* useContext */ }
```

#### `hooks/useTTS.js`
**Responsibility:** TTS queue management — sentence splitting, fetching, playback.
```js
function useTTS(backendHttpUrl, selectedVoice) {
  // Returns: { speakText, stopSpeaking, isSpeaking, voiceState, setVoiceState }
  // Internal: ttsQueueRef, spokenSentencesRef, playback state machine
}
```

#### `hooks/useSpeechRecognition.js`
**Responsibility:** Browser SpeechRecognition API wrapper.
```js
function useSpeechRecognition() {
  // Returns: { isListening, startListening, stopListening, isSupported, error }
  // Internal: recognitionRef, event cleanup
}
```

#### `hooks/useKeyboardShortcuts.js`
**Responsibility:** Global keyboard shortcut handler.
```js
function useKeyboardShortcuts(handlers) {
  // Supported shortcuts:
  // Ctrl+K → command palette
  // Ctrl+N → new session
  // Escape → cancel/interrupt agent
  // Ctrl+Enter → send message (already in ChatInput)
}
```

#### `hooks/useSessionPersistence.js`
**Responsibility:** Debounced save to localStorage + backend.
```js
function useSessionPersistence(backendHttpUrl, sessionId) {
  // Internal: debouncedSaveTimeoutRef, lastSavedStateRef, beforeunload handler
  // Calls: saveNow(), scheduleSave()
}
```

### 1.4 Refactored `page.js` (Target: ~80 lines)
```js
export default function Dashboard() {
  return (
    <AegisProvider>
      <DashboardInner />
    </AegisProvider>
  );
}

function DashboardInner() {
  const { connectionState } = useWebSocket(backendWsUrl);
  const sessions = useSessions(backendHttpUrl);
  const state = useAegisState();
  const dispatch = useAegisDispatch();
  const { theme, mounted, toggleTheme } = useTheme();
  const { isMobile } = useResponsive();

  // Minimal orchestration only:
  // - handleSubmitPrompt → dispatch + ws.send
  // - handleApproval → ws.send
  // - handleStop → ws.send

  return (
    <AppShell
      sidebar={<SessionList sessions={sessions} ... />}
      rightPanel={<RightPanelShell ...>...</RightPanelShell>}
      headerProps={...}
    >
      <ChatArea ... />
    </AppShell>
  );
}
```

---

## 2. CSS Variable Remediation (Phase 1)

### 2.1 Complete Mismatch Map

Every mismatched variable → correct token in `globals.css`:

| **Mismatched Variable** | **Correct Token** | **Files & Lines** |
|---|---|---|
| `--text-main` | `--text-primary` | ChatMessage.jsx:112,214,272,293,383; MetricsPanel.jsx:135,226,232,254,278,490,617; SettingsPanel.jsx:55,192; LogViewer.jsx:43; ToolCallCard.jsx:55; ApprovalBanner.jsx:50; ExecutionPlan.jsx:175,187,241,303 |
| `--text-muted` | `--text-secondary` | ChatMessage.jsx:124,205,231,241,272,275,281,401,432; MetricsPanel.jsx:19,44,129,202,210,225,231,237,251,268,372,402; SettingsPanel.jsx:65,322,333,348,396,412,429,445,462,481,500,519,545; LogViewer.jsx:42; ToolCallCard.jsx:54,59; ApprovalBanner.jsx:34,53; ExecutionPlan.jsx:68,81,85,138,282,293,297; ScreenshotViewer.jsx:28 |
| `--text-dark` | `--text-tertiary` | MetricsPanel.jsx:172,282,286,431,460,493,529,600,605; ChatMessage.jsx:119,227; ToolCallCard.jsx:76,89; SettingsPanel.jsx:412; LogViewer.jsx:24,48; ExecutionPlan.jsx:133,146,154,161,222,225,229 |
| `--border-color` | `--border-default` | ChatMessage.jsx:81,134,222,265,291,382; SettingsPanel.jsx:77,105,395; MetricsPanel.jsx:11,100,184,371,399,535; ToolCallCard.jsx:29,68; ExecutionPlan.jsx:113,126,305; ScreenshotViewer.jsx:15 |
| `--border-muted` | `--border-subtle` | SettingsPanel.jsx:56,193; ScreenshotViewer.jsx:21; ApprovalBanner.jsx:44,116 |
| `--primary` | `--accent-primary` | ChatMessage.jsx:309,310,321,377; SettingsPanel.jsx:363 |
| `--primary-foreground` | `--text-inverse` | ChatMessage.jsx:311,383; SettingsPanel.jsx:354 |
| `--primary-hover` | `--accent-primary-hover` | ChatMessage.jsx:320 |
| `--primary-glow` | `--accent-primary-glow` | ChatMessage.jsx:384 |
| `--input-bg` | `--surface-secondary` | ChatMessage.jsx:377 |
| `--warning` | `--accent-warning` | ChatMessage.jsx:107; ToolCallCard.jsx:50; ApprovalBanner.jsx:17,91,98; MetricsPanel.jsx:476,500 |
| `--success` | `--accent-success` | ChatMessage.jsx:109,282; ToolCallCard.jsx:52; ApprovalBanner.jsx:124; MetricsPanel.jsx:477,500 |
| `--danger` | `--accent-danger` | LogViewer.jsx:40 |
| `--info` | `--accent-info` | ExecutionPlan.jsx:133,138,222,258 |
| `--panel-bg` | `--surface-primary` | ScreenshotViewer.jsx:15 |

### 2.2 Remediation Strategy

**Step 1:** Global search-and-replace using `sed` across all files:
```bash
# Pattern 1: text tokens
find dashboard/src -name '*.jsx' -exec sed -i 's/--text-main/--text-primary/g' {} +
find dashboard/src -name '*.jsx' -exec sed -i 's/--text-muted/--text-secondary/g' {} +
find dashboard/src -name '*.jsx' -exec sed -i 's/--text-dark/--text-tertiary/g' {} +

# Pattern 2: border tokens
find dashboard/src -name '*.jsx' -exec sed -i 's/--border-color/--border-default/g' {} +
find dashboard/src -name '*.jsx' -exec sed -i 's/--border-muted/--border-subtle/g' {} +

# Pattern 3: accent color tokens (order matters — specific before general)
find dashboard/src -name '*.jsx' -exec sed -i 's/--primary-glow/--accent-primary-glow/g' {} +
find dashboard/src -name '*.jsx' -exec sed -i 's/--primary-hover/--accent-primary-hover/g' {} +
find dashboard/src -name '*.jsx' -exec sed -i 's/--primary-foreground/--text-inverse/g' {} +
find dashboard/src -name '*.jsx' -exec sed -i 's/--primary\b/--accent-primary/g' {} +

# Pattern 4: input/search
find dashboard/src -name '*.jsx' -exec sed -i 's/--input-bg/--surface-secondary/g' {} +

# Pattern 5: semantic color tokens
find dashboard/src -name '*.jsx' -exec sed -i 's/--warning\b/--accent-warning/g' {} +
find dashboard/src -name '*.jsx' -exec sed -i 's/--success\b/--accent-success/g' {} +
find dashboard/src -name '*.jsx' -exec sed -i 's/--danger\b/--accent-danger/g' {} +
find dashboard/src -name '*.jsx' -exec sed -i 's/--info\b/--accent-info/g' {} +

# Pattern 6: --panel-bg
find dashboard/src -name '*.jsx' -exec sed -i 's/--panel-bg/--surface-primary/g' {} +
```

**Step 2:** Manually verify `page.js` line 321 uses `--primary` (not `--primary-foreground` or `--primary-glow`), which the regex `\b` boundary handles.

**Step 3:** Update `lib/constants.js:38` — `STATUS_COLORS.thinking` currently uses `var(--accent-warning)` (correct), but `executing` uses `var(--accent-info)`. These are already correct. No change needed there.

**Step 4:** Run `npm run build` to verify no CSS variable undefined warnings.

---

## 3. Component Enhancement (Phase 2)

### 3.1 ChatMessage (`dashboard/src/components/ChatMessage.jsx`)

**Current:** 433 lines. Includes `ChatEmptyState`, `ToolGroupAccordion`, `ModeSuggestionAccordion`, and `ChatMessage` all in one file.

**Enhancements:**

| Feature | Implementation |
|---|---|
| **Timestamps** | Add `message.timestamp` display below each bubble: `<span className="text-tertiary">{formatTime(message.timestamp)}</span>` |
| **Copy button** | Add a clipboard icon that appears on hover (right side of message). `navigator.clipboard.writeText(message.content)`. Show "Copied!" toast for 2s. |
| **Retry** | Add a retry icon on the last user message (only when status is "error" or "done"). Calls `handleSubmitPrompt(message.content)`. |
| **Markdown sanitization (DOMPurify)** | Install `dompurify`. Replace `dangerouslySetInnerHTML={renderMarkdown(msg.content)}` with `dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(renderMarkdown(msg.content).__html) }}`. Create a `lib/sanitize.js` with `sanitizeHtml(html)` export. |
| **File split** | Extract `ToolGroupAccordion` into `components/chat/ToolGroupAccordion.jsx`. Extract `ModeSuggestionAccordion` into `components/chat/ModeSuggestionAccordion.jsx`. Extract `ChatEmptyState` into `components/chat/ChatEmptyState.jsx`. Keep `ChatMessage` at ~100 lines. |

### 3.2 ChatInput (`dashboard/src/components/chat/ChatInput.jsx`)

**Current:** 197 lines. Handles textarea, mic, TTS, send/stop, and input history navigation.

**Enhancements:**

| Feature | Implementation |
|---|---|
| **Keyboard shortcut: Escape** | Add `onKeyDown` handler: when `Escape` is pressed and agent is processing, call `onStop()`. When idle, blur textarea. |
| **Placeholder states** | Current placeholder is good. Add a "Press Escape to cancel" hint in the placeholder when processing. |
| **Input history persistence** | Currently uses refs (lost on remount). Move `inputHistoryRef` to `useAegisState()` context so it survives session switches. |
| **Character counter** | Show character count when > 2000 chars: `<span className="text-tertiary" style={{ fontSize: '0.65rem' }}>{prompt.length}/2000</span>`. |
| **Max input limit** | Enforce `maxLength={4000}` on textarea. Prevent submit when > 4000 chars. |

### 3.3 SessionList (`dashboard/src/components/SessionList.jsx`)

**Current:** 216 lines. Search input, grouped list, delete button.

**Enhancements:**

| Feature | Implementation |
|---|---|
| **Debounced search** | Use `useDebounce(searchQuery, 300)` custom hook. Pass `debouncedQuery` to filter logic. `hooks/useDebounce.js`. |
| **Session rename** | Add inline rename: double-click session title → replaces `<span>` with `<input>`. On Enter/blur, save new title. Add to `useSessions` as `renameSession(id, newTitle)`. |
| **Confirmation dialog for delete** | Replace immediate delete with a confirmation: clicking trash shows "Delete session?" with Confirm/Cancel buttons in a small popover/tooltip. |
| **Empty state improvements** | When 0 sessions: show illustration + "No sessions yet. Type a message to create your first session." |

### 3.4 MetricsPanel (`dashboard/src/components/MetricsPanel.jsx`)

**Current:** ~630 lines. Session metrics, subagent tabs, action feed, approval history.

**Enhancements:**

| Feature | Implementation |
|---|---|
| **Collapsible sections** | Each section (Session Metrics, Subagent Orchestration, Action Feed, Approval Guard) gets a click-to-collapse header. State in `expandedSections` local useState. |
| **Skeleton loading** | When `metrics` is empty object (initial load), show skeleton placeholders instead of "0 calls". Use `.skeleton` CSS class from globals.css. |
| **Proper color usage** | Replace hardcoded `#60a5fa`, `#10b981`, `#f59e0b`, `#ef4444`, `#a78bfa` with `var(--accent-info)`, `var(--accent-success)`, `var(--accent-warning)`, `var(--accent-danger)`, and a new `--accent-purple` token (add to globals.css). |
| **File split** | Extract `MetricCard` into `components/monitoring/MetricCard.jsx`. Extract `SubagentPanel` into `components/monitoring/SubagentPanel.jsx`. Extract `SectionHeader` into `components/monitoring/SectionHeader.jsx`. |

### 3.5 SettingsPanel (`dashboard/src/components/SettingsPanel.jsx`)

**Current:** ~550 lines. Monolithic settings with all sections flat.

**Enhancements:**

| Feature | Implementation |
|---|---|
| **Collapsible section groups** | Group into collapsible sections: "Model & API", "Voice & Audio", "Memory & Compaction", "Agent Mode", "Security Policies". Each section has a chevron toggle. |
| **Validation feedback** | Add inline validation: API URL format check, API key length check, threshold range check. Show red border + error text below invalid fields. |
| **Unsaved changes indicator** | Track `isDirty` state. Show "You have unsaved changes" banner at bottom with "Save" and "Discard" buttons. |
| **File split** | Extract into `components/settings/ModelSection.jsx`, `components/settings/VoiceSection.jsx`, `components/settings/MemorySection.jsx`, `components/settings/ModeSection.jsx`, `components/settings/SecuritySection.jsx`. SettingsPanel becomes a thin composer. |

### 3.6 ScreenshotViewer (`dashboard/src/components/ScreenshotViewer.jsx`)

**Current:** ~54 lines. Simple `<img>` with `object-fit: contain`.

**Enhancements:**

| Feature | Implementation |
|---|---|
| **Zoom + Pan** | Add zoom controls (+, -, reset). Use CSS `transform: scale()` on the img. On zoomed-in state, add mouse drag to pan (`transform: translate()`). |
| **Fullscreen** | Add fullscreen button using `element.requestFullscreen()`. |
| **Refresh button** | Add a refresh icon that adds `?t=${Date.now()}` to the screenshot URL to force reload. |
| **Loading state** | Show a skeleton while the image loads (`onLoad`/`onError` handlers). |
| **Error state** | If image fails to load, show "Browser preview unavailable" with a retry button. |

### 3.7 ExecutionPlan (`dashboard/src/components/ExecutionPlan.jsx`)

**Current:** ~310 lines. Reasoning history with collapsible query groups.

**Enhancements:**

| Feature | Implementation |
|---|---|
| **Streaming visualization** | Add a pulsing cursor/indicator at the end of the currently-streaming reasoning text. |
| **Auto-scroll improvements** | Use `scrollIntoView({ behavior: 'smooth', block: 'nearest' })` on the last entry instead of `scrollTop = scrollHeight` to prevent jank. |
| **Token count per step** | Show estimated token count for each reasoning entry. |
| **Copy reasoning** | Add copy button per reasoning entry. |

### 3.8 LogViewer (`dashboard/src/components/LogViewer.jsx`)

**Current:** ~60 lines. Simple list of log entries.

**Enhancements:**

| Feature | Implementation |
|---|---|
| **Filtering** | Add filter row: "All | System | Errors | Tool Calls". Use `filterLogs` local state. |
| **Auto-scroll toggle** | Add a "Follow" toggle button (default: on). When off, new logs don't auto-scroll. Show "↓ New logs" button when scrolled up. |
| **Clear logs** | Add "Clear" button that clears current visible logs. |
| **Log search** | Add inline search bar to filter logs by text. |
| **Line numbers** | Add optional line number column for power users. |

### 3.9 ApprovalBanner (`dashboard/src/components/ApprovalBanner.jsx`)

**Current:** ~130 lines. Two variants: command approval + edit permission.

**Enhancements:**

| Feature | Implementation |
|---|---|
| **Better visual hierarchy** | Use proper surface classes: banner gets `surface-elevated` with accent-colored left border (4px). |
| **Command syntax highlighting** | Use `<pre><code>` with syntax coloring for the command text. |
| **Risk level indicator** | Show risk badge: "Low Risk" (green), "Medium Risk" (yellow), "High Risk" (red) based on command type and paths. |
| **Countdown auto-deny** | Show "Auto-deny in 30s" countdown if no response (backed by server-side timeout already in place). |
| **Edit permission: path diff visual** | Show the safe zone vs requested paths as a visual comparison. |

---

## 4. UI/UX Polish (Phase 3)

### 4.1 Onboarding Flow
**Component:** `components/widgets/OnboardingGuide.jsx`

First-time user detection: `localStorage.getItem('aegis-onboarded') === null`.

Flow:
1. **Welcome screen** overlay: "Welcome to AegisAgent" with brief description
2. **Mode explanation**: Card explaining Plan/Edit/YOLO modes with illustrations
3. **Quick start**: "Try saying: 'List files in my home directory'" clickable suggestion
4. **"Got it"** button → sets `localStorage.setItem('aegis-onboarded', 'true')`

### 4.2 Notification Center
**Component:** `components/widgets/NotificationCenter.jsx`

- Bell icon in header with unread count badge
- Click opens dropdown panel showing recent notifications
- Notifications from: approval requests, agent completions, errors, compaction events
- Each notification has: icon + title + timestamp + "dismiss" button
- Store notifications in `useAegisState()` context: `notifications[]`

### 4.3 Command Palette (Ctrl+K)
**Component:** `components/widgets/CommandPalette.jsx`

- Overlay modal triggered by Ctrl+K
- Search input at top
- Commands:
  - "New Session" → `handleCreateNewSession()`
  - "Switch to [session name]" → `handleSwitchSession(id)`
  - "Toggle Theme" → `toggleTheme()`
  - "Toggle Console" → `onToggleThinking()`
  - "Open Settings" → `setRightPanelTab('settings')`
  - "Compact Memory" → `handleManualCompact()`
  - "Stop Agent" → `handleStopAgent()`
- Filter as you type with fuzzy matching
- Highlight matching characters
- Arrow key navigation + Enter to select

### 4.4 Theme Transition Animation
**Implementation in globals.css:**
```css
html {
  transition: color-scheme 0.3s ease;
}
body {
  transition: background-color 0.3s var(--ease-out-expo),
              color 0.3s var(--ease-out-expo);
}
/* All surfaces get transition on background and border */
.surface-primary, .surface-secondary, .surface-elevated,
.sidebar-panel, .right-panel, .app-header {
  transition: background-color 0.3s var(--ease-out-expo),
              border-color 0.3s var(--ease-out-expo);
}
```

### 4.5 Responsive Font Scaling
Add to `globals.css`:
```css
/* Fluid type scale using clamp() */
:root {
  --fs-body: clamp(0.875rem, 0.85rem + 0.1vw, 0.95rem);
  --fs-sm: clamp(0.75rem, 0.72rem + 0.1vw, 0.82rem);
  --fs-xs: clamp(0.65rem, 0.62rem + 0.1vw, 0.72rem);
  --fs-h4: clamp(0.9rem, 0.88rem + 0.1vw, 1rem);
  --fs-h3: clamp(1.05rem, 1rem + 0.2vw, 1.15rem);
  --fs-h2: clamp(1.25rem, 1.2rem + 0.2vw, 1.4rem);
  --fs-h1: clamp(1.5rem, 1.4rem + 0.4vw, 1.7rem);
}
```

### 4.6 Message List Virtualization
**Library:** `@tanstack/react-virtual`

Use in `ChatArea.jsx`:
```jsx
import { useVirtualizer } from '@tanstack/react-virtual';

const virtualizer = useVirtualizer({
  count: messages.length,
  getScrollElement: () => containerRef.current,
  estimateSize: () => 120, // average message height
  overscan: 5,
});
```
Only render visible messages + overscan. This handles sessions with 500+ messages smoothly.

### 4.7 Loading/Skeleton States

| Operation | Skeleton |
|---|---|
| Config fetch | SettingsPanel: 6 skeleton rows with `.skeleton` class |
| Session load | ChatArea: 4 skeleton message bubbles (alternating left/right) |
| Model list fetch | Select dropdown disabled with "Loading models..." |
| WebSocket connecting | Header status shows "Connecting..." with pulse animation |
| Screenshot loading | Image area shows skeleton with camera icon |
| Metrics loading | MetricCards show `.skeleton` bars instead of "0" values |

### 4.8 Error Boundaries
**Component:** `components/ErrorBoundary.jsx`

```jsx
class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null };
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, errorInfo) { console.error("ErrorBoundary:", error, errorInfo); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="surface-primary" style={{ padding: '40px', textAlign: 'center' }}>
          <h3>Something went wrong</h3>
          <p className="text-secondary">{this.state.error?.message}</p>
          <Button onClick={() => this.setState({ hasError: false })}>Try Again</Button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

Wrap in `layout.js`:
```jsx
<ErrorBoundary>
  <AppShell>...</AppShell>
</ErrorBoundary>
```

Plus granular boundaries around `ChatArea`, `MetricsPanel`, `SettingsPanel`.

### 4.9 Connection Status Indicator
**Component in Header:** `components/widgets/ConnectionIndicator.jsx`

- WebSocket states: `connected` (green dot), `connecting` (yellow pulsing), `disconnected` (red dot), `error` (red dot + "Reconnecting in Xs...")
- Uses `useWebSocket().connectionState`
- Clicking disconnected state triggers `reconnect()`

### 4.10 Empty States

| Panel | Empty State |
|---|---|
| ChatArea | `ChatEmptyState` — already exists, enhance with suggested prompts: "Try: 'List files in /home'" |
| SessionList | "No sessions yet. Type a message to start." |
| LogViewer | "No activity logs yet. Send a prompt to begin." |
| MetricsPanel → Action Feed | "Waiting for tool activities. The feed updates as the agent works." |
| MetricsPanel → Approval Guard | "No approvals requested yet." (already exists) |
| ScreenshotViewer | "No browser preview available. Use the agent to browse the web." |
| ExecutionPlan | "No reasoning recorded yet. Use Plan or Hybrid mode to see agent thinking." |

---

## 5. Accessibility (Phase 4)

### 5.1 WCAG 2.1 AA Compliance Checklist

| # | Criterion | Current Status | Action |
|---|---|---|---|
| 1 | **1.1.1 Non-text Content** | Missing alt text on screenshots | Add descriptive `alt` attributes to all `<img>` elements |
| 2 | **1.3.1 Info and Relationships** | Inconsistent heading hierarchy | Use semantic `<h1>`-`<h4>`, ensure logical nesting |
| 3 | **1.3.2 Meaningful Sequence** | Tab order correct | Verify DOM order matches visual order |
| 4 | **1.4.1 Use of Color** | Status dot only color | Add text label alongside status dot |
| 5 | **1.4.3 Contrast (Minimum)** | Needs audit | Run axe DevTools; dark theme passes; light theme needs verification |
| 6 | **1.4.10 Reflow** | Responsive breakpoints exist | Verify 320px wide works without horizontal scroll |
| 7 | **1.4.11 Non-text Contrast** | Border contrast ~OK | Ensure `--border-default` meets 3:1 against `--bg-base` |
| 8 | **2.1.1 Keyboard** | Missing shortcuts | Implement full keyboard navigation (see §5.2) |
| 9 | **2.2.1 Timing Adjustable** | Auto-deny countdown | Provide pause/extend on approval countdown |
| 10 | **2.3.1 Three Flashes** | No flashing | Verify no content flashes >3 times/second |
| 11 | **2.4.1 Bypass Blocks** | Missing skip link | Add "Skip to main content" link as first focusable element |
| 12 | **2.4.3 Focus Order** | Needs verification | Test Tab through all interactive elements |
| 13 | **2.4.7 Focus Visible** | `.focus-ring` class exists | Ensure ALL interactive elements use `.focus-ring` |
| 14 | **3.3.2 Labels or Instructions** | Missing on icon buttons | Add `aria-label` to ALL icon-only buttons (mode selector, mic, TTS, theme) |
| 15 | **4.1.2 Name, Role, Value** | Missing roles on custom widgets | Add `role="tablist"`, `role="tab"`, `aria-selected` to RightPanelShell tabs |
| 16 | **4.1.3 Status Messages** | Missing live regions | Add `aria-live="polite"` regions for status changes, new messages |

### 5.2 Keyboard Navigation Map

```
Tab order (LTR, top-to-bottom):

1. [Skip to main content] (hidden, visible on focus)
2. Header: sidebar toggle button
3. Header: theme toggle button
4. Header: right panel toggle button
5. Sidebar: New Session button
6. Sidebar: Search input
7. Sidebar: Session list items (arrow-key navigable)
8. Main: Chat messages (not focusable individually — use virtual cursor)
9. Main: Mode selector button
10. Main: Prompt type selector button
11. Main: Mic button
12. Main: TTS button
13. Main: Chat textarea
14. Main: Send/Stop button
15. Main: Approval banner Approve/Deny buttons (when visible)
16. Right panel: Tab buttons (arrow-key navigable)
17. Right panel: Tab content (scrollable)
18. Bottom nav (mobile only): Chat, Logs, Metrics, Settings

Shortcuts (non-tab):
Ctrl+K     → Command Palette (global)
Ctrl+N     → New Session
Escape     → Cancel agent / Close modal / Blur textarea
Ctrl+Enter → Send message (when textarea focused)
↑/↓        → Navigate input history (when textarea focused, no shift)
```

### 5.3 Screen Reader Announcement Strategy

| Event | Announcement | Method |
|---|---|---|
| New assistant message | "New message from agent: [first 100 chars]" | `aria-live="polite"` region at bottom of chat |
| Status change | "Agent status changed to [status]" | `aria-live="polite"` region in header |
| Approval required | "Action requires your approval: [command]" | `aria-live="assertive"` region in approval banner |
| Error occurred | "Error: [message]" | `aria-live="assertive"` region |
| Session switched | "Switched to session: [title]" | `aria-live="polite"` |
| WebSocket disconnected | "Connection lost. Reconnecting..." | `aria-live="assertive"` |

**Implementation:** Add a `<ScreenReaderAnnouncer />` component:
```jsx
function ScreenReaderAnnouncer() {
  const { announcement } = useAegisState();
  return (
    <div className="sr-only" aria-live="polite" aria-atomic="true">
      {announcement}
    </div>
  );
}
```

### 5.4 Focus Trap for Modals/Drawers

**Components needing focus trap:**
- Command Palette (Ctrl+K)
- Confirmation dialogs (delete session, YOLO mode warning)
- Mobile sidebar overlay
- Mobile right panel overlay

**Implementation:** Use a `useFocusTrap(ref)` hook:
```js
function useFocusTrap(containerRef, isActive) {
  useEffect(() => {
    if (!isActive) return;
    const container = containerRef.current;
    const focusable = container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    
    function handleTab(e) {
      if (e.key === 'Tab') {
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    
    container.addEventListener('keydown', handleTab);
    first?.focus();
    return () => container.removeEventListener('keydown', handleTab);
  }, [isActive]);
}
```

### 5.5 Reduced Motion Support
Already implemented in `globals.css:604-609`. Verify it covers:
- Message entry animations
- Panel slide animations
- Tool accordion expand/collapse
- Theme transition

---

## 6. Final File Structure

```
dashboard/src/
├── app/
│   ├── globals.css                    # Design system (already correct, minor additions)
│   ├── layout.js                      # Root layout + providers (modified)
│   ├── page.js                        # Thin orchestrator (~80 lines) (refactored)
│   └── ThemeScript.js                 # FOUC prevention (unchanged)
│
├── components/
│   ├── ui/                            # Shadcn primitives (unchanged)
│   │   ├── badge.jsx
│   │   ├── button.jsx
│   │   ├── card.jsx
│   │   ├── input.jsx
│   │   ├── kbd.jsx
│   │   ├── scroll-area.jsx
│   │   ├── select.jsx
│   │   ├── separator.jsx
│   │   └── switch.jsx
│   │
│   ├── layout/                        # Shell components
│   │   ├── AppShell.jsx              # Responsive 3-column layout (mostly OK, minor polish)
│   │   ├── Header.jsx                # App header (minor enhancements)
│   │   ├── Sidebar.jsx               # Simple wrapper (unchanged)
│   │   ├── RightPanel.jsx            # Right panel wrapper (unchanged)
│   │   ├── RightPanelShell.jsx       # Tabbed right panel (minor enhancements)
│   │   └── BottomNav.jsx             # Mobile bottom nav (unchanged)
│   │
│   ├── chat/                          # Chat domain
│   │   ├── ChatArea.jsx              # Chat column composer (refactored with virtualization)
│   │   ├── ChatMessage.jsx           # Single message bubble (~100 lines) (split from monolith)
│   │   ├── ChatInput.jsx             # Input bar (enhanced with shortcuts)
│   │   ├── ChatEmptyState.jsx        # Empty state with suggestions (extracted)
│   │   ├── ToolCallCard.jsx          # Single tool call display (unchanged core)
│   │   ├── ToolGroupAccordion.jsx    # Grouped tool calls (extracted)
│   │   ├── ModePrompt.jsx            # Mode selection prompt (unchanged)
│   │   ├── ModeSelector.jsx          # Mode dropdown (unchanged)
│   │   ├── ModeSuggestionAccordion.jsx # Mode suggestion from agent (extracted)
│   │   └── PromptTypeSelector.jsx    # System prompt type selector (unchanged)
│   │
│   ├── monitoring/                    # Metrics domain
│   │   ├── MetricsPanel.jsx          # Composer (~80 lines) (refactored)
│   │   ├── MetricCard.jsx            # Single metric display (extracted)
│   │   ├── SubagentPanel.jsx         # Subagent detail card (extracted)
│   │   ├── SectionHeader.jsx         # Reusable section header (extracted)
│   │   ├── ActionFeed.jsx            # Tool call action timeline (extracted)
│   │   └── ApprovalHistory.jsx       # Approval guard panel (extracted)
│   │
│   ├── settings/                      # Settings domain
│   │   ├── SettingsPanel.jsx         # Composer (~60 lines) (refactored)
│   │   ├── ModelSection.jsx          # LiteLLM config + model selects (extracted)
│   │   ├── VoiceSection.jsx          # TTS voice selection (extracted)
│   │   ├── MemorySection.jsx         # Compaction settings (extracted)
│   │   ├── ModeSection.jsx           # Agent mode picker (extracted)
│   │   └── SecuritySection.jsx       # Paths, prefixes, HITL (extracted)
│   │
│   └── widgets/                       # Miscellaneous widgets
│       ├── ApprovalBanner.jsx        # HITL approval UI (enhanced)
│       ├── ExecutionPlan.jsx         # Reasoning audit trail (enhanced)
│       ├── LogViewer.jsx             # System logs (enhanced with filtering)
│       ├── ScreenshotViewer.jsx      # Browser viewport (enhanced with zoom)
│       ├── SessionList.jsx           # Session sidebar (enhanced with rename/confirm)
│       ├── CommandPalette.jsx        # NEW: Ctrl+K command palette
│       ├── NotificationCenter.jsx    # NEW: Notification bell + dropdown
│       ├── ConnectionIndicator.jsx   # NEW: WebSocket status indicator
│       ├── OnboardingGuide.jsx       # NEW: First-time user flow
│       └── ScreenReaderAnnouncer.jsx # NEW: aria-live region manager
│
├── hooks/                             # Custom hooks
│   ├── index.js                      # Re-exports
│   ├── useTheme.js                   # Theme toggle (existing, unchanged)
│   ├── useResponsive.js             # Breakpoint detection (existing, unchanged)
│   ├── useDebounce.js               # NEW: Generic debounce hook
│   ├── useWebSocket.js              # NEW: WebSocket lifecycle + dispatch
│   ├── useSessions.js               # NEW: Session CRUD + search + persistence
│   ├── useAegisReducer.js           # NEW: Central state reducer + context
│   ├── useTTS.js                    # NEW: TTS streaming queue
│   ├── useSpeechRecognition.js      # NEW: Browser STT wrapper
│   ├── useKeyboardShortcuts.js      # NEW: Global keyboard shortcuts
│   ├── useSessionPersistence.js     # NEW: Debounced save to backend + localStorage
│   ├── useFocusTrap.js              # NEW: Modal/drawer focus trapping
│   └── useScreenReader.js           # NEW: aria-live announcement dispatcher
│
├── lib/
│   ├── constants.js                  # Design tokens, mode config, status maps (minor updates)
│   ├── utils.js                      # cn() utility (unchanged)
│   ├── sanitize.js                   # NEW: DOMPurify wrapper for markdown
│   └── format.js                     # NEW: Date/time formatters
│
└── providers/                        # NEW: React context providers
    └── AegisProvider.jsx            # Context + useReducer + initial load
```

---

## 7. Implementation Order

Tasks ordered by dependency. Each includes estimated effort in hours.

### Phase 1: Foundation (4-6 hours)

| # | Task | Depends On | Effort | File(s) |
|---|---|---|---|---|
| 1.1 | Install DOMPurify: `npm install dompurify` | — | 0.1h | `package.json` |
| 1.2 | Create `lib/sanitize.js` — `sanitizeHtml()` wrapper | 1.1 | 0.2h | New file |
| 1.3 | Create `lib/format.js` — `formatTime()`, `formatRelativeTime()` | — | 0.3h | New file |
| 1.4 | CSS variable remediation — global find/replace all 14 mismatched tokens (§2) | — | 0.5h | 7+ files |
| 1.5 | Verify build after CSS remediation: `npm run build` | 1.4 | 0.2h | — |
| 1.6 | Create `hooks/useDebounce.js` | — | 0.2h | New file |
| 1.7 | Create `hooks/useFocusTrap.js` | — | 0.3h | New file |
| 1.8 | Create `hooks/useScreenReader.js` | — | 0.2h | New file |
| 1.9 | Create `hooks/useAegisReducer.js` — full state shape + reducer + provider + context hooks | — | 2.0h | New file |
| 1.10 | Create `providers/AegisProvider.jsx` — re-export from hook file | 1.9 | 0.1h | New file |
| 1.11 | Update `app/layout.js` to wrap children in `<AegisProvider>` | 1.10 | 0.3h | Modified |

### Phase 2: Core Hooks (5-7 hours)

| # | Task | Depends On | Effort | File(s) |
|---|---|---|---|---|
| 2.1 | Create `hooks/useWebSocket.js` — connect, reconnect, parse, dispatch | 1.9 | 2.0h | New file |
| 2.2 | Create `hooks/useSessions.js` — CRUD, localStorage, backend sync, search | 1.9 | 1.5h | New file |
| 2.3 | Create `hooks/useTTS.js` — streaming queue, playback state machine | 1.9 | 1.0h | New file |
| 2.4 | Create `hooks/useSpeechRecognition.js` — STT wrapper | 1.9 | 0.5h | New file |
| 2.5 | Create `hooks/useKeyboardShortcuts.js` — global shortcut handler | 1.9 | 0.5h | New file |
| 2.6 | Create `hooks/useSessionPersistence.js` — debounced save, beforeunload | 1.9 | 0.5h | New file |
| 2.7 | Update `hooks/index.js` with all new exports | 2.1-2.6 | 0.1h | Modified |

### Phase 3: page.js Decomposition (3-5 hours)

| # | Task | Depends On | Effort | File(s) |
|---|---|---|---|---|
| 3.1 | Refactor `app/page.js` — replace all state with `useAegisState()`/`dispatch` | 2.1-2.6 | 2.0h | Modified |
| 3.2 | Wire `useWebSocket` in page.js, dispatch on message | 2.1, 3.1 | 1.0h | Modified |
| 3.3 | Wire `useSessions` in page.js, replace session handlers | 2.2, 3.1 | 0.5h | Modified |
| 3.4 | Wire `useTTS` and `useSpeechRecognition` | 2.3, 2.4, 3.1 | 0.3h | Modified |
| 3.5 | Wire `useKeyboardShortcuts` and `useSessionPersistence` | 2.5, 2.6, 3.1 | 0.2h | Modified |
| 3.6 | Test full app: send message, switch session, approve, compact, TTS | 3.1-3.5 | 1.0h | — |
| 3.7 | Verify no regressions — smoke test all features | 3.6 | 1.0h | — |

### Phase 4: Component Splitting (3-5 hours)

| # | Task | Depends On | Effort | File(s) |
|---|---|---|---|---|
| 4.1 | Extract `ToolGroupAccordion` from ChatMessage into `components/chat/ToolGroupAccordion.jsx` | 3.7 | 0.3h | New + Modified |
| 4.2 | Extract `ModeSuggestionAccordion` from ChatMessage into `components/chat/ModeSuggestionAccordion.jsx` | 3.7 | 0.3h | New + Modified |
| 4.3 | Extract `ChatEmptyState` from ChatMessage into `components/chat/ChatEmptyState.jsx` | 3.7 | 0.2h | New + Modified |
| 4.4 | Extract `MetricCard`, `SubagentPanel`, `SectionHeader`, `ActionFeed`, `ApprovalHistory` from MetricsPanel into `components/monitoring/` | 3.7 | 0.8h | New + Modified |
| 4.5 | Extract `ModelSection`, `VoiceSection`, `MemorySection`, `ModeSection`, `SecuritySection` from SettingsPanel into `components/settings/` | 3.7 | 0.8h | New + Modified |
| 4.6 | Verify all import paths, no circular deps, build passes | 4.1-4.5 | 0.5h | — |

### Phase 5: Component Enhancements (4-6 hours)

| # | Task | Depends On | Effort | File(s) |
|---|---|---|---|---|
| 5.1 | **ChatMessage**: timestamps + copy button + DOMPurify sanitization | 1.1, 1.2, 4.1-4.3 | 1.0h | ChatMessage.jsx |
| 5.2 | **ChatMessage**: retry button on error/last message | 5.1 | 0.3h | ChatMessage.jsx |
| 5.3 | **ChatInput**: Escape key, character counter, max length | 3.7 | 0.5h | ChatInput.jsx |
| 5.4 | **SessionList**: debounced search, inline rename, delete confirmation | 1.6, 3.7 | 1.0h | SessionList.jsx |
| 5.5 | **MetricsPanel**: collapsible sections, skeleton loading, color tokens | 4.4 | 0.8h | MetricsPanel + monitoring/* |
| 5.6 | **SettingsPanel**: collapsible sections, validation, unsaved indicator | 4.5 | 0.8h | SettingsPanel + settings/* |
| 5.7 | **ScreenshotViewer**: zoom + pan + fullscreen + refresh + loading state | 3.7 | 1.0h | ScreenshotViewer.jsx |
| 5.8 | **LogViewer**: filtering, auto-scroll toggle, clear, search | 3.7 | 0.8h | LogViewer.jsx |
| 5.9 | **ApprovalBanner**: visual hierarchy, syntax highlight, risk badge | 3.7 | 0.5h | ApprovalBanner.jsx |
| 5.10 | **ExecutionPlan**: streaming cursor, smoother scroll, copy button | 3.7 | 0.5h | ExecutionPlan.jsx |

### Phase 6: UI/UX Polish (4-6 hours)

| # | Task | Depends On | Effort | File(s) |
|---|---|---|---|---|
| 6.1 | **Connection Indicator**: WebSocket status in header | 2.1, 5.1 | 0.5h | ConnectionIndicator.jsx, Header.jsx |
| 6.2 | **Command Palette**: Ctrl+K modal with fuzzy search | 2.5, 5.1 | 1.5h | CommandPalette.jsx |
| 6.3 | **Notification Center**: bell icon + dropdown | 3.7 | 0.8h | NotificationCenter.jsx |
| 6.4 | **Onboarding Guide**: first-time user flow | 3.7 | 1.0h | OnboardingGuide.jsx |
| 6.5 | **Message virtualization**: @tanstack/react-virtual in ChatArea | 3.7 | 1.0h | ChatArea.jsx, package.json |
| 6.6 | **Loading/skeleton states**: all async operations | 3.7 | 1.0h | globals.css, ChatArea, MetricsPanel, SettingsPanel |
| 6.7 | **Empty states**: all panels | 3.7 | 0.5h | Multiple files |
| 6.8 | **Theme transition animation**: smooth color transitions | 1.4 | 0.2h | globals.css |
| 6.9 | **Responsive font scaling**: clamp() values | 1.4 | 0.2h | globals.css |

### Phase 7: Accessibility (3-5 hours)

| # | Task | Depends On | Effort | File(s) |
|---|---|---|---|---|
| 7.1 | Add `aria-label` to all icon-only buttons | 5.1 | 0.3h | Header, ChatInput, ModeSelector |
| 7.2 | Add `role="tablist"`, `role="tab"`, `aria-selected` to RightPanelShell | 3.7 | 0.2h | RightPanelShell.jsx |
| 7.3 | Add `ScreenReaderAnnouncer` component with aria-live regions | 1.8 | 0.3h | ScreenReaderAnnouncer.jsx, layout.js |
| 7.4 | Add skip-to-content link in layout | 3.7 | 0.2h | layout.js |
| 7.5 | Implement full keyboard navigation map (§5.2) | 2.5 | 0.5h | Multiple files |
| 7.6 | Focus trap for CommandPalette, modals, mobile drawers | 1.7, 6.2 | 0.5h | CommandPalette.jsx, AppShell.jsx |
| 7.7 | Run axe DevTools audit, fix all violations | 7.1-7.6 | 1.0h | — |
| 7.8 | Test with VoiceOver/NVDA screen reader | 7.7 | 1.0h | — |
| 7.9 | Verify reduced-motion support works for all animations | 4.0 | 0.3h | globals.css |

### Phase 8: Testing & QA (2-3 hours)

| # | Task | Depends On | Effort | File(s) |
|---|---|---|---|---|
| 8.1 | Manual test: all 5 breakpoints on Chrome DevTools responsive mode | 6.9 | 0.5h | — |
| 8.2 | Manual test: dark/light theme toggle with transition | 6.8 | 0.3h | — |
| 8.3 | Manual test: session CRUD (create, switch, delete, rename) | 5.4 | 0.3h | — |
| 8.4 | Manual test: full agent run (chat → plan → approve → execute → complete) | 3.7 | 0.5h | — |
| 8.5 | Manual test: TTS streaming, STT input, keyboard shortcuts | 5.3, 6.2 | 0.3h | — |
| 8.6 | Manual test: error states (disconnect WS, fail config fetch) | 6.1, 6.6 | 0.3h | — |
| 8.7 | `npm run build` — verify no errors, no warnings | All | 0.2h | — |

---

## Summary: Total Estimated Effort

| Phase | Description | Hours |
|---|---|---|
| 1 | Foundation (DOMPurify, CSS fix, reducer, provider) | 4–6 |
| 2 | Core Hooks (WebSocket, sessions, TTS, STT, shortcuts) | 5–7 |
| 3 | page.js Decomposition | 3–5 |
| 4 | Component Splitting | 3–5 |
| 5 | Component Enhancements | 4–6 |
| 6 | UI/UX Polish | 4–6 |
| 7 | Accessibility | 3–5 |
| 8 | Testing & QA | 2–3 |

**Grand total: 28–43 hours** (1–2 weeks for a single developer)
