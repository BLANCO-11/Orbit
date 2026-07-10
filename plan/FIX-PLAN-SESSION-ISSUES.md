# Investigation & Fix Plan: Session Metrics, Cross-Contamination, Mode Enforcement & Subagent Tracking

## Overview

Investigation of the `LLM-OS-AGENT` system (backend: `agent-backend/server.js`, frontend: `dashboard/`, db: `agent-backend/db.js`) reveals **four interconnected systemic issues** in how sessions are managed, metrics are recorded, security modes are enforced, and subagents are tracked.

---

## 🔴 Issue 1: Session Metrics Not Calculated Properly

### Root Cause Analysis

**1A. Ephemeral, non-persisted metric state**
- In `server.js:spawnAgentSession()`, a local `const sessionMetrics = { toolCalls: 0, tokens: 0, active: [], reasoning: [] }` is created per agent spawn
- This object only lives in memory and is never saved to the SQLite database
- The frontend receives metrics via `subagent_metrics` WebSocket events, stores them in React state `metrics`
- `updateCurrentSessionRef.current({ metrics: next })` does write to DB — BUT only when the frontend decides to, not on every metric update
- **Result**: metrics data is lost on page refresh, session switch, or agent respawn

**1B. Token estimation is crude**
- Tokens are estimated as `Math.round(text.length / 4)` everywhere in server.js
- This is a very rough approximation that doesn't account for actual model tokenization
- Frontend also estimates: `Math.round(totalCharCount / 3.8)`
- Different ratio used in different places

**1C. Metrics for subagents only sent via `subagent_metrics` type, not integrated into main session metrics**
- The backend sends `{ type: "subagent_metrics", subagents: [...], sessionToolCalls: N, sessionTokens: N }`
- The frontend's `subagent_metrics` handler uses `data.sessionTokens` and `data.sessionToolCalls` if present
- But `sessionMetrics.toolCalls` and `sessionMetrics.tokens` are incremented per-event in the backend, so they ARE accumulating
- **Problem**: The frontend's `message` handler ALSO estimates tokens independently, potentially double-counting

**1D. Reasoning steps not tracked as metrics**
- `accumulatedThinking` is captured for display but never counted as part of session metrics
- Reasoning tokens are counted (`sessionMetrics.tokens += ...`) but not broken down into a reasoning-specific metric
- `reasoningHistory` is separate from `metrics` in the session data model

**1E. Latency tracking is basic**
- Only `startTimeRef.current = Date.now()` → `elapsed = ((Date.now() - startTimeRef.current) / 1000).toFixed(1)`
- No per-tool-call latency, no per-reasoning-step latency, no subagent latency

### Fix Plan

```
Priority: HIGH
Effort: ~3-4 hours

1. Create a centralized SessionMetricsManager class (or module)
   - Lives in agent-backend/db.js or a new agent-backend/metrics.js
   - Methods: recordToolCall(sessionId, name, inputTokens, outputTokens)
              recordReasoning(sessionId, delta)
              recordSubagentEvent(sessionId, type, data)
              recordLatency(sessionId, phase, ms)
              getSessionMetrics(sessionId)
              persistMetrics(sessionId) -> writes to DB
              restoreMetrics(sessionId) -> reads from DB

2. Fix metric persistence
   - Add a `metrics` column migration with structured JSON schema:
     {
       "toolCalls": { "total": N, "byTool": { "bash": 5, "read": 3, ... } },
       "tokens": { "input": N, "output": N, "reasoning": N, "total": N, "estimated": true },
       "latency": { "total_ms": N, "perTool": {}, "perSubagent": {} },
       "subagents": [ { "id", "name", "toolCalls", "tokens", "reasoning", "latency" } ],
       "reasoningSteps": N,
       "sessionStart": "ISO timestamp",
       "lastActivity": "ISO timestamp"
     }
   - Persist metrics to DB every N events OR on session end (not just during saveIfChanged debounce)

3. Implement proper token counting
   - Use the LiteLLM model's tokenizer via a local endpoint call, OR
   - Use a library like `tiktoken` for accurate counts, OR at minimum
   - Use a unified estimation function with tokenizer-aware heuristics
   - Store `estimated: true/false` flag in metrics

4. Track reasoning as a first-class metric
   - Count reasoning deltas separately: input tokens (prompt), reasoning tokens (thinking), output tokens (response)
   - Store in session metrics as breakdown

5. Add per-tool latency tracking
   - When tool_call_start fires: record startTime per toolCallId
   - When tool_call_end fires: compute elapsed and record per-tool latency
   - Include in actionFeed items on frontend

6. Frontend: Show richer metrics display
   - Add breakdown tabs in MetricsPanel: "Overview", "Tool Calls", "Tokens", "Latency", "Subagents"
   - Show per-tool-type call counts
   - Show token breakdown chart (input vs reasoning vs output vs subagent)
   - Show latency timeline
```

