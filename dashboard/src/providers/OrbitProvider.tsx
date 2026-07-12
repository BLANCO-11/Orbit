'use client';

import React, { createContext, useContext, useReducer, useCallback } from 'react';

// ═══════════════════════════════════════════════════════════
// State Shape
// ═══════════════════════════════════════════════════════════

const initialState = {
  // Agent state
  status: 'idle',         // idle | thinking | executing | waiting_approval | done | error
  messages: [],
  logs: [],
  executionPlan: '',
  planSteps: [],          // structured checklist from the orbit-plan tool (live Mission board)
  reasoningHistory: [],
  
  // Metrics
  metrics: {
    toolCalls: 0, latency: 0, tokens: 0, cost: 0,
    tokensIn: 0, tokensOut: 0, tokensReasoning: 0,
    tokensSource: 'estimated', costEstimated: true, turns: [],
    activeSubagents: [], subagentTrace: [], actionFeed: [], latencyPerTool: {},
  },
  approvalsHistory: [],
  approvalRequest: null,
  
  // Session
  currentSessionId: '',
  sessionMode: '',
  showModePrompt: false,
  
  // Display
  expandedTools: {},
  visibleCount: 10,
  screenshotFile: null,
  
  // Audio
  voiceState: 'audio',
  isListening: false,
};

// ═══════════════════════════════════════════════════════════
// Action Types
// ═══════════════════════════════════════════════════════════

const SET = 'SET';
const SET_STATUS = 'SET_STATUS';
const ADD_MESSAGE = 'ADD_MESSAGE';
const UPDATE_LAST_MESSAGE = 'UPDATE_LAST_MESSAGE';
const SET_MESSAGES = 'SET_MESSAGES';
const ADD_LOG = 'ADD_LOG';
const CLEAR_LOGS = 'CLEAR_LOGS';
const SET_LOGS = 'SET_LOGS';
const SET_PLAN_STEPS = 'SET_PLAN_STEPS';
const SET_EXECUTION_PLAN = 'SET_EXECUTION_PLAN';
const ADD_REASONING_GROUP = 'ADD_REASONING_GROUP';
const UPDATE_REASONING_ENTRY = 'UPDATE_REASONING_ENTRY';
const SET_METRICS = 'SET_METRICS';
const UPDATE_METRICS = 'UPDATE_METRICS';
const INCREMENT_TOOL_CALLS = 'INCREMENT_TOOL_CALLS';
const TOOL_START = 'TOOL_START';
const TOOL_END = 'TOOL_END';
const REMOVE_MODE_SUGGESTIONS = 'REMOVE_MODE_SUGGESTIONS';
const TOGGLE_TOOL = 'TOGGLE_TOOL';
const SET_VISIBLE_COUNT = 'SET_VISIBLE_COUNT';
const SET_APPROVAL_REQUEST = 'SET_APPROVAL_REQUEST';
const ADD_APPROVAL_HISTORY = 'ADD_APPROVAL_HISTORY';
const UPDATE_APPROVAL_HISTORY = 'UPDATE_APPROVAL_HISTORY';
const SET_CURRENT_SESSION = 'SET_CURRENT_SESSION';
const SET_SESSION_MODE = 'SET_SESSION_MODE';
const SET_SHOW_MODE_PROMPT = 'SET_SHOW_MODE_PROMPT';
const SET_VOICE_STATE = 'SET_VOICE_STATE';
const SET_IS_LISTENING = 'SET_IS_LISTENING';
const SET_SCREENSHOT = 'SET_SCREENSHOT';
const RESET_RUN = 'RESET_RUN';

// ═══════════════════════════════════════════════════════════
// Reducer
// ═══════════════════════════════════════════════════════════

