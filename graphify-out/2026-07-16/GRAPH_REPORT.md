# Graph Report - LLM-OS-AGENT  (2026-07-16)

## Corpus Check
- 163 files · ~98,670 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1270 nodes · 1695 edges · 154 communities (82 shown, 72 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 127 edges (avg confidence: 0.54)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `cb6e4d45`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

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
- @base-ui/react
- Auth Middleware & WS Auth
- Dashboard Proxy Server
- Environment Validation
- Models & TTS Routes
- Agent Tab & Metric Cards
- Harness Event Normalizer
- Notifications Router
- Health Router
- Lightpanda MCP Config
- SubagentTracker
- Request ID Middleware
- Devices Router
- Lightpanda Test
- Aegis Notify Script
- ESLint Config
- Next.js Config
- index.js
- PostCSS Config
- File Icon Asset
- Globe Icon Asset
- Next.js Logo Asset
- Vercel Logo Asset
- Window Icon Asset
- HeadlessSocket
- ProfilesView.tsx
- claude-fable-5.md
- About Orbit (platform self-knowledge)
- OpenCodeHarness
- prompts.js
- page.tsx
- AppShell.tsx
- Orbit
- 2. Dashboard WS protocol
- channels.js
- button.tsx
- package.json
- MissionView.tsx
- index.js
- crypto-store.js
- fleet-mcp.js
- policy-engine.js
- skills.js
- index.js
- profiles.js
- applyPlanTool
- tool-catalog.js
- PreviewTab.tsx
- FleetView.tsx
- PoliciesView.tsx
- How you operate (Orbit operating manual)
- DetailPanel.tsx
- ConnectorsView.tsx
- lightpanda.js
- TraceTab.tsx
- LibraryView.tsx
- index.js
- index.js
- index.js
- IconRail.tsx
- standard.md
- edit-mode.md
- plan-mode.md
- yolo-mode.md
- connectors.js
- fleet.js
- harness.js
- channel-scheduler.js
- subagentFields
- generateIntelligentSpeech
- graphify.md
- graphify.md
- env.js
- AGENTS.md
- next
- tailwind-merge
- restart-orbit.sh
- SKILL.md
- SKILL.md
- SKILL.md
- AegisAgent Console Redesign Mock
- Evenhandedness
- Forbidden Memory Phrases
- Knowledge Cutoff
- MCP App Suggestions
- Memory System
- Claude Fable 5
- Past Chats Tools
- Persistent Storage for Artifacts
- Preferences Info
- Product Information
- Refusal Handling
- Tone and Formatting
- Text-to-Speech Directives (Fable)
- User Wellbeing
- Ask Before Destructive Actions Directive
- Ask Before Writing Directive
- Edit Mode
- Read Freely Directive
- No Surprises Directive
- Plan First Directive
- Plan Mode
- AegisOS-Agent
- Be Concise Directive
- Immediate Execution Directive
- No Bullet Point Spiraling Directive
- Proactive Notifications (aegis-notify)
- Security Restrictions Directive
- Standard Mode
- Text-to-Speech Directives
- Full Autonomy Directive
- Immediate Execution Directive (YOLO)
- YOLO Mode
- AegisAgent (product overview)
- agent-backend (Node/Express + Security Guard)
- Claude Fable 5 prompt option
- Dashboard (Next.js 16 + React 19 + Tailwind 4)
- Lightpanda headless browser
- MCP (Model Context Protocol)
- mcp-server-lightpanda
- Dynamic Security Guard (HITL)
- Voice I/O (STT + TTS)

## God Nodes (most connected - your core abstractions)
1. `{ DatabaseSync }` - 34 edges
2. `cn()` - 31 edges
3. `createHarnessEventEmitter()` - 30 edges
4. `SessionMetricsManager` - 28 edges
5. `SubagentTracker` - 26 edges
6. `useOrbitState()` - 20 edges
7. `PiCodeHarness` - 17 edges
8. `handleStartTask()` - 17 edges
9. `compilerOptions` - 16 edges
10. `estimateTokens()` - 13 edges

## Surprising Connections (you probably didn't know these)
- `testFileSystem()` --calls--> `validatePath()`  [EXTRACTED]
  tests/test_security_guard.js → agent-backend/security-guard.js
- `testSubagentInheritance()` --calls--> `validatePath()`  [EXTRACTED]
  tests/test_security_guard.js → agent-backend/security-guard.js
- `Lightpanda No-Screenshot Placeholder Image` --conceptually_related_to--> `Chat Conversation Panel`  [INFERRED]
  tests/example.png → {6FD2CFF3-36BE-4CC5-993D-F0C89E0D586F}.png
- `createFleet()` --indirect_call--> `listDevices()`  [INFERRED]
  agent-backend/fleet.js → agent-backend/db.js
- `testCommands()` --calls--> `validateCommand()`  [EXTRACTED]
  tests/test_security_guard.js → agent-backend/security-guard.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **AegisOS-Agent Behavioral Mode Variants** — prompts_standard_standard_mode, prompts_edit_mode_edit_mode, prompts_plan_mode_plan_mode, prompts_yolo_mode_yolo_mode [INFERRED 0.95]
- **Shared TTS + Notification + Security Framework** — prompts_standard_tts_directives, prompts_standard_proactive_notifications, prompts_standard_security_restrictions [INFERRED 0.85]
- **Fable-5 Memory and Personalization Subsystem** — prompts_claude_fable_5_memory_system, prompts_claude_fable_5_forbidden_memory_phrases, prompts_claude_fable_5_past_chats_tools, prompts_claude_fable_5_preferences_info [INFERRED 0.85]
- **Next.js Starter Assets** — dashboard_public_file_file_document_icon, dashboard_public_globe_globe_icon, dashboard_public_next_next_logo, dashboard_public_vercel_vercel_logo, dashboard_public_window_window_icon [INFERRED 0.75]

## Communities (154 total, 72 thin omitted)

### Community 0 - "Dashboard Components & Settings Panel"
Cohesion: 0.06
Nodes (34): ComponentErrorBoundary, ErrorBoundary, ErrorBoundaryState, PairDevice(), AGENT_MODES, Badge(), badgeVariants, Button() (+26 more)

### Community 1 - "App Shell & Layout"
Cohesion: 0.20
Nodes (15): DashboardInner(), useDebounce(), EMPTY_METRICS, normalizeMetricsForUI(), useSessions(), DEFAULT_SETTINGS, useSettings(), useSTT() (+7 more)

### Community 2 - "Product Plans & Design Docs"
Cohesion: 0.50
Nodes (3): Deploy on Vercel, Getting Started, Learn More

### Community 3 - "Express Server & Routers"
Cohesion: 0.03
Nodes (69): startScheduler(), ACTIVE_SA, activeSessions, app, authMiddleware, { buildCapabilities }, channelsRouter, { connectionsRouter, oauthRouter } (+61 more)

### Community 4 - "Subagent Tracker & Harness Events"
Cohesion: 0.19
Nodes (11): broadcastNotification(), getCapabilities(), getConfig(), handleStartTask(), persistPlanFiles(), runProfileHeadless(), serializePlanToMarkdown(), getActiveSessionId() (+3 more)

### Community 5 - "Backend Dependencies"
Cohesion: 0.06
Nodes (35): concurrently, dotenv, express, openai, author, dependencies, dotenv, express (+27 more)

### Community 6 - "Metrics & Cost Tracking"
Cohesion: 0.07
Nodes (14): computeCost(), createEmptyMetrics(), DEFAULT_RATES, estimateCost(), estimateTokens(), estimateTokensFromLines(), metricsManager, migrateLegacyMetrics() (+6 more)

### Community 8 - "Database & Device Pairing"
Cohesion: 0.07
Nodes (52): clearSessionRunning(), countProfiles(), createDevice(), createPairingCode(), crypto, { DatabaseSync }, db, dbPath (+44 more)

### Community 9 - "TypeScript Config"
Cohesion: 0.06
Nodes (31): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+23 more)