---

## 🔴 Issue 2: Session Cross-Contamination (Responses in Wrong Session)

### Root Cause Analysis

**2A. No WebSocket message routing by sessionId**
- The backend sends ALL events to the same WebSocket connection regardless of which session produced them
- When `handleSwitchSession()` is called in the frontend:
  1. Current session data is saved to localStorage/DB
  2. Target session data is loaded into state
  3. **BUT** the old session's agent process is NOT killed
  4. The old process keeps streaming output to the WebSocket
  5. The frontend processes ALL incoming messages and pushes them to `currentSessionId`'s state
  6. **Contamination**: Session A's agent output gets pushed into Session B's message history

**2B. `ws.activeSessionId` is not properly managed**
- The WebSocket connection sets `ws.activeSessionId` in `spawnAgentSession()`
- When the user switches to a NEW session and enters a prompt, `sendPromptToAgent()` spawns a new process for the new sessionId
- But the OLD session's process is still in `activeSessions` with its own sessionId, still writing to the same WebSocket
- The frontend's `messages` state is scoped to `currentSessionId`, but WebSocket events are not filtered

**2C. No Session-Process lifecycle management on switch**
- `handleSwitchSession()` in the frontend does NOT send any WebSocket message to stop the previous session's agent
- The backend only kills processes when:
  - A new spawn happens for the SAME sessionId (overwriting)
  - A `mode_switch` message is received
  - A `cancel` message is received
  - WebSocket connection closes
- Normal session switching bypasses ALL of these

**2D. Both sessions write to the same `messages` array**
- When `switch` happens, the frontend sets `setMessages(target.messages || [])`
- But the WebSocket `onmessage` handler appends to `setMessages(prev => ...)` without checking `currentSessionId`
- **Even if the frontend DID check**, the backend sends events without sessionId tagging, so there's no way to route correctly

### Fix Plan

```
Priority: CRITICAL
Effort: ~2-3 hours

1. Add sessionId to ALL backend WebSocket events
   - Every `ws.send(JSON.stringify({ type: "...", content: "..." }))` call must include `sessionId`
   - This is the routing key that the frontend uses to filter events
   - Example: `{ type: "message", role: "assistant", content: "...", sessionId: "session-xyz" }`

2. Frontend: Filter WebSocket events by active sessionId
   - In all `ws.onmessage` handlers, check `data.sessionId === currentSessionId`
   - If mismatch, IGNORE the event (console.warn with a counter for diagnostics)
   - This prevents cross-contamination even if backend sends events for wrong session

3. Frontend: Kill old agent process on session switch
   - In `handleSwitchSession()`, BEFORE loading the new session:
     a. Save current session data
     b. Send `{ type: "cancel", sessionId: currentSessionId }` via WebSocket
     c. Then load the target session
   - This ensures the old agent stops producing output

4. Backend: Track session-to-WebSocket mapping
   - Maintain a `Map<sessionId, Set<ws>>` to track which WebSocket connections care about which session
   - When sending events, only send to WebSockets registered for that session
   - Clean up on WebSocket close or session delete

5. Backend: Auto-kill stale sessions
   - When a new message arrives for session B, check if session A's process is still running
   - If so, kill it before processing session B (unless session A has pending async work)
   - Or better: implement proper multi-session isolation where each session gets its own WebSocket channel or its own events stream

6. Add guard: prevent double-session execution
   - If user sends a prompt to session B while session A is still executing, show warning
   - Offer to wait, cancel session A, or queue session B
```