function orbitReducer(state, action) {
  switch (action.type) {
    case SET_STATUS:
      return { ...state, status: action.payload };
    
    case ADD_MESSAGE: {
      // Dedup: don't stack multiple "Mode Change Required" prompts back-to-back
      // (belt-and-suspenders for the backend halt guard).
      const last = state.messages[state.messages.length - 1];
      if (action.payload?.isModeSuggestion && last?.isModeSuggestion) return state;
      return { ...state, messages: [...state.messages, action.payload] };
    }
    
    case UPDATE_LAST_MESSAGE: {
      const lastMsg = state.messages[state.messages.length - 1];
      if (lastMsg && lastMsg.role === 'assistant') {
        return {
          ...state,
          messages: state.messages.map((m, i) =>
            i === state.messages.length - 1 ? { ...m, ...action.payload } : m
          ),
        };
      } else {
        return {
          ...state,
          messages: [...state.messages, { role: 'assistant', ...action.payload }],
        };
      }
    }
    
    case SET_MESSAGES:
      return { ...state, messages: action.payload, visibleCount: 10 };
    
    case ADD_LOG:
      return { ...state, logs: [...state.logs, action.payload] };
    
    case CLEAR_LOGS:
      return { ...state, logs: [] };

    case SET_LOGS:
      return { ...state, logs: Array.isArray(action.payload) ? action.payload : [] };
    
    case SET_EXECUTION_PLAN:
      return { ...state, executionPlan: action.payload };

    case SET_PLAN_STEPS:
      return { ...state, planSteps: Array.isArray(action.payload) ? action.payload : [] };
    
    case ADD_REASONING_GROUP:
      return { ...state, reasoningHistory: [...state.reasoningHistory, action.payload] };
    
    case UPDATE_REASONING_ENTRY: {
      const updated = [...state.reasoningHistory];
      if (updated.length === 0) return state;
      const lastGroup = { ...updated[updated.length - 1] };
      const entries = lastGroup.entries || [];
      if (entries.length === 0) {
        lastGroup.entries = [{ content: action.payload.content, timestamp: action.payload.timestamp }];
      } else {
        const updatedEntries = [...entries];
        updatedEntries[updatedEntries.length - 1] = {
          ...updatedEntries[updatedEntries.length - 1],
          content: action.payload.content,
        };
        lastGroup.entries = updatedEntries;
      }
      updated[updated.length - 1] = lastGroup;
      return { ...state, reasoningHistory: updated };
    }
    
    case SET_METRICS:
      return { ...state, metrics: { ...state.metrics, ...action.payload } };

    case INCREMENT_TOOL_CALLS:
      return { ...state, metrics: { ...state.metrics, toolCalls: (state.metrics.toolCalls || 0) + 1 } };

    // Accumulate tool calls onto the trailing assistant message so they render
    // as inline tool cards. Creates the assistant message if a tool call
    // arrives before any assistant text (the common case for browsing/news).
    case TOOL_START: {
      const t = action.payload;
      const tool = { id: t.toolCallId, name: t.name, arguments: t.arguments || {}, status: 'running' };
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant') {
        const tools = last.tools ? [...last.tools] : [];
        if (!tools.some((x) => x.id === tool.id)) tools.push(tool);
        msgs[msgs.length - 1] = { ...last, tools };
      } else {
        msgs.push({ role: 'assistant', content: '', tools: [tool] });
      }
      return { ...state, messages: msgs };
    }

    case TOOL_END: {
      const t = action.payload;
      const msgs = [...state.messages];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'assistant' && Array.isArray(msgs[i].tools)) {
          const idx = msgs[i].tools.findIndex((x) => x.id === t.toolCallId);
          if (idx !== -1) {
            const tools = [...msgs[i].tools];
            tools[idx] = { ...tools[idx], result: t.result, status: 'done', latencyMs: t.latencyMs };
            msgs[i] = { ...msgs[i], tools };
            break;
          }
        }
      }
      return { ...state, messages: msgs };
    }

    // Drop mode-suggestion cards (e.g. when the user clicks "switch & re-run"),
    // so the fresh streamed answer lands in a clean assistant bubble instead of
    // overwriting — and being hidden behind — the suggestion card.
    case REMOVE_MODE_SUGGESTIONS:
      return { ...state, messages: state.messages.filter((m) => !m.isModeSuggestion) };

    case UPDATE_METRICS: {
      const next = { ...state.metrics };
      if (action.payload.toolCalls !== undefined) next.toolCalls = action.payload.toolCalls;
      if (action.payload.sessionToolCalls !== undefined) next.toolCalls = action.payload.sessionToolCalls;
      if (action.payload.tokens !== undefined) next.tokens = action.payload.tokens;
      if (action.payload.sessionTokens !== undefined) next.tokens = action.payload.sessionTokens;
      if (action.payload.cost !== undefined) next.cost = action.payload.cost;
      if (action.payload.tokensIn !== undefined) next.tokensIn = action.payload.tokensIn;
      if (action.payload.tokensOut !== undefined) next.tokensOut = action.payload.tokensOut;
      if (action.payload.tokensReasoning !== undefined) next.tokensReasoning = action.payload.tokensReasoning;
      if (action.payload.tokensSource !== undefined) next.tokensSource = action.payload.tokensSource;
      if (action.payload.costEstimated !== undefined) next.costEstimated = action.payload.costEstimated;
      if (action.payload.turns !== undefined) next.turns = action.payload.turns;
      if (action.payload.latency !== undefined) next.latency = action.payload.latency;
      if (action.payload.latencyPerTool !== undefined) next.latencyPerTool = action.payload.latencyPerTool;
      if (action.payload.activeSubagents !== undefined) next.activeSubagents = action.payload.activeSubagents;
      // Full tracker summary (all agents incl. completed) — feeds the Trace segment.
      if (action.payload.subagents !== undefined) next.subagentTrace = action.payload.subagents;
      if (action.payload.actionFeed !== undefined) next.actionFeed = action.payload.actionFeed;
      return { ...state, metrics: next };
    }
    
    case TOGGLE_TOOL:
      return {
        ...state,
        expandedTools: {
          ...state.expandedTools,
          [action.payload]: !state.expandedTools[action.payload],
        },
      };
    
    case SET_VISIBLE_COUNT:
      return { ...state, visibleCount: action.payload };
    
    case SET_APPROVAL_REQUEST:
      return { ...state, approvalRequest: action.payload };
    
    case ADD_APPROVAL_HISTORY:
      return { ...state, approvalsHistory: [action.payload, ...state.approvalsHistory] };
    
    case UPDATE_APPROVAL_HISTORY:
      return {
        ...state,
        approvalsHistory: state.approvalsHistory.map(a =>
          a.id === action.payload.id ? { ...a, ...action.payload.updates } : a
        ),
      };
    
    case SET_CURRENT_SESSION:
      return { ...state, currentSessionId: action.payload };
    
    case SET_SESSION_MODE:
      return { ...state, sessionMode: action.payload, showModePrompt: false };
    
    case SET_SHOW_MODE_PROMPT:
      return { ...state, showModePrompt: action.payload };
    
    case SET_VOICE_STATE:
      return { ...state, voiceState: action.payload };
    
    case SET_IS_LISTENING:
      return { ...state, isListening: action.payload };
    
    case SET_SCREENSHOT:
      return { ...state, screenshotFile: action.payload };
    
    case RESET_RUN:
      return {
        ...state,
        logs: [],
        executionPlan: '',
        metrics: { ...state.metrics, latency: 0 },
      };
    
    default:
      return state;
  }
}