### Community 10 - "Frontend Dependencies"
Cohesion: 0.12
Nodes (17): @base-ui/react, clsx, dependencies, @base-ui/react, clsx, http-proxy, lucide-react, marked (+9 more)

### Community 11 - "Chat UI & Mode Selectors"
Cohesion: 0.05
Nodes (23): EFFORTS, EffortSelectorProps, Harness, HarnessSelectorProps, MODE_META, ModeBadge(), ModePrompt(), MODES (+15 more)

### Community 12 - "Frontend Build Config"
Cohesion: 0.15
Nodes (13): devDependencies, eslint, eslint-config-next, tailwindcss, @tailwindcss/postcss, @types/node, @types/react, eslint (+5 more)

### Community 13 - "shadcn Component Registry"
Cohesion: 0.09
Nodes (21): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+13 more)

### Community 15 - "Lightpanda MCP Client"
Cohesion: 0.14
Nodes (7): { Client }, LightpandaMcpClient, path, { StdioClientTransport }, assert, LightpandaMcpClient, testMcpClient()

### Community 16 - "Security Guard (Path/Command)"
Cohesion: 0.20
Nodes (13): isReadOnlyCommand(), isUnderDirectory(), path, READ_ONLY_COMMANDS, validateCommand(), validatePath(), assert, mockConfig (+5 more)

