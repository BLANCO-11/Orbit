'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useOrbitDispatch, useOrbitState, actions } from '@/providers/OrbitProvider';

// The complete flat UI-metrics shape, mirroring the reducer's initial
// state.metrics AND agent-backend/metrics.js toFrontendUpdate(). Every field
// is spelled out so a session switch fully OVERWRITES the reducer's metrics
// (SET_METRICS merges, so any field left out here would silently retain the
// previously-open session's value — the "metrics don't reset between sessions"
// bug). Keep this in sync with both shapes.
const EMPTY_METRICS = {
  toolCalls: 0, latency: 0, tokens: 0, cost: 0,
  tokensIn: 0, tokensOut: 0, tokensReasoning: 0,
  tokensSource: 'estimated', costEstimated: true, turns: [],
  activeSubagents: [], subagentTrace: [], actionFeed: [], latencyPerTool: {},
};

/**
 * Sessions loaded from the backend carry metrics in the *persisted* shape
 * (agent-backend/metrics.js toPersistable: nested tokens.{input,output,
 * reasoning,total,estimated,reported}, toolCalls.total, latency.totalMs,
 * subagents:[...], turns:[...]) — the reducer and every metrics-displaying
 * component expect the *flat* live-stream shape instead (see
 * toFrontendUpdate(): plain-number tokens/tokensIn/tokensOut/…). Dumping the
 * persisted shape straight into state renders as "[object Object]" / "NaN",
 * and dropping fields leaves stale values from the previous session. Produce
 * the FULL flat shape here so the switch is a clean overwrite.
 */
function normalizeMetricsForUI(raw) {
  if (!raw || Object.keys(raw).length === 0) return { ...EMPTY_METRICS };

  // Already flat (live-stream shape, or the empty seed shape). Fill any gaps
  // from EMPTY_METRICS so the payload always carries every field.
  if (typeof raw.tokens === 'number' || typeof raw.toolCalls === 'number') {
    return {
      ...EMPTY_METRICS,
      toolCalls: raw.toolCalls || 0,
      latency: raw.latency || 0,
      tokens: raw.tokens || 0,
      cost: raw.cost || 0,
      tokensIn: raw.tokensIn || 0,
      tokensOut: raw.tokensOut || 0,
      tokensReasoning: raw.tokensReasoning || 0,
      tokensSource: raw.tokensSource || 'estimated',
      costEstimated: raw.costEstimated ?? true,
      turns: raw.turns || [],
      activeSubagents: raw.activeSubagents || [],
      subagentTrace: raw.subagentTrace || raw.subagents || [],
      actionFeed: raw.actionFeed || [],
      latencyPerTool: raw.latencyPerTool || {},
    };
  }

  // Persisted (nested) shape from the backend DB row. Resolve effective tokens
  // the same way metrics.js _effectiveTokens does: reported when the provider
  // sent usage, the running estimate otherwise.
  const t = raw.tokens || {};
  const eff = t.estimated ? t : (t.reported || t);
  const subs = raw.subagents || [];
  return {
    ...EMPTY_METRICS,
    toolCalls: raw.toolCalls?.total || 0,
    latency: raw.latency?.totalMs || 0,
    latencyPerTool: raw.latency?.perTool || {},
    tokens: eff.total || 0,
    tokensIn: eff.input || 0,
    tokensOut: eff.output || 0,
    tokensReasoning: eff.reasoning || 0,
    tokensSource: t.estimated ? 'estimated' : 'reported',
    cost: raw.cost || 0,
    costEstimated: !!t.estimated,
    turns: (raw.turns || []).slice(-12),
    activeSubagents: subs.filter((sa) => sa.status === 'spawning' || sa.status === 'working'),
    subagentTrace: subs,
    actionFeed: raw.actionFeed || [],
  };
}

/**
 * useSessions - Session CRUD, persistence, search, grouping.
 */
