// agent-backend/harnesses/normalizer.js
// Event normalization layer — ensures all harnesses emit the same event shapes

/**
 * Normalize a raw event from any harness into a standard shape.
 * @param {object} rawEvent — the event as emitted by the harness
 * @param {string} harnessName — 'picode' | 'opencode' | 'claude-code'
 * @returns {object} normalized event with { type, ...fields }
 */
function normalizeEvent(rawEvent, harnessName) {
  switch (harnessName) {
    case "picode":
      return normalizePiCodeEvent(rawEvent);
    case "opencode":
      return normalizeOpenCodeEvent(rawEvent);
    case "claude-code":
      return normalizeClaudeCodeEvent(rawEvent);
    default:
      // Passthrough for unknown harnesses — assume they already emit standard shapes
      return rawEvent;
  }
}

// ── PiCode Normalizer ──────────────────────────────────────────────
// PiCode emits JSON lines on stdout. These are already close to the standard shape
// but use slightly different field names for some event types.

function normalizePiCodeEvent(item) {
  // PiCode tool calls use slightly different field names
  if (item.type === "tool_call_start" || item.type === "tool_execution_start") {
    const tc = item.toolCall || item;
    return {
      type: "tool_call_start",
      id: tc.id || tc.toolCallId,
      name: tc.name || tc.toolName || "",
      arguments: tc.arguments || {},
      subagentId: item.subagentId || null,
    };
  }

  if (item.type === "tool_call_end" || item.type === "tool_execution_end") {
    const tc = item.toolCall || item;
    return {
      type: "tool_call_end",
      id: tc.id || tc.toolCallId,
      name: tc.name || tc.toolName || "",
      result: item.result || null,
      subagentId: item.subagentId || null,
    };
  }

  // PiCode message_update → extract inner event
  if (item.type === "message_update") {
    const ev = item.assistantMessageEvent;
    if (ev && ev.type === "text_delta") {
      return { type: "text_delta", delta: ev.delta };
    }
    if (ev && ev.type === "thinking_delta") {
      return { type: "thinking_delta", delta: ev.delta };
    }
  }

  // Passthrough for already-standard types
  if (["text_delta", "thinking_delta", "subagent_update", "agent_end", "error", "close",
       "subagent_spawned", "subagent_tool_start", "subagent_tool_end",
       "subagent_reasoning", "subagent_text", "subagent_completed"].includes(item.type)) {
    return item;
  }

  // PiCode-specific event types that don't need transformation
  if (["subagent_update", "reasoning_update", "mode_suggestion", "status"].includes(item.type)) {
    return item;
  }

  return item;
}

// ── OpenCode Normalizer (stub) ─────────────────────────────────────

function normalizeOpenCodeEvent(rawEvent) {
  // OpenCode emits events in its own format. Normalize here when implementing.
  return rawEvent;
}

// ── Claude Code Normalizer (stub) ──────────────────────────────────

function normalizeClaudeCodeEvent(rawEvent) {
  // Claude Code emits events in its own format. Normalize here when implementing.
  return rawEvent;
}

module.exports = { normalizeEvent };
