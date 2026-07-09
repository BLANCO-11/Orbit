# 02 — Real-Time Streaming TTS

## Problem

Currently, TTS only fires **after the entire agent response is complete**. The backend code at `server.js` lines ~274-290 shows:

1. Agent accumulates all text in `accumulatedText` during `text_delta` events
2. On `agent_end`, it parses `<tts>` tags and calls `generateIntelligentSpeech()` for a summary
3. The frontend receives one `intelligent_speech` event with the full summary text
4. TTS then generates audio for the entire summary at once

This means:
- Users wait through the entire agent execution before hearing anything
- Long responses take forever to generate TTS for
- No feedback during tool execution ("reading file X", "running command Y")
- The streaming TTS code in the frontend (`handleStreamingSpeech`) is unused

## Root Cause

The backend's `sendPromptToAgent` streams the assistant text via `text_delta` events, but **only emits TTS at `agent_end`**. The frontend's `handleStreamingSpeech` function exists and detects sentences in real-time from the `message` events, but it's never actually called — the TTS path goes through `intelligent_speech` instead.

The frontend also has `handleStreamingSpeech`, `queueSentenceTTS`, and `playStreamingTTSQueue` — these are wired to detect completed sentences from the streaming text and play them as they arrive. But they're never triggered because the backend doesn't send sentence-level updates.

## Solution

### Backend Changes (`agent-backend/server.js`)

**Option A (Recommended): Emit sentence-level TTS events from backend**

In the `text_delta` handler, after updating `accumulatedText`:

1. Detect completed sentences (ending with `. ! ?` followed by space or end)
2. For each new completed sentence, emit a `speech_sentence` WebSocket event
3. The `agent_end` handler should only emit a final summary if there are leftover sentences

This way TTS starts playing **while the agent is still thinking/executing**.

**Option B: Frontend-only fix (less invasive)**

The `message` event handler already receives the accumulated text as it grows. The frontend could:
1. Compare new text vs previous text to find new content
2. Extract completed sentences from new content
3. Queue them for TTS immediately

This avoids backend changes but means TTS lags slightly behind the streaming text.

### Backend Code Location

In `server.js`, the `piProcess.stdout.on("data")` handler around **line 212**:

```javascript
if (item.type === "message_update") {
  const ev = item.assistantMessageEvent;
  if (ev.type === "text_delta") {
    accumulatedText += ev.delta;
    // >>> ADD HERE: detect completed sentences and emit speech_sentence
    let cleanStreamText = accumulatedText.replace(...)
    ws.send(JSON.stringify({ type: "message", role: "assistant", content: cleanStreamText }));
  }
```

Also add TTS for **tool calls** — when a tool starts (`tool_call_start`), emit a short TTS like "Running shell command" or "Reading file" so the user hears progress.

### Frontend Changes (`dashboard/src/app/page.js`)

1. In the WebSocket `onmessage` handler, add a handler for `speech_sentence`:
   ```javascript
   case "speech_sentence":
     if (voiceResponse) {
       queueSentenceTTS(data.content);
     }
     break;
   ```

2. Wire up `handleStreamingSpeech` to be called from the `message` event handler for real-time sentence detection (Option B hybrid)

3. Remove the constraint `MAX_SPOKEN_SENTENCES = 2` — with streaming, we want to hear all completed sentences as they arrive

4. Fix the `handleStreamingSpeech` function to work correctly with the streaming message content (compare old vs new text)

### Tool-Level TTS

Add TTS announcements for notable tool calls:
- "Bash: running..." → short beep or verbal "Executing command"
- "Read: reading file..." → "Reading [filename]"
- "Write: creating file..." → "Creating [filename]"

This gives users audio feedback during execution, not just at the end.

## Files to Change

```
agent-backend/server.js            # Add speech_sentence events, tool-level TTS
dashboard/src/app/page.js          # Wire up speech_sentence handler, fix handleStreamingSpeech
```

## Implementation Order

1. Add `speech_sentence` event emission in backend `text_delta` handler
2. Add `speech_tool` event for tool call starts
3. Wire up frontend to handle both events
4. Remove sentence cap, fix streaming TTS queue
5. Test with various response lengths

## References

See [reference.md](./reference.md) for the TTS API endpoint details on the local pocket-tts service.
