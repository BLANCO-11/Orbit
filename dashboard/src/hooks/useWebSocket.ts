'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { useAegisDispatch, actions } from '@/providers/AegisProvider';

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
  const dispatch = useAegisDispatch();
  const socketRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const sessionIdRef = useRef('');
  const failedAttemptsRef = useRef(0);
  const unmountedRef = useRef(false);
  const [connectionState, setConnectionState] = useState('disconnected');

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
    };
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        // Session isolation: ignore events from other sessions
        if (data.sessionId && data.sessionId !== sessionIdRef.current) return;
        
        switch (data.type) {
          case 'status':
            dispatch(actions.setStatus(data.status));
            break;
            
          case 'message':
            dispatch(actions.updateLastMessage({ content: data.content }));
            break;
            
          case 'tool_start':
            dispatch(actions.updateLastMessage({
              tools: data, // handled by ChatMessage's tools array logic
            }));
            dispatch(actions.incrementToolCalls());
            break;
            
          case 'tool_end':
            dispatch(actions.updateLastMessage({
              toolEnd: data, // handled by ChatMessage
            }));
            break;
            
          case 'plan':
            dispatch(actions.setExecutionPlan(data.content));
            break;
            
          case 'reasoning_update':
            dispatch(actions.setExecutionPlan(data.content));
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
            if (options.onSpeechSentence) {
              options.onSpeechSentence(data.content);
            }
            break;
            
          case 'intelligent_speech':
            if (options.onIntelligentSpeech) {
              options.onIntelligentSpeech(data.content);
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
            dispatch(actions.updateMetrics(data));
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
  }, [backendWsUrl, dispatch]);

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    unmountedRef.current = false;
    connect();
    return () => {
      unmountedRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
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
