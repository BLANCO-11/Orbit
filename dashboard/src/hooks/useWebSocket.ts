'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { useOrbitDispatch, actions } from '@/providers/OrbitProvider';

/**
 * useWebSocket — WebSocket lifecycle + message dispatch.
 *
 * Handles: connect, reconnect, parse, dispatch to reducer.
 * Returns: { sendMessage, connectionState }
 */
export function useWebSocket(
  backendWsUrl: string,
  options: {
    onSpeechSentence?: (sentence: string) => void;
    onIntelligentSpeech?: (text: string) => void;
  } = {}
) {
  const dispatch = useOrbitDispatch();
  // The WS onmessage closure is created once (connect deps are stable). Reading
  // callbacks through a ref that we refresh every render means speech handlers
  // always call the LATEST queueSentence/speakText — which capture the current
  // voiceState — instead of the frozen mount-time ones. (Fixes session-wide mute.)
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const socketRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const sessionIdRef = useRef('');
  const failedAttemptsRef = useRef(0);
  const unmountedRef = useRef(false);
  const [connectionState, setConnectionState] = useState('disconnected');

  // ── Streaming coalescer ───────────────────────────────────────────────
  // Backend emits a `message` frame per token, each carrying the FULL growing
  // content string. Dispatching every frame re-runs marked.parse+DOMPurify on
  // the last bubble each token, which stutters. Instead we hold the latest
  // content in a ref and flush at most once per animation frame.
  const pendingContentRef = useRef(null);
  const rafRef = useRef(0);
  const flushContent = useCallback(() => {
    rafRef.current = 0;
    if (pendingContentRef.current !== null) {
      const content = pendingContentRef.current;
      pendingContentRef.current = null;
      dispatch(actions.updateLastMessage({ content }));
    }
  }, [dispatch]);

  const connect = useCallback(() => {
    if (!backendWsUrl) return;
    if (socketRef.current?.readyState === WebSocket.OPEN) return;

    setConnectionState('connecting');
    const ws = new WebSocket(backendWsUrl);

    ws.onopen = () => {
      if (failedAttemptsRef.current > 0) {
        console.info('WebSocket reconnected to backend.');
      }
      failedAttemptsRef.current = 0;
      setConnectionState('connected');
      if (sessionIdRef.current) {
        ws.send(JSON.stringify({ type: 'subscribe', sessionId: sessionIdRef.current }));
      }
    };
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        // Session isolation: ignore events from other sessions
        if (data.sessionId && data.sessionId !== sessionIdRef.current) return;

        // Any non-message frame must see the latest streamed text already
        // committed, so flush the buffer synchronously before handling it.
        if (data.type !== 'message' && pendingContentRef.current !== null) {
          if (rafRef.current) cancelAnimationFrame(rafRef.current);
          flushContent();
        }

        switch (data.type) {
          case 'status':
            dispatch(actions.setStatus(data.status));
            break;

          case 'message':
            // Coalesce: keep only the latest content, flush once per frame.
            pendingContentRef.current = data.content;
            if (!rafRef.current) {
              rafRef.current = requestAnimationFrame(flushContent);
            }
            break;
            
          case 'tool_start':
            dispatch(actions.toolStart(data));
            dispatch(actions.incrementToolCalls());
            break;

          case 'tool_end':
            dispatch(actions.toolEnd(data));
            break;
            
          // NOTE: the legacy 'plan' message (a third, confusingly-named plan
          // surface) was retired in Workstream B2. Reasoning now flows only to
          // the reasoning accordion; the Mission board ('plan_state') is the
          // single canonical plan surface.

          case 'plan_state':
            dispatch(actions.setPlanState({
              steps: data.steps,
              plans: data.plans,
              activePlanId: data.activePlanId,
            }));
            break;
            
          case 'refresh_sessions':
            window.dispatchEvent(new CustomEvent('orbit:refresh_sessions'));
            break;
            
          case 'reasoning_update':
            // Reasoning feeds the per-turn reasoning accordion only — never an
            // "execution plan" surface (Workstream B2).
            dispatch(actions.updateReasoningEntry({
              content: data.content,
              timestamp: new Date().toLocaleTimeString(),
            }));
            break;
            
          case 'log':
            dispatch(actions.addLog({
              text: data.content,
              isSystem: data.isSystem,
              timestamp: new Date().toLocaleTimeString(),
            }));
            break;
            
          case 'speech_sentence':
            if (optionsRef.current.onSpeechSentence) {
              optionsRef.current.onSpeechSentence(data.content);
            }
            break;

          case 'intelligent_speech':
            if (optionsRef.current.onIntelligentSpeech) {
              optionsRef.current.onIntelligentSpeech(data.content);
            }
            break;
            
          case 'approval_required':
            dispatch(actions.setApprovalRequest({
              toolCallId: data.toolCallId,
              command: data.command,
            }));
            dispatch(actions.addApprovalHistory({
              id: data.toolCallId,
              command: data.command,
              status: 'pending',
              time: new Date().toLocaleTimeString(),
            }));
            break;
            
          case 'mode_suggestion':
            dispatch(actions.addMessage({
              role: 'assistant',
              content: '⚠️ **Mode Change Required**',
              isModeSuggestion: true,
              suggestedMode: data.mode,
              reason: data.reason,
            }));
            dispatch(actions.addLog({
              text: `Agent suggests switching to "${data.mode}" mode: ${data.reason || 'No reason given.'}`,
              isSystem: true,
              timestamp: new Date().toLocaleTimeString(),
            }));
            dispatch(actions.setStatus('done'));
            break;
            
          case 'edit_permission_request':
            dispatch(actions.setApprovalRequest({
              type: 'edit_permission',
              toolCallId: data.toolCallId,
              toolName: data.toolName,
              paths: data.outsidePaths || [],
              safeZone: data.safeZone,
              command: `Agent (${data.toolName}) accessing: ${(data.outsidePaths || []).join(', ')}`,
            }));
            dispatch(actions.addApprovalHistory({
              id: data.toolCallId,
              command: `${data.toolName} → ${(data.outsidePaths || []).join(', ')}`,
              status: 'pending',
              time: new Date().toLocaleTimeString(),
              type: 'edit_permission',
            }));
            break;
            
          case 'subagent_metrics':
          case 'usage_update':
            dispatch(actions.updateMetrics(data));
            break;

          case 'policy_blocked':
            // The mode_suggestion that follows drives the existing banner; this
            // just adds a precise log line about which capability was blocked.
            dispatch(actions.addLog({
              text: `[Policy] Blocked ${data.toolName} (${data.capability}) in ${data.mode} mode.`,
              isSystem: true,
              timestamp: new Date().toLocaleTimeString(),
            }));
            break;

          case 'scope_denied':
            dispatch(actions.addMessage({
              role: 'assistant',
              content: `🔒 **Read-only device** — ${data.message || 'This device cannot start tasks.'}`,
              isScopeNotice: true,
            }));
            dispatch(actions.setStatus('done'));
            break;

          case 'budget_exceeded':
            dispatch(actions.addMessage({
              role: 'assistant',
              content: `🛑 **Budget reached** — ${data.message || 'Session budget limit hit.'}`,
              isBudgetNotice: true,
            }));
            dispatch(actions.addLog({
              text: `[Budget] ${data.message || 'limit reached'}`,
              isSystem: true,
              timestamp: new Date().toLocaleTimeString(),
            }));
            dispatch(actions.setStatus('done'));
            break;
            
          case 'notification':
            // Headless (channel) runs and other backend events broadcast here.
            dispatch(actions.addLog({
              text: `[${data.severity || 'info'}] ${data.title}${data.body ? ` — ${data.body}` : ''}`,
              isSystem: true,
              timestamp: new Date().toLocaleTimeString(),
            }));
            break;

          case 'screenshot_updated':
            dispatch(actions.setScreenshot(`/screenshots/${data.file}?t=${Date.now()}`));
            break;
            
          case 'error':
            dispatch(actions.addLog({
              text: `[Error] ${data.message}`,
              isError: true,
              timestamp: new Date().toLocaleTimeString(),
            }));
            dispatch(actions.setStatus('error'));
            break;
        }
      } catch (e) {
        // Ignore parse errors on non-JSON messages
      }
    };
    
    ws.onclose = () => {
      setConnectionState('disconnected');
      // Commit any buffered streamed text before we stop.
      if (pendingContentRef.current !== null) {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        flushContent();
      }
      if (unmountedRef.current) return; // deliberate close — don't resurrect

      failedAttemptsRef.current++;
      // Browser WS error events carry no detail by design; the close is the
      // signal. Warn once per outage instead of spamming console.error (which
      // trips Next's dev overlay for an expected, self-healing transient like
      // the backend still booting).
      if (failedAttemptsRef.current === 1) {
        console.warn('Backend WebSocket unavailable — retrying in the background…');
      }
      const delay = Math.min(1000 * 2 ** (failedAttemptsRef.current - 1), 5000);
      reconnectTimerRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      setConnectionState('disconnected'); // onclose follows and handles retry/logging
    };

    socketRef.current = ws;
  }, [backendWsUrl, dispatch, flushContent]);

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    unmountedRef.current = false;
    connect();
    return () => {
      unmountedRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (socketRef.current) socketRef.current.close();
    };
  }, [connect]);
  
  // Keep sessionIdRef in sync
  const setSessionId = useCallback((id) => {
    sessionIdRef.current = id;
  }, []);
  
  const sendMessage = useCallback((data) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(data));
      return true;
    }
    return false;
  }, []);
  
  return { sendMessage, connectionState, setSessionId };
}
