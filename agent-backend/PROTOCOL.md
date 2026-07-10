# AegisAgent Wire Protocol

Two boundaries, documented in one place:

1. **Harness protocol** — JSON lines between the backend and a harness process (pi today; any adapter tomorrow).
2. **Dashboard WS protocol** — JSON messages between the backend and connected dashboard clients over `/api/ws`.

All messages are single-line JSON objects with a `type` field. Every dashboard message the backend sends includes `sessionId` (added by `sendWithSession`).

---

## 1. Harness protocol

### Backend → harness (stdin)

| type | fields | meaning |
|---|---|---|
| `prompt` | `message` | user prompt for this turn |
| `compact` | `id` | compact conversation memory now |
| `set_auto_compaction` | `id`, `enabled` | toggle auto-compaction |

### Harness → backend (stdout, one JSON per line)

| type | fields | meaning |
|---|---|---|
| `message_update` | `assistantMessageEvent: {type: "text_delta"\|"thinking_delta", delta}` | streaming output / reasoning |
| `tool_call_start` / `tool_execution_start` | `toolCall: {id, name, arguments}`, `subagentId?` | tool call begins; `subagentId` set when the call is made *by* a sub-agent |
| `tool_call_end` / `tool_execution_end` | `toolCall: {id, name}`, `result`, `subagentId?` | tool call finished |
| `subagent_update` | `subagentId`, `reasoning?`, `tokens?`, `status?` | sub-agent reasoning / status change |
| `agent_end` | — | turn complete |
| *(any)* + `usage` | `usage: {input\|input_tokens\|prompt_tokens, output\|output_tokens\|completion_tokens, reasoning?\|completion_tokens_details.reasoning_tokens?, cache_read?}`, `subagentId?` | **provider-reported usage.** May ride on any item (`message_update`, `agent_end`, a dedicated item). The harness wrapper normalizes key spellings and emits a standardized `usage` event; zero-usage payloads are dropped. |

The `subagent` tool is special-cased: its `tool_call_start` spawns a tracked sub-agent (task = `arguments.prompt`), and its `tool_call_end` completes it and folds its token counters into the session.

---

## 2. Dashboard WS protocol

### Client → backend

| type | fields | meaning |
|---|---|---|
| `start_task` | `prompt`, `sessionId`, `mode`, `systemPromptType` | run a prompt turn |
| `approval_response` | `toolCallId`, `approved` | resolve a pending approval |
| `edit_permission_response` | `toolCallId`, `decision: allow_once\|allow_session\|deny`, `path`, `sessionId` | resolve an edit-mode path gate |
| `mode_switch` | `sessionId`, `mode` | switch mode (kills harness; next prompt respawns) |
| `mode_switch_rerun` | `sessionId`, `mode`, `prompt`, `systemPromptType` | switch mode and re-run a prompt |
| `cancel` / `cancel_session` | `sessionId` | stop the running agent |
| `compact` / `set_auto_compaction` | `sessionId`, `enabled?` | memory controls (forwarded to harness) |

### Backend → client

| type | fields | meaning |
|---|---|---|
| `message` | `role: "assistant"`, `content` | assistant text (streamed and final; `<tts>` blocks stripped) |
| `plan` / `reasoning_update` | `content` | accumulated reasoning / generated plan |
| `tool_start` | `toolCallId`, `name`, `arguments` | tool call began |
| `tool_end` | `toolCallId`, `name`, `result` | tool call finished |
| `subagent_metrics` | `subagents: [FrontendSummary]` + all `usage_update` fields | sub-agent tree + metrics snapshot (sent on sub-agent activity) |
| `usage_update` | `tokens`, `tokensIn`, `tokensOut`, `tokensReasoning`, `tokensSource: "reported"\|"estimated"`, `cost`, `costEstimated`, `latency` (ms), `latencyPerTool`, `turns` (last 12 ledger entries), `toolCalls`, `activeSubagents`, `actionFeed` | metrics snapshot (sent on provider usage arrival and at turn end) |
| `speech_sentence` | `content` | one TTS sentence (streamed from `<tts>` tags) |
| `intelligent_speech` | `content` | fallback TTS summary for a turn with no `<tts>` tags |
| `mode_suggestion` | `mode`, `reason` | policy blocked the tool; suggests the required mode |
| `edit_permission_request` | `toolCallId`, `toolName`, `paths`, `outsidePaths`, `safeZone` | edit-mode path gate (in-timeline approval) |
| `status` | `status: thinking\|executing\|done\|error` | turn lifecycle |
| `log` | `text`, `isDebug` | log line |
| `error` | `message` | fatal error |
| `screenshot_updated` | `file` | new workspace screenshot available |
| `notification` | `title`, `body` | push-style notification |

### Metrics semantics

- **`tokensSource: "reported"`** means at least one provider `usage` event arrived this session; token totals and cost are then computed from real usage with directional pricing (`metrics.js MODEL_PRICING_PER_MILLION`). `"estimated"` means character-count heuristics (flagged as such in the UI).
- **`turns`** is the per-turn ledger: `{at, durationMs, prompt, tokens: {input, output, reasoning}, toolCalls, cost, source}` — appended at `agent_end`, capped at 100, persisted in the session's metrics blob.
- Sub-agent counters (`tokens`, `toolCalls`, reasoning, per-call latency) live in the persisted `subagentTree` (see `subagent-tracker.js`) and survive restarts.

### Phase-2 target vocabulary (timeline UI)

The console rebuild consumes the events above; planned additions when the timeline lands: `turn_start`, structured `plan_update` (phase/task/status for Mission view), `approval_request`/`approval_resolved` (generalized beyond edit-permission), and `edit` (file + diffstat) as a first-class event instead of being inferred from tool names.