---

## 🔴 Issue 3: Mode Enforcement Not Working (Read/Approval Mode)

### Root Cause Analysis

**3A. Enforcement is reactive (after tool call already started), not proactive**
- Mode checks happen in `server.js`'s `tool_call_start` handler:
  ```js
  if (mode === "plan" && isMutating(toolName)) { blockTool = true; }
  ```
- At this point the agent has already:
  1. Received the prompt
  2. Spent tokens reasoning about what to do
  3. Decided to call a tool
  4. Emitted the tool_call_start event
  5. The tool call is already "executing" in the pi CLI agent
- The mode check kills the process AFTER the fact: `piProcess.kill("SIGINT")`
- **User pays for tokens even when mode should block execution**

**3B. No Human-In-The-Loop (HITL) pause mechanism**
- Plan mode prompt says: "Before executing ANY tool, first explain your complete plan... then wait for explicit approval"
- But the pi CLI agent has NO mechanism to actually PAUSE and wait for user input
- The agent is a single continuous LLM session - it outputs text saying "I'll wait for your approval" but the pi agent just keeps going
- The system prompt is advisory text, not executable enforcement
- The server.js code tries to enforce at the tool level but it's too late

**3C. Process killing is destructive, not instructive**
- When mode violation is detected: `piProcess.kill("SIGINT")` and `activeSessions.delete(sessionId)`
- This destroys the entire agent context
- The user has to re-prompt from scratch
- No graceful pause/resume flow exists

**3D. Mode is only set at session spawn time**
- `spawnAgentSession(ws, sessionId, mode, systemPromptType)` uses the `mode` parameter to select prompt files
- If mode changes, the existing process is killed and a NEW one is spawned
- No in-process mode transition

**3E. The frontend's mode selection doesn't properly enforce**
- `handleSetSessionMode()` sets `sessionMode` state and sends `mode_switch` WebSocket message
- But the mode_switch handler kills the old process and doesn't spawn a new one until next prompt
- Between mode change and next prompt, there's a dead session state

### Fix Plan

