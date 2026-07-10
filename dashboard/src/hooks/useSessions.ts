'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAegisDispatch, useAegisState, actions } from '@/providers/AegisProvider';

const EMPTY_METRICS = { toolCalls: 0, latency: 0, tokens: 0, cost: 0, activeSubagents: [], actionFeed: [] };

/**
 * Sessions loaded from the backend carry metrics in the *persisted* shape
 * (agent-backend/metrics.js: tokens.total, toolCalls.total, latency.totalMs,
 * subagents: [...]) — the reducer and every metrics-displaying component
 * expect the *flat* live-stream shape instead (plain-number tokens/
 * toolCalls/latency, see toFrontendUpdate()). Dumping the persisted shape
 * straight into state renders as "[object Object]" / "NaN" until the next
 * live update happens to overwrite it. Normalize on load instead.
 */
function normalizeMetricsForUI(raw) {
  if (!raw || Object.keys(raw).length === 0) return EMPTY_METRICS;

  // Already flat (e.g. the empty shape createSession/loadSessions seed with).
  if (typeof raw.tokens === 'number' || typeof raw.toolCalls === 'number') {
    return {
      toolCalls: raw.toolCalls || 0,
      latency: raw.latency || 0,
      tokens: raw.tokens || 0,
      cost: raw.cost || 0,
      activeSubagents: raw.activeSubagents || [],
      actionFeed: raw.actionFeed || [],
    };
  }

  // Persisted (nested) shape from the backend DB row.
  return {
    toolCalls: raw.toolCalls?.total || 0,
    latency: raw.latency?.totalMs || 0,
    tokens: raw.tokens?.total || 0,
    cost: raw.cost || 0,
    activeSubagents: (raw.subagents || []).filter((sa) => sa.status === 'spawning' || sa.status === 'working'),
    actionFeed: raw.actionFeed || [],
  };
}

/**
 * useSessions - Session CRUD, persistence, search, grouping.
 */