### Community 17 - "Dashboard Screenshot & UI Elements"
Cohesion: 0.18
Nodes (11): AegisAgent Console Dashboard Screenshot, Action Feed (Tool Activity), Chat Composer Input (Send, Voice, Prompt Mode), Chat Conversation Panel, Dark Theme UI Design, Lightpanda Headless Browser, Paired Devices Indicator, Right Panel Tabs (Agent, Workspace, Plan, Logs, Settings) (+3 more)

### Community 18 - "Config Load/Save"
Cohesion: 0.08
Nodes (35): CONFIG_PATH, ensureConfig(), ensureUiConfig(), EXAMPLE_PATH, fs, loadConfig(), loadUiConfig(), path (+27 more)

### Community 19 - "PiCode Harness"
Cohesion: 0.07
Nodes (29): 1. Authentication & CORS, 1. Message Stream, 1. Start Task, 2. Cancel Task, 2. REST API Endpoints, 2. Tool Start, 3. Resume Task, 3. Tool End (+21 more)

### Community 20 - "Workspace Router"
Cohesion: 0.50
Nodes (3): loadHarness(), OpenCodeHarness, PiCodeHarness

### Community 21 - "React Error Boundaries"
Cohesion: 0.13
Nodes (20): buildCapabilities(), cap(), fs, hasNativeSearch(), os, path, providers, resolveTtsKey() (+12 more)

### Community 22 - "Lightpanda MCP Server Package"
Cohesion: 0.20
Nodes (9): dependencies, @modelcontextprotocol/sdk, puppeteer-core, description, @modelcontextprotocol/sdk, puppeteer-core, main, name (+1 more)

### Community 23 - "Dashboard Entry & Theme"
Cohesion: 0.28
Nodes (5): ClientDashboard(), Dashboard, metadata, plusJakartaSans, ThemeScript()

### Community 24 - "Lightpanda MCP Server"
Cohesion: 0.22
Nodes (6): {
  CallToolRequestSchema,
  ListToolsRequestSchema,
}, fs, path, puppeteer, { Server }, { StdioServerTransport }

### Community 25 - "@base-ui/react"
Cohesion: 0.18
Nodes (12): ConsoleTab(), Entry, ExplorerSidebar(), ExplorerSidebarProps, FileNode, WorkspaceTab(), initialState, OrbitDispatchContext (+4 more)

### Community 26 - "Auth Middleware & WS Auth"
Cohesion: 0.39
Nodes (6): checkApiKey(), createAuthMiddleware(), getSharedApiKey(), createWebSocketServer(), { getSharedApiKey }, WebSocket