```
Priority: CRITICAL  
Effort: ~4-6 hours (significant architectural change)

1. ARCHITECTURAL: Implement tool-gate interceptor layer
   - Create agent-backend/tool-gate.js that sits between the pi agent process and the WebSocket
   - When tool_call_start fires, check mode BEFORE letting the tool execute
   - If mode blocks the tool:
     a. PAUSE the agent process (don't kill it)
     b. Send mode_suggestion to frontend
     c. Store the tool call in a pending queue
     d. When user approves, RESUME the agent and let it proceed
     e. When user denies, RESUME but tell agent it was blocked
   - This requires pi agent to support process-level pause/resume

2. Implement proper HITL (Human In The Loop) at the pi agent level
   - The pi agent needs an "ask_approval" tool or mechanism that causes it to pause and wait
   - When in Plan mode, the agent should call `ask_approval` tool BEFORE executing actual tools
   - The backend intercepts `ask_approval` calls and shows the approval banner
   - User approves → backend tells pi agent "approved" → agent proceeds
   - User denies → backend tells pi agent "denied" → agent revises plan
   - This requires changes to how the pi agent interacts OR a wrapper around it

3. MODE ENFORCEMENT REFACTOR: Three-layer enforcement
   Layer 1 (Prompt-level): System prompt tells agent the rules (already exists)
   Layer 2 (Interceptor-level): Server intercepts tool calls and blocks/pauses (needs rewrite)
   Layer 3 (Process-level): Only as last resort, kill and restart with proper mode

4. Add mode enforcement for subagents
   - When a subagent is spawned, PASS THE MODE to the subagent
   - Subagent should inherit parent's mode enforcement rules
   - Currently subagent spawns ignore the session mode entirely

5. Frontend: Add approval UI that properly pauses agent flow
   - When mode violation is detected, show a modal/banner that:
     a. Explains what tool was blocked
     b. Offers "Approve Once", "Approve Session", "Switch Mode", "Deny"
     c. When user responds, sends resume/deny signal to backend
     d. Backend resumes the paused agent
   - This replaces the current destructive process-kill approach

6. RPC-level mode enforcement
   - Instead of spawning pi agent in "normal" mode and killing it on violations,
     pass mode as a structured parameter that the pi agent itself can enforce
   - Use pi-agent's built-in permission/approval mechanisms if they exist
   - If pi-agent doesn't have these, implement a wrapper that:
     - Intercepts tool calls at the STDIN/STDOUT level (before they reach the actual tool)
     - Checks mode permissions
     - Either allows, blocks, or queues the tool call
```

---

## 🔴 Issue 4: Subagents Not Tracked End-to-End

### Root Cause Analysis

**4A. Subagent tracking is shallow**
- `server.js` creates a subagent entry in `sessionMetrics.active[]` with just:
  ```js
  { id, name, status: "working", currentAction: "Spawning...", time, toolCalls: 0, tokens: 0, inheritedMode }
  ```
- There's no tracking of:
  - Subagent reasoning steps (individual thinking deltas)
  - Subagent tool calls (what tools did the subagent call? with what args? what results?)
  - Per-subagent token breakdown
  - Subagent execution timeline (spawn → reasoning → tool1 → tool2 → ... → completion)
  - Subagent errors/failures

**4B. `subagent_update` RPC events are unreliable**
- The backend handles `item.type === "subagent_update"` events that the pi CLI agent emits
- But these events may not contain proper `subagentId`, `reasoning`, `tokens`, or `status` fields
- The pi agent's RPC protocol may not emit these events at all for subagent invocations
- **Result**: Most subagent internal activity goes untracked

**4C. `item.subagentId` field is never set properly**
- The code checks `item.subagentId` to associate tool calls with specific subagents
- But the pi CLI agent's RPC output doesn't include this field for subagent tool calls
- Without proper subagentId, all subagent tool calls are attributed to the main session, not the subagent

**4D. No subagent metrics persistence**
- Subagent data is only sent via WebSocket and shown in the UI while the session is active
- When the session is reloaded, subagent metrics are lost
- The `metrics` JSON in the DB only stores flat `toolCalls`, `tokens`, `latency`, `cost` — not individual subagent data

**4E. No visualization of subagent reasoning**
- The frontend's `SubagentPanel` component has a `subagent.reasoning` field for inline reasoning
- But this data rarely gets populated because the `subagent_update` events don't carry reasoning content
- Subagent thinking is essentially invisible to the user

### Fix Plan

