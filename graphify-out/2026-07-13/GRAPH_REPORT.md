# Graph Report - .  (2026-07-10)

## Corpus Check
- 132 files · ~58,347 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 725 nodes · 1032 edges · 51 communities (32 shown, 19 thin omitted)
- Extraction: 92% EXTRACTED · 8% INFERRED · 0% AMBIGUOUS · INFERRED: 87 edges (avg confidence: 0.63)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Dashboard Components & Settings Panel
- App Shell & Layout
- Product Plans & Design Docs
- Express Server & Routers
- Subagent Tracker & Harness Events
- Backend Dependencies
- Metrics & Cost Tracking
- Claude Fable 5 System Prompt
- Database & Device Pairing
- TypeScript Config
- Frontend Dependencies
- Chat UI & Mode Selectors
- Frontend Build Config
- shadcn Component Registry
- Harness Core & Plan Generator
- Lightpanda MCP Client
- Security Guard (Path/Command)
- Dashboard Screenshot & UI Elements
- Config Load/Save
- PiCode Harness
- Workspace Router
- React Error Boundaries
- Lightpanda MCP Server Package
- Dashboard Entry & Theme
- Lightpanda MCP Server
- Harness Interface Contract
- Auth Middleware & WS Auth
- Dashboard Proxy Server
- Environment Validation
- Models & TTS Routes
- Agent Tab & Metric Cards
- Harness Event Normalizer
- Notifications Router
- Health Router
- Lightpanda MCP Config
- Harness Loader
- Request ID Middleware
- Devices Router
- Lightpanda Test
- Aegis Notify Script
- ESLint Config
- Next.js Config
- Next Env Types
- PostCSS Config
- File Icon Asset
- Globe Icon Asset
- Next.js Logo Asset
- Vercel Logo Asset
- Window Icon Asset

## God Nodes (most connected - your core abstractions)
1. `cn()` - 34 edges
2. `SubagentTracker` - 23 edges
3. `SessionMetricsManager` - 22 edges
4. `createHarnessEventEmitter()` - 21 edges
5. `{ DatabaseSync }` - 16 edges
6. `compilerOptions` - 16 edges
7. `estimateTokens()` - 13 edges
8. `DashboardInner()` - 12 edges
9. `handleStartTask()` - 11 edges
10. `useAegisDispatch()` - 11 edges

## Surprising Connections (you probably didn't know these)
- `Dynamic Security Guard (HITL)` --semantically_similar_to--> `Policy engine v2 (capability x mode matrix)`  [INFERRED] [semantically similar]
  README.md → plan/REDESIGN-PLAN.md
- `AegisAgent (product overview)` --semantically_similar_to--> `Local-first agent-operations console`  [INFERRED] [semantically similar]
  README.md → plan/REDESIGN-PLAN.md
- `Voice I/O (STT + TTS)` --semantically_similar_to--> `TTS / voice (first-class I/O)`  [INFERRED] [semantically similar]
  README.md → plan/REDESIGN-PLAN.md
- `Dashboard README (create-next-app boilerplate)` --conceptually_related_to--> `Dashboard (Next.js 16 + React 19 + Tailwind 4)`  [INFERRED]
  dashboard/README.md → README.md
- `Dashboard (Next.js 16 + React 19 + Tailwind 4)` --conceptually_related_to--> `Next.js agent rules (AGENTS.md)`  [INFERRED]
  README.md → dashboard/AGENTS.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **AegisAgent redesign document set (what/why, how, approved look)** — plan_redesign_plan, plan_implementation_plan, plan_aegis_console_mock [EXTRACTED 0.90]
- **One OTP pairing flow for devices and harnesses** — plan_redesign_plan_fleet, plan_redesign_plan_otp_pairing, plan_redesign_plan_device, plan_redesign_plan_harness, plan_redesign_plan_adapter_protocol [EXTRACTED 0.85]
- **Console = timeline (⇄ mission) + inspector + composer** — plan_redesign_plan_console, plan_redesign_plan_unified_timeline, plan_redesign_plan_mission_view, plan_redesign_plan_inspector, plan_redesign_plan_composer [EXTRACTED 0.85]
- **AegisOS-Agent Behavioral Mode Variants** — prompts_standard_standard_mode, prompts_edit_mode_edit_mode, prompts_plan_mode_plan_mode, prompts_yolo_mode_yolo_mode [INFERRED 0.95]
- **Shared TTS + Notification + Security Framework** — prompts_standard_tts_directives, prompts_standard_proactive_notifications, prompts_standard_security_restrictions [INFERRED 0.85]
- **Fable-5 Memory and Personalization Subsystem** — prompts_claude_fable_5_memory_system, prompts_claude_fable_5_forbidden_memory_phrases, prompts_claude_fable_5_past_chats_tools, prompts_claude_fable_5_preferences_info [INFERRED 0.85]
- **Next.js Starter Assets** — dashboard_public_file_file_document_icon, dashboard_public_globe_globe_icon, dashboard_public_next_next_logo, dashboard_public_vercel_vercel_logo, dashboard_public_window_window_icon [INFERRED 0.75]

