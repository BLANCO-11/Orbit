# Graph Report - LLM-OS-AGENT  (2026-07-25)

## Corpus Check
- 211 files · ~175,851 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1993 nodes · 2868 edges · 209 communities (121 shown, 88 thin omitted)
- Extraction: 91% EXTRACTED · 9% INFERRED · 0% AMBIGUOUS · INFERRED: 254 edges (avg confidence: 0.52)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `4f2bf2e7`
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
- class-variance-authority
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
- index.js
- LogViewer.tsx
- NotificationCenter.tsx
- getUser
- package.json
- index.js
- gen-env-example.js
- Getting started
- Secrets & connectors
- index.js
- index.js
- How you operate — Tether operating manual
- mapRow
- askQuestion
- test_db_layer.js
- secretTenant
- Banner.tsx
- modes.ts
- End-to-end examples
- Script generation (run-API contract)
- connectorTenant
- getTemplate
- prompt.js
- ask-mcp.js
- build-mcp.js
- fleet-mcp.js
- notify-mcp.js
- migrate-sqlite-to-pg.js
- Authentication & tenants
- getTenant
- mapUserRow
- run.js
- PromptTypeSelector.tsx
- useTheme
- Integration guide — driving Tether from your app
- stub-mcp-server.js
- getDeviceByToken
- getProfile
- sessions.js
- EffortSelector.tsx
- HarnessSelector.tsx
- ProfileSelector.tsx
- SkillSelector.tsx
- docker-entrypoint.sh
- Tether Documentation
- llm-gateway.js
- MarkdownMessage.tsx
- clsx
- http-proxy
- react-dom
- remark-gfm
- shadcn
- script-gen.md
- restart-tether.sh

## God Nodes (most connected - your core abstractions)
1. `init()` - 84 edges
2. `cn()` - 31 edges
3. `createHarnessEventEmitter()` - 29 edges
4. `SessionMetricsManager` - 28 edges
5. `SubagentTracker` - 26 edges
6. `useTetherState()` - 20 edges
7. `PiCodeHarness` - 18 edges
8. `handleStartTask()` - 17 edges
9. `compilerOptions` - 16 edges
10. `2. REST API Endpoints` - 14 edges

## Surprising Connections (you probably didn't know these)
- `installApiAuthFetch()` --indirect_call--> `init()`  [INFERRED]
  dashboard/src/lib/api-auth.ts → agent-backend/db.js
- `testConnectorIsolation()` --calls--> `encrypt()`  [EXTRACTED]
  tests/test_runtime_api.js → agent-backend/crypto-store.js
- `testSqliteAdapterLive()` --calls--> `createAdapter()`  [EXTRACTED]
  tests/test_db_adapter.js → agent-backend/db/adapter.js
- `testHasPathField()` --calls--> `hasPathField()`  [EXTRACTED]
  tests/test_policy_hardening.js → agent-backend/ws/session-helpers.js
- `testExtractBroadenedFields()` --calls--> `extractPathsFromArgs()`  [EXTRACTED]
  tests/test_policy_hardening.js → agent-backend/ws/session-helpers.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **AegisOS-Agent Behavioral Mode Variants** — prompts_standard_standard_mode, prompts_edit_mode_edit_mode, prompts_plan_mode_plan_mode, prompts_yolo_mode_yolo_mode [INFERRED 0.95]
- **Shared TTS + Notification + Security Framework** — prompts_standard_tts_directives, prompts_standard_proactive_notifications, prompts_standard_security_restrictions [INFERRED 0.85]
- **Fable-5 Memory and Personalization Subsystem** — prompts_claude_fable_5_memory_system, prompts_claude_fable_5_forbidden_memory_phrases, prompts_claude_fable_5_past_chats_tools, prompts_claude_fable_5_preferences_info [INFERRED 0.85]
- **Next.js Starter Assets** — dashboard_public_file_file_document_icon, dashboard_public_globe_globe_icon, dashboard_public_next_next_logo, dashboard_public_vercel_vercel_logo, dashboard_public_window_window_icon [INFERRED 0.75]

## Communities (209 total, 88 thin omitted)

### Community 0 - "Dashboard Components & Settings Panel"
Cohesion: 0.06
Nodes (32): ComponentErrorBoundary, ErrorBoundary, ErrorBoundaryState, AGENT_MODES, Badge(), badgeVariants, Button(), buttonVariants (+24 more)