// ═══════════════════════════════════════════════════════════
// Context + Provider
// ═══════════════════════════════════════════════════════════

const OrbitStateContext = createContext(null);
const OrbitDispatchContext = createContext(null);

export function OrbitProvider({ children }) {
  const [state, dispatch] = useReducer(orbitReducer, initialState);
  
  return (
    <OrbitStateContext.Provider value={state}>
      <OrbitDispatchContext.Provider value={dispatch}>
        {children}
      </OrbitDispatchContext.Provider>
    </OrbitStateContext.Provider>
  );
}

// ═══════════════════════════════════════════════════════════
// Hooks
// ═══════════════════════════════════════════════════════════

export function useOrbitState() {
  const ctx = useContext(OrbitStateContext);
  if (!ctx) throw new Error('useOrbitState must be used within OrbitProvider');
  return ctx;
}

export function useOrbitDispatch() {
  const ctx = useContext(OrbitDispatchContext);
  if (!ctx) throw new Error('useOrbitDispatch must be used within OrbitProvider');
  return ctx;
}

export function useOrbit() {
  return [useOrbitState(), useOrbitDispatch()];
}

// ═══════════════════════════════════════════════════════════
// Action Creators (convenience)
// ═══════════════════════════════════════════════════════════

export const actions = {
  setStatus: (status) => ({ type: SET_STATUS, payload: status }),
  addMessage: (msg) => ({ type: ADD_MESSAGE, payload: msg }),
  updateLastMessage: (updates) => ({ type: UPDATE_LAST_MESSAGE, payload: updates }),
  setMessages: (msgs) => ({ type: SET_MESSAGES, payload: msgs }),
  addLog: (log) => ({ type: ADD_LOG, payload: log }),
  clearLogs: () => ({ type: CLEAR_LOGS }),
  setLogs: (logs) => ({ type: SET_LOGS, payload: logs }),
  setPlanSteps: (steps) => ({ type: SET_PLAN_STEPS, payload: steps }),
  setExecutionPlan: (plan) => ({ type: SET_EXECUTION_PLAN, payload: plan }),
  addReasoningGroup: (group) => ({ type: ADD_REASONING_GROUP, payload: group }),
  updateReasoningEntry: (content) => ({ type: UPDATE_REASONING_ENTRY, payload: content }),
  setMetrics: (metrics) => ({ type: SET_METRICS, payload: metrics }),
  updateMetrics: (metrics) => ({ type: UPDATE_METRICS, payload: metrics }),
  incrementToolCalls: () => ({ type: INCREMENT_TOOL_CALLS }),
  toolStart: (data) => ({ type: TOOL_START, payload: data }),
  toolEnd: (data) => ({ type: TOOL_END, payload: data }),
  removeModeSuggestions: () => ({ type: REMOVE_MODE_SUGGESTIONS }),
  toggleTool: (id) => ({ type: TOGGLE_TOOL, payload: id }),
  setVisibleCount: (count) => ({ type: SET_VISIBLE_COUNT, payload: count }),
  setApprovalRequest: (req) => ({ type: SET_APPROVAL_REQUEST, payload: req }),
  addApprovalHistory: (entry) => ({ type: ADD_APPROVAL_HISTORY, payload: entry }),
  updateApprovalHistory: (id, updates) => ({ type: UPDATE_APPROVAL_HISTORY, payload: { id, updates } }),
  setCurrentSession: (id) => ({ type: SET_CURRENT_SESSION, payload: id }),
  setSessionMode: (mode) => ({ type: SET_SESSION_MODE, payload: mode }),
  setShowModePrompt: (show) => ({ type: SET_SHOW_MODE_PROMPT, payload: show }),
  setVoiceState: (state) => ({ type: SET_VOICE_STATE, payload: state }),
  setIsListening: (listening) => ({ type: SET_IS_LISTENING, payload: listening }),
  setScreenshot: (file) => ({ type: SET_SCREENSHOT, payload: file }),
  resetRun: () => ({ type: RESET_RUN }),
};