export function useSessions() {
  const dispatch = useOrbitDispatch();
  // `liveMetrics` is the reducer's real-time metrics for the OPEN session; the
  // per-session `metrics` in the `sessions` list is only a zero seed. Snapshot
  // live values into the list when leaving a session so switching back shows the
  // right numbers without a round-trip to the backend.
  const { currentSessionId, sessionMode, metrics: liveMetrics, messages: liveMessages, executionPlan: livePlan, logs: liveLogs, planSteps: livePlanSteps, plans: livePlans, activePlanId: liveActivePlanId } = useOrbitState();

  const [sessions, setSessions] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [hoveredSessionId, setHoveredSessionId] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const debouncedSaveRef = useRef(null);
  const lastSavedRef = useRef(null);
  // Mirror of the reducer's current session id, read inside loadSessions without
  // making it a dependency (which would rebuild the callback every switch). Lets
  // a background refresh detect "am I already viewing this session live?" and
  // avoid clobbering the live reducer state.
  const currentSessionIdRef = useRef(currentSessionId);
  useEffect(() => { currentSessionIdRef.current = currentSessionId; }, [currentSessionId]);

  // ── Load from backend on mount ──
  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = useCallback(async () => {
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
        const stored = localStorage.getItem('orbit_sessions');
        if (stored) loaded = JSON.parse(stored);
      } catch {}
    }

    if (loaded.length === 0) {
      const defaultId = `session-${Date.now()}`;
      loaded = [{
        id: defaultId, title: 'New Session',
        messages: [], logs: [], executionPlan: '', reasoningHistory: [],
        metrics: { ...EMPTY_METRICS },
        mode: '', timestamp: Date.now(),
      }];
    }

    setSessions(loaded);

    // Restore from URL: prefer the path form /session/<id>, fall back to the
    // legacy ?session=<id> query (Telegram deep links, saved URLs).
    const pathMatch = window.location.pathname.match(/^\/session\/([^/?#]+)/);
    const urlId = pathMatch
      ? decodeURIComponent(pathMatch[1])
      : new URLSearchParams(window.location.search).get('session');
    const active = urlId ? (loaded.find(s => s.id === urlId) || loaded[0]) : loaded[0];

    // Only hydrate the reducer from the DB snapshot when we're NOT already
    // viewing this session live. A background refresh (e.g. a fleet event, or
    // any future refresh_sessions) must refresh the LIST only — re-dispatching
    // messages/metrics for the session already open would clobber the live,
    // just-streamed reply with the lagging DB copy (the "response vanishes" bug).
    // On the initial mount / a genuine switch, currentSessionId differs, so we
    // hydrate fully and metrics restore from the DB.
    if (currentSessionIdRef.current !== active.id) {
      dispatch(actions.setCurrentSession(active.id));
      dispatch(actions.setMessages(active.messages || []));
      dispatch(actions.setSessionMode(active.mode || ''));
      dispatch(actions.setMetrics(normalizeMetricsForUI(active.metrics)));
      dispatch(actions.setExecutionPlan(active.executionPlan || ''));
      dispatch(actions.setLogs(active.logs || []));
      dispatch(actions.setPlanState({
        steps: active.planSteps || [],
        plans: active.plans || [],
        activePlanId: active.activePlanId || '',
      }));
    }

    setIsLoading(false);
  }, [dispatch]);

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
        const raw = localStorage.getItem('orbit_sessions');
        if (raw) {
          const list = JSON.parse(raw);
          const next = list.map(s => s.id === session.id ? session : s);
          localStorage.setItem('orbit_sessions', JSON.stringify(next));
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
      metrics: { ...EMPTY_METRICS },
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
    dispatch(actions.setMetrics({ ...EMPTY_METRICS }));
    dispatch(actions.setSessionMode(''));
    dispatch(actions.setPlanState({ steps: [], plans: [], activePlanId: '' }));

    // Reflect the new session in the URL (path form).
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('session');
      url.pathname = `/session/${encodeURIComponent(newId)}`;
      window.history.pushState(null, '', url);
    } catch {}
  }, [dispatch]);

  const switchSession = useCallback((sessionId) => {
    // Save current first, snapshotting its live metrics into the list entry so a
    // later switch-back reads the real numbers rather than the zero seed. (The
    // backend ignores client-sent metrics on save — it owns them — so this only
    // affects the in-memory list, not what's persisted.)
    const current = sessions.find(s => s.id === currentSessionId);
    if (current) {
      // Snapshot live reducer state (metrics + the possibly-just-streamed reply)
      // into the outgoing session so switching back shows real numbers and the
      // full conversation — the list otherwise lags reducer state.
      const snapshot = {
        ...current,
        metrics: liveMetrics,
        messages: (liveMessages && liveMessages.length >= (current.messages?.length || 0)) ? liveMessages : current.messages,
        executionPlan: livePlan || current.executionPlan,
        // Snapshot live logs too so switching back shows the outgoing session's
        // activity (logs are session-scoped — they must not bleed across).
        logs: (liveLogs && liveLogs.length) ? liveLogs : current.logs,
        planSteps: (livePlanSteps && livePlanSteps.length) ? livePlanSteps : current.planSteps,
        plans: (livePlans && livePlans.length) ? livePlans : current.plans,
        activePlanId: liveActivePlanId || current.activePlanId,
      };
      setSessions(prev => prev.map(s => (s.id === currentSessionId ? snapshot : s)));
      saveSession(snapshot, true);
    }

    const target = sessions.find(s => s.id === sessionId);
    if (target) {
      dispatch(actions.setCurrentSession(sessionId));
      dispatch(actions.setMessages(target.messages || []));
      dispatch(actions.setSessionMode(target.mode || ''));
      dispatch(actions.setMetrics(normalizeMetricsForUI(target.metrics)));
      dispatch(actions.setExecutionPlan(target.executionPlan || ''));
      dispatch(actions.setLogs(target.logs || []));
      dispatch(actions.setPlanState({
        steps: target.planSteps || [],
        plans: target.plans || [],
        activePlanId: target.activePlanId || '',
      }));

      // Update URL to the path form /session/<id> (drop the legacy query param).
      const url = new URL(window.location.href);
      url.searchParams.delete('session');
      url.pathname = `/session/${encodeURIComponent(sessionId)}`;
      window.history.pushState(null, '', url);
    }
  }, [sessions, currentSessionId, saveSession, dispatch, liveMetrics, liveMessages, livePlan, liveLogs, livePlanSteps, livePlans, liveActivePlanId]);

  const deleteSession = useCallback(async (sessionId) => {
    // Recursively find all child session IDs to remove them from UI state optimistically
    const findChildren = (id, list) => {
      let ids = [id];
      const session = list.find(s => s.id === id);
      const agents = session?.subagentTree?.agents || [];
      for (const agent of agents) {
        if (agent.childSessionId) {
          ids = [...ids, ...findChildren(agent.childSessionId, list)];
        }
      }
      return ids;
    };

    const toDeleteIds = new Set(findChildren(sessionId, sessions));
    const next = sessions.filter(s => !toDeleteIds.has(s.id));

    if (toDeleteIds.has(currentSessionId) && next.length > 0) {
      dispatch(actions.setCurrentSession(next[0].id));
      dispatch(actions.setMessages(next[0].messages || []));
      dispatch(actions.setSessionMode(next[0].mode || ''));
      dispatch(actions.setMetrics(normalizeMetricsForUI(next[0].metrics)));
      dispatch(actions.setLogs(next[0].logs || []));
      dispatch(actions.setPlanState({
        steps: next[0].planSteps || [],
        plans: next[0].plans || [],
        activePlanId: next[0].activePlanId || '',
      }));
    }

    setSessions(next);
    
    try {
      await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
    } catch {}
    
    // Refresh to ensure full synchronization with DB state
    loadSessions();
  }, [sessions, currentSessionId, dispatch, loadSessions]);

  // Clear the local "interrupted / running" flag for a session. The backend
  // owns runState and clears it on agent_end, but the list is loaded once and
  // never re-fetches — so after a resume completes, the stale runState.running
  // would make the interrupted banner reappear. Clear it optimistically.
  const clearRunState = useCallback((sessionId) => {
    setSessions(prev => prev.map(s =>
      s.id === sessionId ? { ...s, runState: { ...(s.runState || {}), running: false } } : s
    ));
  }, []);

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

  // Parent→child / child→parent maps derived from each session's subagent tree.
  // Computed here (memoized) instead of rebuilt inline on every SessionList
  // render (Workstream C3). Keyed on the sessions array identity.
  const sessionTree = useMemo(() => {
    const childToParent = new Map();
    const parentToChildren = new Map();
    const byId = new Map(sessions.map(s => [s.id, s]));
    for (const s of sessions) {
      for (const agent of (s.subagentTree?.agents || [])) {
        if (!agent.childSessionId) continue;
        childToParent.set(agent.childSessionId, s.id);
        const child = byId.get(agent.childSessionId);
        if (child) {
          if (!parentToChildren.has(s.id)) parentToChildren.set(s.id, []);
          parentToChildren.get(s.id).push(child);
        }
      }
    }
    return { childToParent, parentToChildren };
  }, [sessions]);

  useEffect(() => {
    const handleRefresh = () => loadSessions();
    window.addEventListener('orbit:refresh_sessions', handleRefresh);
    return () => window.removeEventListener('orbit:refresh_sessions', handleRefresh);
  }, [loadSessions]);

  return {
    sessions, currentSessionId, searchQuery, setSearchQuery,
    groupedSessions, hoveredSessionId, setHoveredSessionId,
    isLoading,
    createSession, switchSession, deleteSession, renameSession,
    updateCurrentSession, clearRunState,
    childToParent: sessionTree.childToParent,
    parentToChildren: sessionTree.parentToChildren,
  };
}