```
Priority: HIGH
Effort: ~3-5 hours

1. Create structured SubagentTracker class
   - agent-backend/subagent-tracker.js
   - Maintains a tree of subagent executions per session:
     {
       sessionId: "session-xyz",
       agents: [
         {
           id: "sa-1",
           name: "reviewer",
           parentId: null,           // null = main agent
           status: "completed",      // spawning | working | blocked | completed | failed
           mode: "plan",
           timeStart: "ISO",
           timeEnd: "ISO",
           toolCalls: [
             { name: "read", args: {...}, result: "...", startTime, endTime, tokens }
           ],
           reasoning: [
             { content: "...", timestamp: "ISO", tokens: N }
           ],
           tokens: { input: 0, output: 0, reasoning: 0, total: 0 },
           results: "summary text",
           children: [...]            // nested subagent IDs if subagent spawned subagents
         }
       ]
     }

2. Parse subagent RPC events properly
   - The pi agent's RPC output for subagent invocations should include:
     - `type: "subagent_spawn"` with `subagentId`, `name`, `task`
     - `type: "subagent_thinking_delta"` with `subagentId`, `delta`
     - `type: "subagent_tool_call"` with `subagentId`, `toolName`, `args`
     - `type: "subagent_tool_result"` with `subagentId`, `toolName`, `result`, `tokens`
     - `type: "subagent_complete"` with `subagentId`, `summary`, `metrics`
   - Map these to the SubagentTracker's data model
   - Emit to frontend as structured events

3. Frontend: Enhance SubagentPanel with full detail
   - Add reasoning timeline (expandable log of thinking steps)
   - Add tool call list with expandable details (args, results, latency)
   - Add token timeline per subagent
   - Add status history (spawning → reasoning → tool_exec → ... → completed)
   - Add tree view for nested subagents (subagent of subagent)
   - Add subagent-to-subagent communication tracking (if they use intercom)

4. Persist subagent metrics to database
   - Store the full subagent tree in the session's `metrics` column
   - Add a dedicated `subagent_metrics` column or table for efficient querying
   - Include subagent metrics in session export/backup

5. Add subagent metrics API endpoint
   - GET /api/sessions/:id/subagents → returns full subagent execution tree
   - Frontend can lazily load this for archived sessions
   - Enables replaying subagent execution post-hoc

6. Ensure subagent mode inheritance works
   - When main agent is in Plan mode, spawned subagents should also be in Plan mode
   - Store `inheritedMode` in subagent tracker
   - Log when mode inheritance happens so user can see the permission chain
```

---

## 🔴 Issue 5 (Cross-cutting): Metrics/Session Data Not Properly Structured

### Root Cause

The `metrics` field in the DB schema is a flat JSON blob with no schema validation:
```json
{ "toolCalls": 0, "latency": 0, "tokens": 0, "cost": 0, "activeSubagents": [], "actionFeed": [] }
```

There's no:
- Schema version for metrics
- Structured breakdown of tool call types
- Subagent metrics
- Reasoning step metrics
- Per-phase latency
- Token type breakdown (input/output/reasoning)

### Fix Plan

```
1. Define a proper metrics JSON schema with versioning
2. Add migration path from old flat metrics to new structured format
3. Add validation on save/load (db.js)
4. Add fallback for reading old format
```

---

## Implementation Order

| Priority | Issue | Est. Effort | Dependencies |
|----------|-------|-------------|--------------|
| 🔴 P0 | #2 Session Cross-Contamination | 2-3h | None |
| 🔴 P0 | #3 Mode Enforcement | 4-6h | #2 (needs clean session isolation) |
| 🟡 P1 | #4 Subagent End-to-End Tracking | 3-5h | #1 (needs metrics infrastructure) |
| 🟡 P1 | #1 Session Metrics | 3-4h | None |
| 🟢 P2 | #5 Metrics Schema | 1-2h | #1 (builds on metrics system) |

**Total estimated effort: 13-20 hours**

## Recommended Approach

1. **Week 1**: Fix session cross-contamination (#2) + implement metrics infrastructure (#1)
   - These are foundational fixes that unblock the other work
   - Start with session routing in WebSocket, then metrics persistence

2. **Week 2**: Fix mode enforcement (#3)
   - Requires clean session isolation from #2
   - Start with tool-gate interceptor, then HITL UI

3. **Week 3**: Subagent E2E tracking (#4)
   - Builds on metrics infrastructure from #1
   - Start with SubagentTracker, then RPC event parsing, then UI

4. **Week 4**: Polish (#5 metrics schema, testing, edge cases)