### Community 1 - "App Shell & Layout"
Cohesion: 0.20
Nodes (15): DashboardInner(), useDebounce(), EMPTY_METRICS, normalizeMetricsForUI(), useSessions(), DEFAULT_SETTINGS, useSettings(), useSTT() (+7 more)

### Community 2 - "Product Plans & Design Docs"
Cohesion: 0.50
Nodes (3): Deploy on Vercel, Getting Started, Learn More

### Community 3 - "Express Server & Routers"
Cohesion: 0.02
Nodes (96): startScheduler(), ACTIVE_SA, activeBuilds, activeRuns, activeSessions, answerRun(), app, ASK_TIMEOUT_MS (+88 more)

### Community 4 - "Subagent Tracker & Harness Events"
Cohesion: 0.13
Nodes (25): extractCommandPaths(), extractPathsFromArgs(), hasPathField(), isPathAllowed(), isPathBlocked(), isPathInZones(), isUnder(), os (+17 more)

### Community 5 - "Backend Dependencies"
Cohesion: 0.04
Nodes (44): concurrently, dotenv, express, jose, openai, author, dependencies, dotenv (+36 more)

### Community 6 - "Metrics & Cost Tracking"
Cohesion: 0.07
Nodes (14): computeCost(), createEmptyMetrics(), DEFAULT_RATES, estimateCost(), estimateTokens(), estimateTokensFromLines(), metricsManager, migrateLegacyMetrics() (+6 more)

### Community 8 - "Database & Device Pairing"
Cohesion: 0.11
Nodes (26): addColumn(), { API_KEY_PREFIX }, { createAdapter }, crypto, ddl(), _doInit(), fs, getApiKey() (+18 more)

### Community 9 - "TypeScript Config"
Cohesion: 0.06
Nodes (31): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+23 more)

### Community 10 - "Frontend Dependencies"
Cohesion: 0.12
Nodes (17): class-variance-authority, clsx, dependencies, class-variance-authority, clsx, dompurify, lucide-react, marked (+9 more)

### Community 11 - "Chat UI & Mode Selectors"
Cohesion: 0.22
Nodes (4): ModeBadge(), NOTE: the full-screen `ModePrompt` mode-picker card was removed in Workstream, ReasoningAccordion(), ReasoningGroup

### Community 12 - "Frontend Build Config"
Cohesion: 0.15
Nodes (13): devDependencies, eslint, eslint-config-next, tailwindcss, @tailwindcss/postcss, @types/node, @types/react, eslint (+5 more)

### Community 13 - "shadcn Component Registry"
Cohesion: 0.09
Nodes (21): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+13 more)

### Community 15 - "Lightpanda MCP Client"
Cohesion: 0.13
Nodes (8): { Client }, env, LightpandaMcpClient, path, { StdioClientTransport }, assert, LightpandaMcpClient, testMcpClient()

### Community 16 - "Security Guard (Path/Command)"
Cohesion: 0.06
Nodes (61): abortSession(), ADAPTERS, AIDER_CREATE, chatCompletion(), CLAUDE_TOOL_MAP, claudeMap(), clip(), CODEX_CREATE (+53 more)

### Community 17 - "Dashboard Screenshot & UI Elements"
Cohesion: 0.18
Nodes (11): AegisAgent Console Dashboard Screenshot, Action Feed (Tool Activity), Chat Composer Input (Send, Voice, Prompt Mode), Chat Conversation Panel, Dark Theme UI Design, Lightpanda Headless Browser, Paired Devices Indicator, Right Panel Tabs (Agent, Workspace, Plan, Logs, Settings) (+3 more)

### Community 18 - "Config Load/Save"
Cohesion: 0.06
Nodes (56): CONFIG_PATH, ensureConfig(), ensureUiConfig(), env, EXAMPLE_PATH, fs, getResolvedConfig(), loadConfig() (+48 more)

### Community 19 - "PiCode Harness"
Cohesion: 0.05
Nodes (43): 1. Authentication, RBAC & CORS, 1. Message Stream, 1. Start Task, 2. Cancel Task, 2. REST API Endpoints, 2. Tool Start, 3. Resume Task, 3. Tool End (+35 more)