### Community 27 - "Dashboard Proxy Server"
Cohesion: 0.25
Nodes (7): app, { createServer }, handle, httpProxy, next, { parse }, proxy

### Community 28 - "Environment Validation"
Cohesion: 0.24
Nodes (10): { discoverPiBinaries }, EventEmitter, main(), os, parseArgs(), path, PiCodeHarness, redeemCode() (+2 more)

### Community 29 - "Models & TTS Routes"
Cohesion: 0.27
Nodes (8): createModelsRouter(), createTtsRouter(), createVoicesRouter(), DEFAULT_MODELS, { OpenAI }, { Readable }, resolveTtsKey(), { Router }

### Community 31 - "Harness Event Normalizer"
Cohesion: 0.70
Nodes (4): normalizeClaudeCodeEvent(), normalizeEvent(), normalizeOpenCodeEvent(), normalizePiCodeEvent()

### Community 34 - "Lightpanda MCP Config"
Cohesion: 0.42
Nodes (8): LIGHTPANDA_WS, ORBIT_API, node, lightpanda, orbit-fleet, orbit-notify, orbit-search, orbit-transcript

### Community 35 - "SubagentTracker"
Cohesion: 0.14
Nodes (4): createHarnessEventEmitter(), isFleetDispatchTool(), isUnproductiveResult(), SubagentTracker

### Community 37 - "Devices Router"
Cohesion: 0.40
Nodes (3): fs, path, { Router }

### Community 39 - "Aegis Notify Script"
Cohesion: 0.18
Nodes (9): { Client }, fs, MCP_CONFIG_PATH, McpRegistry, path, readConfig(), { StdioClientTransport }, { StreamableHTTPClientTransport } (+1 more)

### Community 43 - "index.js"
Cohesion: 0.16
Nodes (13): EventEmitter, fs, HarnessInterface, os, path, { spawn }, { stripTuiChars, isMutatingTool, isReadOnlyTool, isConversationalPrompt }, WEB_BROWSE_FALLBACK_TOOLS (+5 more)

### Community 51 - "HeadlessSocket"
Cohesion: 0.15
Nodes (5): createFleet(), HeadlessSocket, MODE_RANK, RANK_MODE, HeadlessSocket

### Community 52 - "ProfilesView.tsx"
Cohesion: 0.14
Nodes (7): Channel, EMPTY, EFFORTS, EMPTY, MODES, Profile, SANDBOXES

### Community 53 - "claude-fable-5.md"
Cohesion: 0.15
Nodes (12): After search, Connector directory first, Data Scope, Error Handling, Key Design Pattern, Limitations, Storage API, [third_party_mcp_app] tools need opt-in (+4 more)

### Community 54 - "About Orbit (platform self-knowledge)"
Cohesion: 0.15
Nodes (12): About Orbit (platform self-knowledge), Capability × mode policy (enforced by the backend, not advisory), Channels & connectivity, Connectors & skills, Fleet — delegate to other devices, Guiding the user, Messaging the user & alerts — use the notify tools, never bash, Permission modes (the user picks one per turn; shown as a composer chip) (+4 more)

### Community 55 - "OpenCodeHarness"
Cohesion: 0.24
Nodes (10): createWorkspaceRouter(), escapeHtml(), { exec }, fs, { marked }, path, resolvePath(), rootFor() (+2 more)

### Community 56 - "prompts.js"
Cohesion: 0.27
Nodes (11): createPromptsRouter(), descriptionOf(), fs, listPrompts(), MODE_FILES, path, PROMPTS_DIR, PROTECTED (+3 more)

### Community 57 - "page.tsx"
Cohesion: 0.26
Nodes (3): installApiAuthFetch(), getActiveCredential(), getDeviceToken()

### Community 58 - "AppShell.tsx"
Cohesion: 0.22
Nodes (4): AppShell(), STATUS_META, breakpoints, useResponsive()