export function useSessions() {
  const dispatch = useAegisDispatch();
  const { currentSessionId, sessionMode } = useAegisState();

  const [sessions, setSessions] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [hoveredSessionId, setHoveredSessionId] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const debouncedSaveRef = useRef(null);
  const lastSavedRef = useRef(null);

  // ── Load from backend on mount ──
  useEffect(() => {
    loadSessions();
  }, []);

  async function loadSessions() {
    setIsLoading(true);
    let loaded = [];
    try {
      const res = await fetch(`/api/sessions`);
      const data = await res.json();
      if (data.success && data.sessions?.length > 0) {
        loaded = data.sessions;
      }
    } catch {
      // Fallback to localStorage
      try {
        const stored = localStorage.getItem('aegis_sessions');
        if (stored) loaded = JSON.parse(stored);
      } catch {}
    }

    if (loaded.length === 0) {
      const defaultId = `session-${Date.now()}`;
      loaded = [{
        id: defaultId, title: 'New Session',
        messages: [], logs: [], executionPlan: '', reasoningHistory: [],
        metrics: { toolCalls: 0, latency: 0, tokens: 0, cost: 0, activeSubagents: [], actionFeed: [] },
        mode: '', timestamp: Date.now(),
      }];
    }

    setSessions(loaded);

    // Restore from URL param
    const params = new URLSearchParams(window.location.search);
    const urlId = params.get('session');
    const active = urlId ? (loaded.find(s => s.id === urlId) || loaded[0]) : loaded[0];

    dispatch(actions.setCurrentSession(active.id));
    dispatch(actions.setMessages(active.messages || []));
    dispatch(actions.setSessionMode(active.mode || ''));
    dispatch(actions.setMetrics(normalizeMetricsForUI(active.metrics)));
    dispatch(actions.setExecutionPlan(active.executionPlan || ''));

    setIsLoading(false);
  }

  // ── Save helper ──
  const saveSession = useCallback((session, immediate = false) => {
    const stateKey = JSON.stringify({
      messages: session.messages,
      logs: session.logs,
      executionPlan: session.executionPlan,
      metrics: session.metrics,
      mode: session.mode,
    });

    if (stateKey === lastSavedRef.current) return;
    lastSavedRef.current = stateKey;

    const doSave = () => {
      fetch(`/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(session),
      }).catch(() => {});
      try {
        const raw = localStorage.getItem('aegis_sessions');
        if (raw) {
          const list = JSON.parse(raw);
          const next = list.map(s => s.id === session.id ? session : s);
          localStorage.setItem('aegis_sessions', JSON.stringify(next));
        }
      } catch {}
    };

    if (immediate) {
      if (debouncedSaveRef.current) clearTimeout(debouncedSaveRef.current);
      doSave();
    } else {
      if (debouncedSaveRef.current) clearTimeout(debouncedSaveRef.current);
      debouncedSaveRef.current = setTimeout(doSave, 1000);
    }
  }, []);

  // ── Update current session in the list ──
  const updateCurrentSession = useCallback((updates, immediate = false) => {
    setSessions(prev => {
      let updatedSession = null;
      const next = prev.map(s => {
        if (s.id === currentSessionId) {
          let title = s.title;
          if (updates.messages?.length > 0 && s.title === 'New Session') {
            const firstUser = updates.messages.find(m => m.role === 'user');
            if (firstUser) {
              title = firstUser.content.substring(0, 24) + (firstUser.content.length > 24 ? '...' : '');
            }
          }
          updatedSession = { ...s, ...updates, title };
          return updatedSession;
        }
        return s;
      });
      if (updatedSession) setTimeout(() => saveSession(updatedSession, immediate), 0);
      return next;
    });
  }, [currentSessionId, saveSession]);

  // ── Session actions ──
  const createSession = useCallback(async () => {
    const newId = `session-${Date.now()}`;
    const newSession = {
      id: newId, title: 'New Session',
      messages: [], logs: [], executionPlan: '', reasoningHistory: [],
      metrics: { toolCalls: 0, latency: 0, tokens: 0, cost: 0, activeSubagents: [], actionFeed: [] },
      mode: '', timestamp: Date.now(),
    };

    setSessions(prev => [newSession, ...prev]);
    fetch(`/api/sessions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newSession),
    }).catch(() => {});

    dispatch(actions.setCurrentSession(newId));
    dispatch(actions.setMessages([]));
    dispatch(actions.clearLogs());
    dispatch(actions.setExecutionPlan(''));
    dispatch(actions.setMetrics({ toolCalls: 0, latency: 0, tokens: 0, cost: 0, activeSubagents: [], actionFeed: [] }));
    dispatch(actions.setSessionMode(''));
  }, [dispatch]);

  const switchSession = useCallback((sessionId) => {
    // Save current first
    const current = sessions.find(s => s.id === currentSessionId);
    if (current) {
      saveSession(current, true);
    }

    const target = sessions.find(s => s.id === sessionId);
    if (target) {
      dispatch(actions.setCurrentSession(sessionId));
      dispatch(actions.setMessages(target.messages || []));
      dispatch(actions.setSessionMode(target.mode || ''));
      dispatch(actions.setMetrics(normalizeMetricsForUI(target.metrics)));
      dispatch(actions.setExecutionPlan(target.executionPlan || ''));

      // Update URL
      const url = new URL(window.location.href);
      url.searchParams.set('session', sessionId);
      window.history.pushState(null, '', url);
    }
  }, [sessions, currentSessionId, saveSession, dispatch]);

  const deleteSession = useCallback(async (sessionId) => {
    const next = sessions.filter(s => s.id !== sessionId);
    if (sessionId === currentSessionId && next.length > 0) {
      dispatch(actions.setCurrentSession(next[0].id));
      dispatch(actions.setMessages(next[0].messages || []));
      dispatch(actions.setSessionMode(next[0].mode || ''));
    }
    setSessions(next);
    fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' }).catch(() => {});
  }, [sessions, currentSessionId, dispatch]);

  const renameSession = useCallback(async (sessionId, newTitle) => {
    setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, title: newTitle } : s));
    fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle }),
    }).catch(() => {});
  }, []);

  // ── Filter & group ──
  const filteredSessions = sessions.filter(s => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      s.title.toLowerCase().includes(q) ||
      (s.messages || []).some(m => m.content?.toLowerCase().includes(q))
    );
  });

  const groupedSessions = (() => {
    const groups = { Today: [], Yesterday: [], 'Last 7 Days': [], Older: [] };
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    const lastWeek = new Date(today); lastWeek.setDate(lastWeek.getDate() - 7);

    filteredSessions.forEach(s => {
      const ts = new Date(s.timestamp || 0);
      if (ts >= today) groups['Today'].push(s);
      else if (ts >= yesterday) groups['Yesterday'].push(s);
      else if (ts >= lastWeek) groups['Last 7 Days'].push(s);
      else groups['Older'].push(s);
    });
    return Object.entries(groups).filter(([, s]) => s.length > 0);
  })();

  const getSessionPreview = (s) => {
    if (!s.messages?.length) return '';
    const lastAssistant = [...s.messages].reverse().find(m => m.role === 'assistant');
    if (!lastAssistant?.content) return '';
    const clean = lastAssistant.content.replace(/<[^>]*>/g, '').trim();
    return clean.substring(0, 60) + (clean.length > 60 ? '...' : '');
  };

  return {
    sessions, currentSessionId, searchQuery, setSearchQuery,
    groupedSessions, hoveredSessionId, setHoveredSessionId,
    isLoading,
    createSession, switchSession, deleteSession, renameSession,
    updateCurrentSession, getSessionPreview,
  };
}