### Community 20 - "Workspace Router"
Cohesion: 0.12
Nodes (6): createHarnessEventEmitter(), isUnproductiveResult(), persistSessionMetrics(), shutdown(), generateIntelligentSpeech(), SubagentTracker

### Community 21 - "React Error Boundaries"
Cohesion: 0.12
Nodes (21): buildCapabilities(), cap(), fs, hasNativeSearch(), os, path, providers, resolveTtsKey() (+13 more)

### Community 22 - "Lightpanda MCP Server Package"
Cohesion: 0.09
Nodes (26): clearSessionRunning(), countProfiles(), countUsers(), createRun(), deleteChannel(), deleteConnection(), deleteProfile(), deleteRunsForSession() (+18 more)

### Community 23 - "Dashboard Entry & Theme"
Cohesion: 0.28
Nodes (5): ClientDashboard(), Dashboard, metadata, plusJakartaSans, ThemeScript()

### Community 24 - "Lightpanda MCP Server"
Cohesion: 0.08
Nodes (24): `401 Unauthorized`, `403 Forbidden` on secrets/connectors writes, `404` on a run/session that exists, A run comes back `needs_review`, A run ends `error`, A run ends `timeout`, A tenant connector's stdio `command` isn't found in the container, Air-gapped host (+16 more)

### Community 25 - "@base-ui/react"
Cohesion: 0.09
Nodes (23): 1.1 System context, 1. Architectural overview, 2.1 Responsibilities, 2.2 The harness abstraction, 2. Component model, 3.1 Interactive turn (console), 3.2 Headless run (Run API) — the parent-app path, 3.3 Run lifecycle (state machine) (+15 more)

### Community 26 - "Auth Middleware & WS Auth"
Cohesion: 0.08
Nodes (30): checkApiKey(), createAuthMiddleware(), env, getSharedApiKey(), getSuperadminKey(), requireRole(), resolveIdentity(), roleForDeviceScope() (+22 more)

### Community 27 - "Dashboard Proxy Server"
Cohesion: 0.25
Nodes (7): app, { createServer }, handle, httpProxy, next, { parse }, proxy

### Community 28 - "Environment Validation"
Cohesion: 0.09
Nodes (33): connectSupervised(), credentialsPath(), DEFAULT_HEARTBEAT, DEFAULT_RECONNECT, descriptorFromStored(), { discoverPiBinaries, resolveLlmEnv }, dropCredential(), EventEmitter (+25 more)

### Community 29 - "Models & TTS Routes"
Cohesion: 0.18
Nodes (11): createModelsRouter(), createTtsRouter(), createVoicesRouter(), { OpenAI }, { probeLlm }, { Readable }, resolveTtsKey(), { Router } (+3 more)

### Community 31 - "Harness Event Normalizer"
Cohesion: 0.70
Nodes (4): normalizeClaudeCodeEvent(), normalizeEvent(), normalizeOpenCodeEvent(), normalizePiCodeEvent()

### Community 34 - "Lightpanda MCP Config"
Cohesion: 0.15
Nodes (15): CANONICAL, checkLegacyEnv(), coerce(), describe(), EXTRA_RESERVED, get(), isReserved(), isSet() (+7 more)

### Community 35 - "SubagentTracker"
Cohesion: 0.11
Nodes (16): args, BY_LENGTH, conflicts, dryRun, file, fs, inComments, { LEGACY } (+8 more)

### Community 37 - "Devices Router"
Cohesion: 0.39
Nodes (8): buildDescriptor(), createDevicesRouter(), detectOrigins(), fs, makeRateLimiter(), path, remoteTrustNotice(), { Router }

### Community 39 - "Aegis Notify Script"
Cohesion: 0.18
Nodes (9): { Client }, fs, MCP_CONFIG_PATH, McpRegistry, path, readConfig(), { StdioClientTransport }, { StreamableHTTPClientTransport } (+1 more)

### Community 43 - "index.js"
Cohesion: 0.07
Nodes (34): createWorkspaceRouter(), db, escapeHtml(), { exec }, fs, LANGUAGE_MAP, { marked }, path (+26 more)

### Community 52 - "ProfilesView.tsx"
Cohesion: 0.14
Nodes (7): Channel, EMPTY, EFFORTS, EMPTY, MODES, Profile, SANDBOXES

