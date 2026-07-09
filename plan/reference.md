# Reference — Code Locations & External Resources

## Code References (Current Codebase)

### Backend — `agent-backend/server.js`

| Line(s) | What | Notes |
|---------|------|-------|
| 1-20 | Imports & setup | Express, WS, OpenAI, fs, path, child_process |
| 23-51 | `generateIntelligentSpeech()` | LLM-based TTS summary generation |
| 62 | `activeSessions` Map | Tracks running agent processes |
| 96-127 | Session CRUD API routes | `GET/POST/DELETE /api/sessions` |
| 170-210 | `POST /api/tts` | TTS proxy to local pocket-tts service |
| 220-238 | WebSocket upgrade logic | `/api/ws` path |
| 241-300 | `spawnAgentSession()` | Spawns pi agent process, handles stdout |
| 272-280 | **`text_delta` handler** 🔥 | Where streaming text arrives — **key location for streaming TTS** |
| 279 | `ws.send({ type: "message", ... })` | Streams text to frontend |
| 291-305 | **`agent_end` handler** 🔥 | **Where TTS currently fires** — needs to emit sentences earlier |
| 312-388 | `sendPromptToAgent()` | Sends user prompt to agent, handles orchestration |
| 400+ | WebSocket connection handler | Message routing, tool calls |

### Frontend — `dashboard/src/app/page.js`

| Line(s) | What | Notes |
|---------|------|-------|
| 1-30 | Imports | React, icons, components, marked |
| 32 | `Dashboard()` component | The entire UI (~2100 lines) |
| ~140-180 | `getToolSummary()` / `getToolOutput()` | Tool display helpers |
| ~230-250 | State declarations | sessions, messages, logs, metrics, etc. |
| ~280-330 | Session loading from SQLite + localStorage | `useEffect` on mount |
| ~340-370 | `updateCurrentSession()` | Fire-and-forget save to backend |
| ~390-420 | `handleCreateNewSession()` | New session creation |
| ~440-490 | `handleSwitchSession()` / `handleDeleteSession()` | Session management |
| ~520-560 | WebSocket connection + fetch configs | `useEffect` on mount |
| ~590-750 | **WebSocket `onmessage` handler** 🔥 | Routes all WS events |
| ~590-610 | `case "status"` | Status updates |
| ~615-660 | `case "message"` | **Streaming text updates** — where `handleStreamingSpeech` should be called |
| ~665-710 | `case "tool_start"` / `case "tool_end"` | Tool execution tracking |
| ~715-720 | `case "intelligent_speech"` | **Current TTS trigger** — fires after agent_end |
| ~730 | `case "speech"` | Commented out as duplicate |
| ~735-800 | `case "log"` / `case "plan"` | Log & plan handling |
| ~830-920 | **`speakText()` function** 🔥 | Main TTS playback — generates audio per sentence |
| ~925-990 | **`handleStreamingSpeech()`** 🔥 | **Unused streaming TTS code** — detects completed sentences |
| ~995-1030 | `queueSentenceTTS()` | Queues sentence for parallel TTS fetch |
| ~1035-1065 | `playStreamingTTSQueue()` | Plays queued TTS in order |
| ~1100-1170 | `handleSubmitPrompt()` | Submit handler, resets TTS state |
| ~1200 | Input area | **Single-line `<Input>`** — needs textarea |
| ~1380-1560 | Settings panel | Redundant with Shadcn controls |

### Frontend — `dashboard/src/components/ui/`

| File | What |
|------|------|
| `button.jsx` | Shadcn Button with variants |
| `input.jsx` | Shadcn Input (single-line) |
| `select.jsx` | Shadcn Select with content/items |
| `switch.jsx` | Shadcn Switch toggle |
| `card.jsx` | Shadcn Card/CardHeader/CardTitle/CardContent |
| `scroll-area.jsx` | Shadcn ScrollArea |

### Backend — `agent-backend/db.js`

| Line(s) | What | Notes |
|---------|------|-------|
| 1-8 | Setup | `node:sqlite` initialization |
| 10-17 | Schema creation | `sessions` table with JSON fields |
| 19-33 | `saveSession()` | UPSERT with JSON serialization |
| 35-47 | `getSession(id)` | Single session fetch with JSON parse |
| 49-61 | `getAllSessions()` | All sessions ordered by timestamp DESC |
| 63-66 | `deleteSession(id)` | Delete by ID |

## External Resources

### UI/Design
- [Shadcn UI Components](https://ui.shadcn.com/) — Based on Radix UI + Tailwind, already used in project
- [Tailwind CSS v4 Docs](https://tailwindcss.com/docs) — CSS framework
- [Lucide Icons](https://lucide.dev/icons/) — Icon library already used
- [Base UI React](https://base-ui.com/) — Underlying primitive components
- [Dribbble: AI Chat Interfaces](https://dribbble.com/search/ai-chat) — Design inspiration
- [Vercel AI SDK Demo](https://sdk.vercel.ai/demo) — Reference for streaming chat UI

### TTS
- [Web Speech API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API) — Browser fallback TTS
- [Web Audio API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API) — AudioContext wakeup pattern
- Pocket TTS — Local service at `http://127.0.0.1:6767`

### Session Storage
- [node:sqlite (Node.js Docs)](https://nodejs.org/api/sqlite.html) — Node 22+ built-in SQLite
- [SQLite FTS5](https://www.sqlite.org/fts5.html) — Full-text search extension
- [IndexedDB (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) — Alternative client-side storage

### Git
- [Git Submodules](https://git-scm.com/book/en/v2/Git-Tools-Submodules) — For fixing the `m dashboard` submodule issue

### Distribution
- [Docker Docs](https://docs.docker.com/) — Containerization
- [Homebrew](https://docs.brew.sh/Formula-Cookbook) — macOS distribution
- [electron-builder](https://www.electron.build/) — Desktop app packaging

## Key Architecture Notes

```
┌─────────────────────────────────────────────────┐
│                   Browser                         │
│  ┌───────────────────────────────────────────┐   │
│  │  Next.js Dashboard (port 6801)             │   │
│  │  - page.js (monolith ~2200 lines)          │   │
│  │  - components/ui/* (Shadcn)                │   │
│  └───────────────┬───────────────────────────┘   │
│                  │ WebSocket (/api/ws)           │
│                  │ REST API (/api/*)             │
├──────────────────┼───────────────────────────────┤
│  ┌───────────────▼───────────────────────────┐   │
│  │  Express Backend (port 6800)               │   │
│  │  - server.js (WebSocket + REST)            │   │
│  │  - db.js (SQLite sessions)                 │   │
│  │  - security-guard.js (path/cmd validation) │   │
│  │  - mcp-client.js (Lightpanda browser)      │   │
│  └───────────────┬───────────────────────────┘   │
│                  │ stdin/stdout (RPC)             │
│  ┌───────────────▼───────────────────────────┐   │
│  │  Pi Agent Process (spawned per session)    │   │
│  │  - LLM interaction (LiteLLM)               │   │
│  │  - Tool execution (bash, read, write, etc) │   │
│  └───────────────────────────────────────────┘   │
│                                                  │
│  ┌───────────────────────────────────────────┐   │
│  │  Local Services                             │   │
│  │  - LiteLLM Proxy (port 5000)               │   │
│  │  - Pocket TTS (port 6767)                  │   │
│  │  - Lightpanda Browser (MCP)                │   │
│  └───────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```
