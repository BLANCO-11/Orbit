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
  reasoningHistory: [],
  
  // Metrics
  metrics: {
    toolCalls: 0, latency: 0, tokens: 0, cost: 0,
    activeSubagents: [], actionFeed: [], latencyPerTool: {},
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
const SET_EXECUTION_PLAN = 'SET_EXECUTION_PLAN';
const ADD_REASONING_GROUP = 'ADD_REASONING_GROUP';
const UPDATE_REASONING_ENTRY = 'UPDATE_REASONING_ENTRY';
const SET_METRICS = 'SET_METRICS';
const UPDATE_METRICS = 'UPDATE_METRICS';
const INCREMENT_TOOL_CALLS = 'INCREMENT_TOOL_CALLS';
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

function aegisReducer(state, action) {
  switch (action.type) {
    case SET_STATUS:
      return { ...state, status: action.payload };
    
    case ADD_MESSAGE:
      return { ...state, messages: [...state.messages, action.payload] };
    
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
    
    case SET_EXECUTION_PLAN:
      return { ...state, executionPlan: action.payload };
    
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

    case UPDATE_METRICS: {
      const next = { ...state.metrics };
      if (action.payload.toolCalls !== undefined) next.toolCalls = action.payload.toolCalls;
      if (action.payload.sessionToolCalls !== undefined) next.toolCalls = action.payload.sessionToolCalls;
      if (action.payload.tokens !== undefined) next.tokens = action.payload.tokens;
      if (action.payload.sessionTokens !== undefined) next.tokens = action.payload.sessionTokens;
      if (action.payload.cost !== undefined) next.cost = action.payload.cost;
      if (action.payload.latency !== undefined) next.latency = action.payload.latency;
      if (action.payload.latencyPerTool !== undefined) next.latencyPerTool = action.payload.latencyPerTool;
      if (action.payload.activeSubagents !== undefined) next.activeSubagents = action.payload.activeSubagents;
      if (action.payload.subagents !== undefined) next.activeSubagents = action.payload.subagents;
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

const AegisStateContext = createContext(null);
const AegisDispatchContext = createContext(null);

export function AegisProvider({ children }) {
  const [state, dispatch] = useReducer(aegisReducer, initialState);
  
  return (
    <AegisStateContext.Provider value={state}>
      <AegisDispatchContext.Provider value={dispatch}>
        {children}
      </AegisDispatchContext.Provider>
    </AegisStateContext.Provider>
  );
}

// ═══════════════════════════════════════════════════════════
// Hooks
// ═══════════════════════════════════════════════════════════

export function useAegisState() {
  const ctx = useContext(AegisStateContext);
  if (!ctx) throw new Error('useAegisState must be used within AegisProvider');
  return ctx;
}

export function useAegisDispatch() {
  const ctx = useContext(AegisDispatchContext);
  if (!ctx) throw new Error('useAegisDispatch must be used within AegisProvider');
  return ctx;
}

export function useAegis() {
  return [useAegisState(), useAegisDispatch()];
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
  setExecutionPlan: (plan) => ({ type: SET_EXECUTION_PLAN, payload: plan }),
  addReasoningGroup: (group) => ({ type: ADD_REASONING_GROUP, payload: group }),
  updateReasoningEntry: (content) => ({ type: UPDATE_REASONING_ENTRY, payload: content }),
  setMetrics: (metrics) => ({ type: SET_METRICS, payload: metrics }),
  updateMetrics: (metrics) => ({ type: UPDATE_METRICS, payload: metrics }),
  incrementToolCalls: () => ({ type: INCREMENT_TOOL_CALLS }),
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