### Community 53 - "claude-fable-5.md"
Cohesion: 0.15
Nodes (12): After search, Connector directory first, Data Scope, Error Handling, Key Design Pattern, Limitations, Storage API, [third_party_mcp_app] tools need opt-in (+4 more)

### Community 54 - "About Orbit (platform self-knowledge)"
Cohesion: 0.12
Nodes (11): FLEET_DISPATCH_NAMES, isFleetDispatch(), MCP, NOTIFY_MCP_TOOL, NOTIFY_NAMES, NOTE: this leaks into stored data — pi resolves models as `<PROVIDER_ID>/<model>, createFleet(), { FLEET_DISPATCH_NAMES } (+3 more)

### Community 55 - "OpenCodeHarness"
Cohesion: 0.06
Nodes (11): HarnessInterface, fs, HarnessInterface, OPENCODE_TOOLS, OpenCodeHarness, path, { PROVIDER_ID, PROVIDER_NAME }, { spawn } (+3 more)

### Community 56 - "prompts.js"
Cohesion: 0.27
Nodes (11): createPromptsRouter(), descriptionOf(), fs, listPrompts(), MODE_FILES, path, PROMPTS_DIR, PROTECTED (+3 more)

### Community 57 - "page.tsx"
Cohesion: 0.15
Nodes (12): AuthGate(), Dashboard(), LoginPage(), PairDevice(), AuthIdentity, useAuth(), UseAuthResult, installApiAuthFetch() (+4 more)

### Community 58 - "AppShell.tsx"
Cohesion: 0.24
Nodes (5): AppShell(), useResizableWidth(), STATUS_META, breakpoints, useResponsive()

### Community 59 - "Orbit"
Cohesion: 0.11
Nodes (18): Branching, Caddy, Cloudflare, Configuration, Docker, Features, nginx, OpenShift / Kubernetes routes (+10 more)

### Community 60 - "2. Dashboard WS protocol"
Cohesion: 0.20
Nodes (9): 1. Harness protocol, 2. Dashboard WS protocol, Backend → client, Backend → harness (stdin), Client → backend, Harness → backend (stdout, one JSON per line), Metrics semantics, Phase-2 target vocabulary (timeline UI) (+1 more)

### Community 61 - "channels.js"
Cohesion: 0.33
Nodes (9): createChannelsRouter(), crypto, publicView(), renderTemplate(), { Router }, sanitize(), VALID_TYPE, VALID_VERIFY (+1 more)

### Community 62 - "button.tsx"
Cohesion: 0.22
Nodes (8): ChatEmptyState(), ChatMessage, ModeSuggestionCard(), TOOL_ICONS, ToolGroup(), toolIcon(), ToolRow(), getMode()

### Community 63 - "package.json"
Cohesion: 0.20
Nodes (9): name, private, scripts, build, dev, lint, start, typecheck (+1 more)

### Community 64 - "MissionView.tsx"
Cohesion: 0.20
Nodes (5): LANE, Plan, PlanStep, STATUS_COLOR, StepStatus

### Community 65 - "index.js"
Cohesion: 0.19
Nodes (14): createAdapter(), createPgAdapter(), createSqliteAdapter(), env, resolveDriver(), toPgPlaceholders(), assert, fs (+6 more)

### Community 66 - "crypto-store.js"
Cohesion: 0.05
Nodes (40): crypto, decrypt(), encrypt(), env, fs, KEY, KEY_FILE, path (+32 more)

### Community 67 - "fleet-mcp.js"
Cohesion: 0.19
Nodes (10): api(), fmtDate(), KeysTab(), MembersTab(), ObservabilityTab(), ROLES, SCOPES, SsoTab() (+2 more)

### Community 68 - "policy-engine.js"
Cohesion: 0.21
Nodes (12): isReadOnlyTool(), byRank(), CAPABILITIES, DEFAULT_MATRIX, evaluate(), { isReadOnlyTool }, META_TOOLS, MODES (+4 more)

### Community 69 - "skills.js"
Cohesion: 0.33
Nodes (8): createSkillsRouter(), fs, listSkills(), parseSkill(), path, resolveSkills(), { Router }, SKILLS_DIR

### Community 70 - "index.js"
Cohesion: 0.13
Nodes (15): Admin & multi-tenancy *(optional)*, Channels, Connectors, Console, Effort, Fleet (multi-agent), Inspector tabs, Mission board (+7 more)

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
Cohesion: 0.13
Nodes (17): ConsoleTab(), Entry, ExplorerSidebar(), ExplorerSidebarProps, FileNode, IMG_EXT, Mode, OpenFile (+9 more)

### Community 75 - "FleetView.tsx"
Cohesion: 0.28
Nodes (4): SettingsPanel(), FleetView(), SCOPES, useDevices()

### Community 76 - "PoliciesView.tsx"
Cohesion: 0.29
Nodes (6): CAPABILITIES, CYCLE, DEFAULT_MATRIX, MODES, PoliciesView(), PolicyValue

### Community 77 - "How you operate (Orbit operating manual)"
Cohesion: 0.21
Nodes (14): assert, brand, fs, path, policyEngine, run(), SERVER_SRC, testApiKeyPrefix() (+6 more)

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
Cohesion: 0.15
Nodes (10): ContainerHarness, env, { execSync }, IMAGE, os, path, PI_CONFIG_DIR, PI_RUNTIME_DIR (+2 more)

### Community 85 - "index.js"
Cohesion: 0.14
Nodes (13): 1. Executive Summary, 1. Fix `mode_switch_rerun` Parameter Extraction in `server.js`, 2. Detailed Technical Timeline & Evidence, 2. Safeguard `--exclude-tools` Flag on Remote Adapters, 3. Core Findings & Root Causes Matrix, 3. Propagate Spawn/CLI Stderr Errors & Add Unreachable Notifications, 4. Remediation Plan & Code Fixes, 5. Conclusion (+5 more)

### Community 86 - "IconRail.tsx"
Cohesion: 0.40
Nodes (3): IconRailProps, RailView, VIEWS

### Community 92 - "connectors.js"
Cohesion: 0.26
Nodes (13): api(), assert, DOMAINS, main(), makeTenant(), path, POLL_TIMEOUT_MS, pollRun() (+5 more)

### Community 95 - "channel-scheduler.js"
Cohesion: 0.15
Nodes (12): env, EventEmitter, fs, HarnessInterface, os, path, { PROVIDER_ID, builtinMcpNames }, { spawn } (+4 more)

### Community 97 - "subagentFields"
Cohesion: 0.15
Nodes (13): Built-in tools: ask & build, Concepts, Connectors (MCP), Harness, Policy & modes, Result contract, Run, Sandbox (+5 more)

### Community 102 - "class-variance-authority"
Cohesion: 0.18
Nodes (12): createApiKey(), _createDevice(), createPairingCode(), createSsoSession(), generatePairingCode(), getDeviceByLlmToken(), hashToken(), mintDeviceLlmToken() (+4 more)

### Community 105 - "tailwind-merge"
Cohesion: 0.24
Nodes (10): classifyQuery(), isConversationalPrompt(), isMultiStepTask(), isMutatingTool(), isSmallTalk(), stripTuiChars(), env, generatePlan() (+2 more)

### Community 107 - "restart-orbit.sh"
Cohesion: 0.17
Nodes (12): Answer a run (`awaiting_input`), Cancel a run, Fetch generated files, How status is derived, Long-poll for short runs, Poll a run, Run API & the result contract, Status meanings (+4 more)

### Community 154 - "index.js"
Cohesion: 0.14
Nodes (15): loadHarness(), OpenCodeHarness, PiCodeHarness, broadcastNotification(), clampMs(), handleStartTask(), persistPlanFiles(), readRunUsage() (+7 more)

### Community 155 - "LogViewer.tsx"
Cohesion: 0.18
Nodes (11): Access control (RBAC + multi-tenancy), Configuration, Core, Database, Execution sandbox, External build+test facility, LLM (required), Optional integrations (+3 more)

### Community 156 - "NotificationCenter.tsx"
Cohesion: 0.18
Nodes (10): About Tether — platform self-knowledge & tools, Channels & connectivity, Connectors & skills, Fleet — delegate across devices, Guiding the user, Permission modes (user picks one per turn; shown as a composer chip), Reaching the user — messaging & alerts, Tools — the tool-calling contract (+2 more)

### Community 157 - "getUser"
Cohesion: 0.22
Nodes (10): createLocalUser(), ensureSuperadminAccount(), getSsoSessionByToken(), getUser(), hashPassword(), normalizeRole(), setUserPassword(), setUserRole() (+2 more)

### Community 158 - "package.json"
Cohesion: 0.20
Nodes (9): dependencies, @modelcontextprotocol/sdk, puppeteer-core, description, @modelcontextprotocol/sdk, puppeteer-core, main, name (+1 more)

### Community 159 - "index.js"
Cohesion: 0.27
Nodes (8): ANDROID_CLIENT, {
  CallToolRequestSchema,
  ListToolsRequestSchema,
}, decodeEntities(), fetchYouTubeTranscript(), parseTimedText(), parseVideoId(), { Server }, { StdioServerTransport }

### Community 160 - "gen-env-example.js"
Cohesion: 0.27
Nodes (9): content, env, fs, GROUPS, OUT, path, PROMPT_FOR, render() (+1 more)

### Community 161 - "Getting started"
Cohesion: 0.22
Nodes (9): Getting started, Install & run, Next steps, Option A — local (dev), Option B — Docker Compose (prod-style, Postgres), Ports, Prerequisites, Your first task (headless API) (+1 more)

### Community 162 - "Secrets & connectors"
Cohesion: 0.22
Nodes (9): API, API, Caveats, Connectors (MCP tool servers), How a secret reaches the script, Isolation, Secrets, Secrets & connectors (+1 more)

### Community 163 - "index.js"
Cohesion: 0.22
Nodes (6): {
  CallToolRequestSchema,
  ListToolsRequestSchema,
}, fs, path, puppeteer, { Server }, { StdioServerTransport }

### Community 164 - "index.js"
Cohesion: 0.31
Nodes (7): {
  CallToolRequestSchema,
  ListToolsRequestSchema,
}, decodeEntities(), searchDuckDuckGo(), { Server }, { StdioServerTransport }, unwrapDdg(), webSearch()

### Community 165 - "How you operate — Tether operating manual"
Cohesion: 0.22
Nodes (8): Files & workspace, How you operate — Tether operating manual, Implementation, Planning & tracking, Response formatting, Runtime & scripting, Truthfulness & grounding (non-negotiable), When blocked

### Community 166 - "mapRow"
Cohesion: 0.32
Nodes (8): enforceTTL(), getAllSessions(), getSession(), getSessionsScoped(), listInterruptedSessions(), mapRow(), searchSessions(), searchSessionsScoped()

### Community 167 - "askQuestion"
Cohesion: 0.29
Nodes (8): askQuestion(), emitBuildState(), endBuild(), findRunBySession(), finishAsk(), normalizeQuestions(), startBuild(), TESTER_URL

### Community 168 - "test_db_layer.js"
Cohesion: 0.25
Nodes (6): assert, brand, db, fs, os, path

### Community 169 - "secretTenant"
Cohesion: 0.38
Nodes (7): deleteSecret(), getSecret(), getSecretsForTenant(), listSecrets(), mapSecretRow(), secretTenant(), setSecret()

### Community 171 - "modes.ts"
Cohesion: 0.33
Nodes (4): ModeId, ModeMeta, MODES, SWITCHABLE_MODES

### Community 172 - "End-to-end examples"
Cohesion: 0.29
Nodes (7): curl, End-to-end examples, Node (fetch), One-shot (long-poll), Python, Re-running against a session (versioning), Reference harness

### Community 173 - "Script generation (run-API contract)"
Cohesion: 0.29
Nodes (6): Datasources, Emit `../artifacts/RESULT.json` (required, last step), Script generation (run-API contract), Secrets — reference, never inline, Smoke-test before finishing, Where things go

### Community 174 - "connectorTenant"
Cohesion: 0.47
Nodes (6): connectorTenant(), deleteConnector(), getConnector(), listConnectorsForTenant(), mapConnectorRow(), upsertConnector()

### Community 175 - "getTemplate"
Cohesion: 0.47
Nodes (6): deleteTemplate(), getTemplate(), listTemplatesForTenant(), mapTemplateRow(), templateTenant(), upsertTemplate()

### Community 176 - "prompt.js"
Cohesion: 0.40
Nodes (5): composeSystemPrompt(), fs, path, promptsDir, renderPolicyMatrix()

### Community 177 - "ask-mcp.js"
Cohesion: 0.33
Nodes (3): {
  CallToolRequestSchema,
  ListToolsRequestSchema,
}, { Server }, { StdioServerTransport }

### Community 178 - "build-mcp.js"
Cohesion: 0.33
Nodes (3): {
  CallToolRequestSchema,
  ListToolsRequestSchema,
}, { Server }, { StdioServerTransport }

### Community 179 - "fleet-mcp.js"
Cohesion: 0.33
Nodes (3): {
  CallToolRequestSchema,
  ListToolsRequestSchema,
}, { Server }, { StdioServerTransport }

### Community 180 - "notify-mcp.js"
Cohesion: 0.33
Nodes (3): {
  CallToolRequestSchema,
  ListToolsRequestSchema,
}, { Server }, { StdioServerTransport }

### Community 181 - "migrate-sqlite-to-pg.js"
Cohesion: 0.33
Nodes (4): env, fs, path, TABLES

### Community 182 - "Authentication & tenants"
Cohesion: 0.33
Nodes (6): Authentication & tenants, Credentials, Dev-mode vs enforced, Isolation guarantee, Minting tenant API keys, Roles

### Community 183 - "getTenant"
Cohesion: 0.40
Nodes (5): createTenant(), getTenant(), listTenants(), mapTenantRow(), updateTenant()

### Community 184 - "mapUserRow"
Cohesion: 0.40
Nodes (5): getUserByUsername(), listUsers(), mapUserRow(), verifyLocalLogin(), verifyPassword()

### Community 185 - "run.js"
Cohesion: 0.60
Nodes (4): createRunRouter(), { Router }, sleep(), TERMINAL

### Community 186 - "PromptTypeSelector.tsx"
Cohesion: 0.40
Nodes (3): FALLBACK, LibraryPrompt, PromptTypeSelectorProps

### Community 187 - "useTheme"
Cohesion: 0.50
Nodes (4): AppearanceSection(), PALETTE_IDS, PALETTES, useTheme()

### Community 188 - "Integration guide — driving Tether from your app"
Cohesion: 0.40
Nodes (5): Base URL & auth, Integration guide — driving Tether from your app, REST vs WebSocket, The parent-app flow, What a run produces

### Community 189 - "stub-mcp-server.js"
Cohesion: 0.40
Nodes (4): { ListToolsRequestSchema, CallToolRequestSchema }, { Server }, { StdioServerTransport }, transport

### Community 190 - "getDeviceByToken"
Cohesion: 0.50
Nodes (4): getDevice(), getDeviceByToken(), listDevices(), mapDeviceRow()

### Community 191 - "getProfile"
Cohesion: 0.50
Nodes (4): getChannel(), listChannels(), mapChannelRow(), saveChannel()

### Community 197 - "docker-entrypoint.sh"
Cohesion: 0.83
Nodes (3): rewrite_host_local(), docker-entrypoint.sh script, shutdown()

### Community 198 - "Tether Documentation"
Cohesion: 0.50
Nodes (4): Integration (headless backend) docs, Start here, Tether Documentation, Two ways to use Tether

## Knowledge Gaps
- **877 isolated node(s):** `os`, `fs`, `path`, `WebSocket`, `EventEmitter` (+872 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **88 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `init()` connect `Lightpanda MCP Server Package` to `class-variance-authority`, `mapRow`, `Database & Device Pairing`, `secretTenant`, `connectorTenant`, `getTemplate`, `getTenant`, `mapUserRow`, `page.tsx`, `getUser`, `getDeviceByToken`, `getProfile`?**
  _High betweenness centrality (0.179) - this node is a cross-community bridge._
- **Why does `installApiAuthFetch()` connect `page.tsx` to `Lightpanda MCP Server Package`?**
  _High betweenness centrality (0.178) - this node is a cross-community bridge._
- **Why does `dependencies` connect `Frontend Dependencies` to `next`, `clsx`, `http-proxy`, `react-dom`, `remark-gfm`, `DetailPanel.tsx`, `shadcn`, `package.json`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `init()` (e.g. with `db.js` and `installApiAuthFetch()`) actually correct?**
  _`init()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `os`, `fs`, `path` to the rest of the system?**
  _887 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Dashboard Components & Settings Panel` be split into smaller, more focused modules?**
  _Cohesion score 0.060451977401129946 - nodes in this community are weakly interconnected._
- **Should `Express Server & Routers` be split into smaller, more focused modules?**
  _Cohesion score 0.019988577955454025 - nodes in this community are weakly interconnected._