## Communities (51 total, 19 thin omitted)

### Community 0 - "Dashboard Components & Settings Panel"
Cohesion: 0.07
Nodes (37): ErrorBoundaryState, PairDevice(), SessionList(), AGENT_MODES, SettingsPanel(), Badge(), badgeVariants, Button() (+29 more)

### Community 1 - "App Shell & Layout"
Cohesion: 0.07
Nodes (30): DashboardInner(), AppShell(), STATUS_META, DetailPanel(), TABS, useDebounce(), breakpoints, useResponsive() (+22 more)

### Community 2 - "Product Plans & Design Docs"
Cohesion: 0.07
Nodes (46): Next.js agent rules (AGENTS.md), dashboard/CLAUDE.md, Dashboard README (create-next-app boilerplate), AegisAgent Console Redesign Mock, AegisAgent Implementation Plan, devices table + pair endpoints (Phase 3), harness_instances registry (Phase 3), metrics.js real-usage wiring (Phase 1) (+38 more)

### Community 3 - "Express Server & Routers"
Cohesion: 0.05
Nodes (39): activeSessions, app, authMiddleware, cors, createAuthMiddleware, createConfigRouter, createDevicesRouter, createHealthRouter (+31 more)

### Community 4 - "Subagent Tracker & Harness Events"
Cohesion: 0.11
Nodes (14): createHarnessEventEmitter(), getConfig(), handleStartTask(), SubagentTracker, extractPathsFromArgs(), getActiveSessionId(), isPathAllowed(), os (+6 more)

### Community 5 - "Backend Dependencies"
Cohesion: 0.06
Nodes (35): concurrently, dotenv, express, openai, author, dependencies, dotenv, express (+27 more)

### Community 6 - "Metrics & Cost Tracking"
Cohesion: 0.09
Nodes (11): createEmptyMetrics(), estimateCost(), estimateTokens(), estimateTokensFromLines(), metricsManager, migrateLegacyMetrics(), MODEL_PRICING_PER_MILLION, { performance } (+3 more)

### Community 7 - "Claude Fable 5 System Prompt"
Cohesion: 0.08
Nodes (33): Critical Child Safety Instructions, Evenhandedness, Forbidden Memory Phrases, Knowledge Cutoff, MCP App Suggestions, Memory System, Claude Fable 5, Past Chats Tools (+25 more)

### Community 8 - "Database & Device Pairing"
Cohesion: 0.12
Nodes (28): createDevice(), createPairingCode(), crypto, { DatabaseSync }, db, dbPath, deleteSession(), enforceTTL() (+20 more)

### Community 9 - "TypeScript Config"
Cohesion: 0.06
Nodes (31): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+23 more)

### Community 10 - "Frontend Dependencies"
Cohesion: 0.07
Nodes (27): @base-ui/react, class-variance-authority, clsx, dependencies, @base-ui/react, class-variance-authority, clsx, dompurify (+19 more)

### Community 11 - "Chat UI & Mode Selectors"
Cohesion: 0.11
Nodes (11): MODE_META, ModeBadge(), ModePrompt(), MODES, ModeSelector(), PROMPT_TYPES, PromptTypeSelector(), ChatEmptyState() (+3 more)

### Community 12 - "Frontend Build Config"
Cohesion: 0.09
Nodes (22): devDependencies, eslint, eslint-config-next, tailwindcss, @tailwindcss/postcss, @types/node, @types/react, name (+14 more)

### Community 13 - "shadcn Component Registry"
Cohesion: 0.09
Nodes (21): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+13 more)

### Community 14 - "Harness Core & Plan Generator"
Cohesion: 0.17
Nodes (13): EventEmitter, fs, HarnessInterface, path, { spawn }, { stripTuiChars, isMutatingTool, isReadOnlyTool, isConversationalPrompt }, isConversationalPrompt(), isMutatingTool() (+5 more)