### Community 59 - "Orbit"
Cohesion: 0.18
Nodes (10): Branching, Configuration, Features, Orbit, Orbit as a Headless Backend, Prerequisites, Project layout, Quickstart (+2 more)

### Community 60 - "2. Dashboard WS protocol"
Cohesion: 0.20
Nodes (9): 1. Harness protocol, 2. Dashboard WS protocol, Backend → client, Backend → harness (stdin), Client → backend, Harness → backend (stdout, one JSON per line), Metrics semantics, Orbit Wire Protocol (+1 more)

### Community 61 - "channels.js"
Cohesion: 0.33
Nodes (9): createChannelsRouter(), crypto, publicView(), renderTemplate(), { Router }, sanitize(), VALID_TYPE, VALID_VERIFY (+1 more)

### Community 62 - "button.tsx"
Cohesion: 0.18
Nodes (7): ContainerHarness, { execSync }, os, path, PI_CONFIG_DIR, PI_RUNTIME_DIR, PiCodeHarness

### Community 63 - "package.json"
Cohesion: 0.20
Nodes (9): name, private, scripts, build, dev, lint, start, typecheck (+1 more)

### Community 64 - "MissionView.tsx"
Cohesion: 0.20
Nodes (5): LANE, Plan, PlanStep, STATUS_COLOR, StepStatus

### Community 65 - "index.js"
Cohesion: 0.27
Nodes (8): ANDROID_CLIENT, {
  CallToolRequestSchema,
  ListToolsRequestSchema,
}, decodeEntities(), fetchYouTubeTranscript(), parseTimedText(), parseVideoId(), { Server }, { StdioServerTransport }

### Community 66 - "crypto-store.js"
Cohesion: 0.22
Nodes (7): crypto, decrypt(), encrypt(), fs, KEY, KEY_FILE, path

### Community 67 - "fleet-mcp.js"
Cohesion: 0.33
Nodes (3): {
  CallToolRequestSchema,
  ListToolsRequestSchema,
}, { Server }, { StdioServerTransport }

### Community 68 - "policy-engine.js"
Cohesion: 0.28
Nodes (7): byRank(), CAPABILITIES, DEFAULT_MATRIX, evaluate(), MODES, RANK, resolveMatrix()

### Community 69 - "skills.js"
Cohesion: 0.33
Nodes (8): createSkillsRouter(), fs, listSkills(), parseSkill(), path, resolveSkills(), { Router }, SKILLS_DIR

### Community 70 - "index.js"
Cohesion: 0.31
Nodes (7): {
  CallToolRequestSchema,
  ListToolsRequestSchema,
}, decodeEntities(), searchDuckDuckGo(), { Server }, { StdioServerTransport }, unwrapDdg(), webSearch()

### Community 71 - "profiles.js"
Cohesion: 0.39
Nodes (7): createProfilesRouter(), DEFAULT_PROFILES, { Router }, sanitize(), VALID_EFFORT, VALID_MODES, VALID_SANDBOX

### Community 72 - "applyPlanTool"
Cohesion: 0.25
Nodes (8): bucketToPayload(), loadPlanBucket(), normalizePlanSteps(), parseMarkdownPlan(), PLAN_STATUSES, sanitizePlanDeps(), syncPlansFromWorkspace(), withReady()

### Community 73 - "tool-catalog.js"
Cohesion: 0.29
Nodes (6): catalog, CATALOG_PATH, fs, path, persist(), recordObserved()

### Community 74 - "PreviewTab.tsx"
Cohesion: 0.29
Nodes (6): dompurify, IMG_EXT, Mode, OpenFile, PreviewTab(), dompurify

### Community 75 - "FleetView.tsx"
Cohesion: 0.36
Nodes (4): SettingsPanel(), FleetView(), SCOPES, useDevices()

### Community 76 - "PoliciesView.tsx"
Cohesion: 0.29
Nodes (6): CAPABILITIES, CYCLE, DEFAULT_MATRIX, MODES, PoliciesView(), PolicyValue