### Community 15 - "Lightpanda MCP Client"
Cohesion: 0.14
Nodes (7): { Client }, LightpandaMcpClient, path, { StdioClientTransport }, assert, LightpandaMcpClient, testMcpClient()

### Community 16 - "Security Guard (Path/Command)"
Cohesion: 0.21
Nodes (12): isReadOnlyCommand(), isUnderDirectory(), path, READ_ONLY_COMMANDS, validateCommand(), validatePath(), assert, mockConfig (+4 more)

### Community 17 - "Dashboard Screenshot & UI Elements"
Cohesion: 0.18
Nodes (11): AegisAgent Console Dashboard Screenshot, Action Feed (Tool Activity), Chat Composer Input (Send, Voice, Prompt Mode), Chat Conversation Panel, Dark Theme UI Design, Lightpanda Headless Browser, Paired Devices Indicator, Right Panel Tabs (Agent, Workspace, Plan, Logs, Settings) (+3 more)

### Community 18 - "Config Load/Save"
Cohesion: 0.29
Nodes (8): CONFIG_PATH, fs, loadConfig(), path, saveConfig(), createConfigRouter(), { loadConfig, saveConfig }, { Router }

### Community 20 - "Workspace Router"
Cohesion: 0.24
Nodes (9): createWorkspaceRouter(), escapeHtml(), { exec }, fs, { marked }, path, resolvePath(), { Router } (+1 more)

### Community 22 - "Lightpanda MCP Server Package"
Cohesion: 0.20
Nodes (9): dependencies, @modelcontextprotocol/sdk, puppeteer-core, description, @modelcontextprotocol/sdk, puppeteer-core, main, name (+1 more)

### Community 23 - "Dashboard Entry & Theme"
Cohesion: 0.28
Nodes (5): ClientDashboard(), Dashboard, inter, metadata, ThemeScript()

### Community 24 - "Lightpanda MCP Server"
Cohesion: 0.22
Nodes (6): {
  CallToolRequestSchema,
  ListToolsRequestSchema,
}, fs, path, puppeteer, { Server }, { StdioServerTransport }

### Community 26 - "Auth Middleware & WS Auth"
Cohesion: 0.39
Nodes (6): checkApiKey(), createAuthMiddleware(), getSharedApiKey(), createWebSocketServer(), { getSharedApiKey }, WebSocket

### Community 27 - "Dashboard Proxy Server"
Cohesion: 0.25
Nodes (7): app, { createServer }, handle, httpProxy, next, { parse }, proxy

### Community 28 - "Environment Validation"
Cohesion: 0.29
Nodes (6): discoverPiBinaries(), fs, os, RECOMMENDED_VARS, REQUIRED_VARS, validateEnv()

### Community 29 - "Models & TTS Routes"
Cohesion: 0.33
Nodes (5): createModelsRouter(), createTtsRouter(), createVoicesRouter(), { OpenAI }, { Router }

### Community 31 - "Harness Event Normalizer"
Cohesion: 0.70
Nodes (4): normalizeClaudeCodeEvent(), normalizeEvent(), normalizeOpenCodeEvent(), normalizePiCodeEvent()

### Community 32 - "Notifications Router"
Cohesion: 0.40
Nodes (3): { exec }, { Router }, WebSocket

### Community 34 - "Lightpanda MCP Config"
Cohesion: 0.50
Nodes (3): LIGHTPANDA_WS, node, lightpanda

## Knowledge Gaps
- **269 isolated node(s):** `node`, `LIGHTPANDA_WS`, `fs`, `path`, `CONFIG_PATH` (+264 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **19 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `Frontend Dependencies` to `Frontend Build Config`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **Why does `DashboardInner()` connect `App Shell & Layout` to `Frontend Dependencies`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Why does `dompurify` connect `Frontend Dependencies` to `App Shell & Layout`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **What connects `node`, `LIGHTPANDA_WS`, `fs` to the rest of the system?**
  _270 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Dashboard Components & Settings Panel` be split into smaller, more focused modules?**
  _Cohesion score 0.06612021857923497 - nodes in this community are weakly interconnected._
- **Should `App Shell & Layout` be split into smaller, more focused modules?**
  _Cohesion score 0.0711864406779661 - nodes in this community are weakly interconnected._
- **Should `Product Plans & Design Docs` be split into smaller, more focused modules?**
  _Cohesion score 0.07149758454106281 - nodes in this community are weakly interconnected._