### Community 77 - "How you operate (Orbit operating manual)"
Cohesion: 0.25
Nodes (7): File management, Formatting, How you operate (Orbit operating manual), Implementation basics, Planning, Rules, Tracking

### Community 78 - "DetailPanel.tsx"
Cohesion: 0.29
Nodes (6): react, DetailPanel(), DetailPanelProps, InspectorTab, TABS, react

### Community 80 - "lightpanda.js"
Cohesion: 0.67
Nodes (5): containerState(), docker(), dockerAvailable(), ensureLightpandaRunning(), { execFile }

### Community 81 - "TraceTab.tsx"
Cohesion: 0.40
Nodes (4): ACTIVE(), LANE_COLORS, TraceAgent, TraceTab()

### Community 82 - "LibraryView.tsx"
Cohesion: 0.47
Nodes (5): estTokens(), fmt(), Item, LibraryView(), Tab

### Community 83 - "index.js"
Cohesion: 0.50
Nodes (4): stripTuiChars(), generatePlan(), { OpenAI }, { stripTuiChars }

### Community 84 - "index.js"
Cohesion: 0.33
Nodes (3): {
  CallToolRequestSchema,
  ListToolsRequestSchema,
}, { Server }, { StdioServerTransport }

### Community 85 - "index.js"
Cohesion: 0.29
Nodes (9): extractPathsFromArgs(), isPathAllowed(), isPathBlocked(), isPathInZones(), isUnder(), os, path, PROJECT_ROOT (+1 more)

### Community 86 - "IconRail.tsx"
Cohesion: 0.40
Nodes (3): IconRailProps, RailView, VIEWS

### Community 87 - "standard.md"
Cohesion: 0.40
Nodes (4): Core Directives:, Proactive Notifications & Messaging:, Text-to-Speech (TTS) Directives:, Web Browsing — prefer the Lightpanda MCP browser:

### Community 89 - "edit-mode.md"
Cohesion: 0.50
Nodes (3): Core Directives:, Proactive Notifications:, Text-to-Speech (TTS) Directives:

### Community 90 - "plan-mode.md"
Cohesion: 0.50
Nodes (3): Core Directives:, Proactive Notifications:, Text-to-Speech (TTS) Directives:

### Community 91 - "yolo-mode.md"
Cohesion: 0.50
Nodes (3): Core Directives:, Proactive Notifications:, Text-to-Speech (TTS) Directives:

### Community 95 - "channel-scheduler.js"
Cohesion: 0.06
Nodes (10): HarnessInterface, fs, HarnessInterface, OPENCODE_TOOLS, OpenCodeHarness, path, { spawn }, workspacePaths (+2 more)

### Community 102 - "env.js"
Cohesion: 0.33
Nodes (5): fs, os, RECOMMENDED_VARS, REQUIRED_VARS, validateEnv()

## Knowledge Gaps
- **553 isolated node(s):** `LIGHTPANDA_WS`, `os`, `path`, `WebSocket`, `EventEmitter` (+548 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **72 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `SubagentTracker` connect `SubagentTracker` to `Express Server & Routers`, `Subagent Tracker & Harness Events`, `Metrics & Cost Tracking`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Why does `PiCodeHarness` connect `Harness Core & Plan Generator` to `index.js`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Why does `dependencies` connect `Frontend Dependencies` to `subagentFields`, `next`, `tailwind-merge`, `PreviewTab.tsx`, `DetailPanel.tsx`, `package.json`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **What connects `LIGHTPANDA_WS`, `os`, `path` to the rest of the system?**
  _555 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Dashboard Components & Settings Panel` be split into smaller, more focused modules?**
  _Cohesion score 0.0597567424643046 - nodes in this community are weakly interconnected._
- **Should `Express Server & Routers` be split into smaller, more focused modules?**
  _Cohesion score 0.02774774774774775 - nodes in this community are weakly interconnected._
- **Should `Backend Dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.05555555555555555 - nodes in this community are weakly interconnected._