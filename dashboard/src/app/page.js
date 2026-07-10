"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Mic, Send, XCircle, Volume2, VolumeX, GitBranch, Terminal, Activity, Settings2, MessageSquare, List, BarChart3, Cog } from "lucide-react";
import { marked } from "marked";

// New layout
import AppShell from "@/components/layout/AppShell";
import RightPanelShell from "@/components/layout/RightPanelShell";
import ChatArea from "@/components/chat/ChatArea";
import { useTheme } from "@/hooks/useTheme";

// Existing components
import SessionList from "@/components/SessionList";
import ChatMessage, { ChatEmptyState } from "@/components/ChatMessage";
import ExecutionPlan from "@/components/ExecutionPlan";
import MetricsPanel from "@/components/MetricsPanel";
import LogViewer from "@/components/LogViewer";
import ScreenshotViewer from "@/components/ScreenshotViewer";
import SettingsPanel from "@/components/SettingsPanel";

export default function Dashboard() {
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState("idle");
  const [messages, setMessages] = useState([]);
  const [logs, setLogs] = useState([]);
  const [models, setModels] = useState([]);
  const [voices, setVoices] = useState([]);
  const [executionPlan, setExecutionPlan] = useState("");
  const [reasoningHistory, setReasoningHistory] = useState([]);

  // UI Display Toggles
  const [showThinking, setShowThinking] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  // Tool Call Collapsing States
  const [expandedTools, setExpandedTools] = useState({});
  const toggleTool = (id) => {
    setExpandedTools(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // Right Panel Tabs
  const [rightPanelTab, setRightPanelTab] = useState("control_panel");
  const [metrics, setMetrics] = useState({ toolCalls: 0, latency: 0, tokens: 0, cost: 0, activeSubagents: [], actionFeed: [] });
  const [approvalsHistory, setApprovalsHistory] = useState([]);
  const startTimeRef = useRef(null);

  // Memory & Compaction
  const [autoCompactEnabled, setAutoCompactEnabled] = useState(true);
  const [autoCompactThreshold, setAutoCompactThreshold] = useState(70);

  // Theme
  const { theme, mounted, toggleTheme } = useTheme();

  // Mobile nav tab
  const [activeNavTab, setActiveNavTab] = useState("chat");

  // Security & LiteLLM Config
  const [securityConfig, setSecurityConfig] = useState(null);
  const [baseURL, setBaseURL] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [selectedNormalModel, setSelectedNormalModel] = useState("");
  const [selectedReasoningModel, setSelectedReasoningModel] = useState("");
  const [selectedVoice, setSelectedVoice] = useState("alba");
  const [taskMode, setTaskMode] = useState("hybrid");
  const [systemPromptType, setSystemPromptType] = useState("standard");

  // File Paths
  const [newReadPath, setNewReadPath] = useState("");
  const [newWritePath, setNewWritePath] = useState("");
  const [newBlockedPath, setNewBlockedPath] = useState("");
  const [newAllowedPrefix, setNewAllowedPrefix] = useState("");
  const [newAutoApprove, setNewAutoApprove] = useState("");

  // Approval
  const [approvalRequest, setApprovalRequest] = useState(null);

  // Audio / Speech
  const [isListening, setIsListening] = useState(false);
  const [voiceState, setVoiceState] = useState("audio");
  const [screenshotFile, setScreenshotFile] = useState(null);

  const socketRef = useRef(null);
  const logEndRef = useRef(null);
  const chatEndRef = useRef(null);
  const recognitionRef = useRef(null);
  const audioRef = useRef(null);
  const textareaRef = useRef(null);
  const inputHistoryRef = useRef([]);
  const inputHistoryIndexRef = useRef(-1);
  const modeMenuRef = useRef(null);

  // Streaming TTS
  const spokenSentencesRef = useRef(new Set());
  const ttsQueueRef = useRef([]);
  const currentPlayingIndexRef = useRef(0);
  const isPlayingRef = useRef(false);
  const ttsSessionRef = useRef(null);
  const hasStreamedSentencesRef = useRef(false);

  const [backendHttpUrl, setBackendHttpUrl] = useState("");
  const [backendWsUrl, setBackendWsUrl] = useState("");

  // Resolve backend hosts
  useEffect(() => {
    const backendHost = window.location.hostname || "localhost";
    setBackendHttpUrl(`http://${backendHost}:6800`);
    setBackendWsUrl(`ws://${backendHost}:6800/api/ws`);
  }, []);

  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState("");
  const [hoveredSessionId, setHoveredSessionId] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");

  const currentSessionIdRef = useRef(currentSessionId);
  const updateCurrentSessionRef = useRef(null);
  const voiceStateRef = useRef(voiceState);
  const debouncedSaveTimeoutRef = useRef(null);
  const lastSavedStateRef = useRef(null);
  const fullTtsRequestedRef = useRef(false);

  // Approval mode state
  const [sessionMode, setSessionMode] = useState("");
  const [showModePrompt, setShowModePrompt] = useState(false);
  const sessionModeRef = useRef(sessionMode);
  const [visibleCount, setVisibleCount] = useState(10);

  useEffect(() => {
    sessionModeRef.current = sessionMode;
  }, [sessionMode]);

  const messagesRef = useRef(messages);
  const logsRef = useRef(logs);
  const metricsRef = useRef(metrics);
  const executionPlanRef = useRef(executionPlan);
  const reasoningHistoryRef = useRef(reasoningHistory);

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { logsRef.current = logs; }, [logs]);
  useEffect(() => { metricsRef.current = metrics; }, [metrics]);
  useEffect(() => { executionPlanRef.current = executionPlan; }, [executionPlan]);
  useEffect(() => { reasoningHistoryRef.current = reasoningHistory; }, [reasoningHistory]);

  // ── Save session helper ──
  const saveIfChanged = useCallback((session, immediate = false) => {
    const stateKey = JSON.stringify({
      messages: session.messages,
      logs: session.logs,
      executionPlan: session.executionPlan,
      reasoningHistory: session.reasoningHistory,
      metrics: session.metrics,
      mode: session.mode
    });
    if (stateKey !== lastSavedStateRef.current) {
      lastSavedStateRef.current = stateKey;

      const saveState = () => {
        if (backendHttpUrl) {
          fetch(`${backendHttpUrl}/api/sessions`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(session)
          }).catch(e => console.warn("Failed to save session:", e));
        }
        try {
          const raw = localStorage.getItem("aegis_sessions");
          if (raw) {
            const list = JSON.parse(raw);
            const nextList = list.map(s => s.id === session.id ? session : s);
            localStorage.setItem("aegis_sessions", JSON.stringify(nextList));
          }
        } catch (e) {
          console.warn("Failed to save to localStorage:", e);
        }
      };

      if (immediate) {
        if (debouncedSaveTimeoutRef.current) {
          clearTimeout(debouncedSaveTimeoutRef.current);
          debouncedSaveTimeoutRef.current = null;
        }
        saveState();
      } else {
        if (debouncedSaveTimeoutRef.current) clearTimeout(debouncedSaveTimeoutRef.current);
        debouncedSaveTimeoutRef.current = setTimeout(() => {
          saveState();
          debouncedSaveTimeoutRef.current = null;
        }, 1000);
      }
    }
  }, [backendHttpUrl]);

  // ── Update current session ──
  const updateCurrentSession = useCallback((updatedFields, immediate = false) => {
    const activeId = currentSessionIdRef.current || currentSessionId;
    setTimeout(() => {
      setSessions(prev => {
        let updatedSession = null;
        const next = prev.map(s => {
          if (s.id === activeId) {
            let title = s.title;
            if (updatedFields.messages && updatedFields.messages.length > 0 && s.title === "New Session") {
              const firstUserMsg = updatedFields.messages.find(m => m.role === "user");
              if (firstUserMsg) {
                title = firstUserMsg.content.substring(0, 24) + (firstUserMsg.content.length > 24 ? "..." : "");
              }
            }
            const mode = updatedFields.mode !== undefined ? updatedFields.mode : s.mode || "";
            updatedSession = { ...s, ...updatedFields, title, mode };
            return updatedSession;
          }
          return s;
        });
        if (updatedSession) {
          setTimeout(() => {
            saveIfChanged(updatedSession, immediate);
          }, 0);
        }
        return next;
      });
    }, 0);
  }, [currentSessionId, saveIfChanged]);

  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  useEffect(() => {
    updateCurrentSessionRef.current = updateCurrentSession;
  }, [updateCurrentSession]);

  useEffect(() => {
    voiceStateRef.current = voiceState;
  }, [voiceState]);

  // ── Filter & group sessions ──
  const filteredSessions = sessions.filter(s => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      s.title.toLowerCase().includes(q) ||
      (s.messages || []).some(m => m.content && m.content.toLowerCase().includes(q))
    );
  });

  const groupedSessions = (() => {
    const groups = { "Today": [], "Yesterday": [], "Last 7 Days": [], "Older": [] };
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const lastWeek = new Date(today);
    lastWeek.setDate(lastWeek.getDate() - 7);

    filteredSessions.forEach(s => {
      const ts = new Date(s.timestamp || 0);
      if (ts >= today) groups["Today"].push(s);
      else if (ts >= yesterday) groups["Yesterday"].push(s);
      else if (ts >= lastWeek) groups["Last 7 Days"].push(s);
      else groups["Older"].push(s);
    });
    return Object.entries(groups).filter(([, s]) => s.length > 0);
  })();

  const getSessionPreview = (s) => {
    if (!s.messages || s.messages.length === 0) return "";
    const lastAssistant = [...s.messages].reverse().find(m => m.role === "assistant");
    if (!lastAssistant || !lastAssistant.content) return "";
    const clean = lastAssistant.content.replace(/<[^>]*>/g, "").trim();
    return clean.substring(0, 60) + (clean.length > 60 ? "..." : "");
  };

  // ── Load sessions ──
  useEffect(() => {
    if (!backendHttpUrl) return;
    const loadSessions = async () => {
      let loadedSessions = [];
      try {
        const res = await fetch(`${backendHttpUrl}/api/sessions`);
        const data = await res.json();
        if (data.success && data.sessions && data.sessions.length > 0) {
          loadedSessions = data.sessions;
        }
      } catch (err) {
        console.warn("Backend SQLite DB failed, falling back to localStorage:", err);
        const stored = localStorage.getItem("aegis_sessions");
        if (stored) { try { loadedSessions = JSON.parse(stored); } catch (e) {} }
      }
      if (loadedSessions.length === 0) {
        const defaultId = `session-${Date.now()}`;
        loadedSessions = [{
          id: defaultId, title: "New Session", messages: [], logs: [],
          executionPlan: "", reasoningHistory: [],
          metrics: { toolCalls: 0, latency: 0, tokens: 0, cost: 0, activeSubagents: [], actionFeed: [] },
          timestamp: Date.now()
        }];
        localStorage.setItem("aegis_sessions", JSON.stringify(loadedSessions));
        try { await fetch(`${backendHttpUrl}/api/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(loadedSessions[0]) }); } catch (e) {}
      }
      setSessions(loadedSessions);
      const params = new URLSearchParams(window.location.search);
      const urlSessionId = params.get("session");
      let activeSession = loadedSessions[0];
      if (urlSessionId) {
        const found = loadedSessions.find(s => s.id === urlSessionId);
        if (found) activeSession = found;
      }
      setCurrentSessionId(activeSession.id);
      setMessages(activeSession.messages || []);
      setVisibleCount(10);
      setLogs(activeSession.logs || []);
      setExecutionPlan(activeSession.executionPlan || "");
      setReasoningHistory(activeSession.reasoningHistory || []);
      setMetrics(activeSession.metrics || { toolCalls: 0, latency: 0, tokens: 0, cost: 0, activeSubagents: [], actionFeed: [] });
      setSessionMode(activeSession.mode || "");
    };
    loadSessions();
  }, [backendHttpUrl]);

  // Sync URL with session ID
  useEffect(() => {
    if (currentSessionId && typeof window !== "undefined") {
      const newUrl = `${window.location.pathname}?session=${currentSessionId}`;
      window.history.pushState(null, "", newUrl);
    }
  }, [currentSessionId]);

  // ── Session management ──
  const handleCreateNewSession = async () => {
    if (audioRef.current) { try { audioRef.current.pause(); audioRef.current.src = ""; } catch (err) {} }
    if (typeof window !== "undefined" && window.speechSynthesis) { window.speechSynthesis.cancel(); }
    const currentSession = sessions.find(s => s.id === currentSessionId);
    if (currentSession && backendHttpUrl) {
      fetch(`${backendHttpUrl}/api/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(currentSession) }).catch(e => {});
    }
    const newId = `session-${Date.now()}`;
    const newSession = {
      id: newId, title: "New Session", messages: [], logs: [],
      executionPlan: "", reasoningHistory: [],
      metrics: { toolCalls: 0, latency: 0, tokens: 0, cost: 0, activeSubagents: [], actionFeed: [] },
      mode: "", timestamp: Date.now()
    };
    setSessions(prev => { const next = [newSession, ...prev]; localStorage.setItem("aegis_sessions", JSON.stringify(next)); return next; });
    if (backendHttpUrl) { try { await fetch(`${backendHttpUrl}/api/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newSession) }); } catch (e) {} }
    setCurrentSessionId(newId);
    setMessages([]);
    setVisibleCount(10);
    setLogs([]); setExecutionPlan("");
    setMetrics({ toolCalls: 0, latency: 0, tokens: 0, cost: 0, activeSubagents: [], actionFeed: [] });
    setSessionMode("");
  };

  const handleSwitchSession = (sessionId) => {
    if (audioRef.current) { try { audioRef.current.pause(); audioRef.current.src = ""; } catch (err) {} }
    if (typeof window !== "undefined" && window.speechSynthesis) { window.speechSynthesis.cancel(); }
    
    // ── SESSION SWITCH: First save current session, then kill its agent ──
    const currentSession = sessions.find(s => s.id === currentSessionId);
    if (currentSession && backendHttpUrl) {
      fetch(`${backendHttpUrl}/api/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(currentSession) }).catch(e => {});
    }
    
    // Kill the old session's agent process (prevents cross-contamination)
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ 
        type: "cancel_session", 
        sessionId: currentSessionId 
      }));
      console.log(`[Session Switch] Sent cancel for session ${currentSessionId}`);
    }
    
    // Now load the target session
    const target = sessions.find(s => s.id === sessionId);
    if (target) {
      setCurrentSessionId(sessionId);
      setMessages(target.messages || []);
      setVisibleCount(10);
      setLogs(target.logs || []);
      setExecutionPlan(target.executionPlan || "");
      setReasoningHistory(target.reasoningHistory || []);
      setMetrics(target.metrics || { toolCalls: 0, latency: 0, tokens: 0, cost: 0, activeSubagents: [], actionFeed: [] });
      setSessionMode(target.mode || "");
    }
  };

  const handleDeleteSession = async (sessionId) => {
    setSessions(prev => {
      const next = prev.filter(s => s.id !== sessionId);
      localStorage.setItem("aegis_sessions", JSON.stringify(next));
      if (sessionId === currentSessionId && next.length > 0) {
        setCurrentSessionId(next[0].id);
        setMessages(next[0].messages || []);
        setVisibleCount(10);
        setLogs(next[0].logs || []);
        setExecutionPlan(next[0].executionPlan || "");
        setReasoningHistory(next[0].reasoningHistory || []);
        setMetrics(next[0].metrics || { toolCalls: 0, latency: 0, tokens: 0, cost: 0, activeSubagents: [], actionFeed: [] });
      }
      return next;
    });
    if (backendHttpUrl) { try { await fetch(`${backendHttpUrl}/api/sessions/${sessionId}`, { method: "DELETE" }); } catch (e) {} }
  };

  // ── Manual compact ──
  const handleManualCompact = () => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      alert("WebSocket is not connected.");
      return;
    }
    socketRef.current.send(JSON.stringify({ type: "compact" }));
    setLogs(prev => [...prev, {
      text: "[Client Command] Sent context compaction request to agent.",
      isSystem: true,
      timestamp: new Date().toLocaleTimeString()
    }]);
  };

  // ── Render markdown ──
  const renderMarkdown = (text) => {
    try {
      const abbrevPattern = /\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|approx|dept|est|govt|inc|ltd|co|corp|assn|ave|blvd|rd|st|sq|mt|ft|hr|min|sec|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec|eg|ie)\. /g;
      const abbrMap = {};
      let counter = 0;
      let formatted = (text || "")
        .replace(abbrevPattern, (m) => { const key = "\x00AB" + (counter++) + "\x00"; abbrMap[key] = m; return key; })
        .replace(/([.!?])\s+(?=[A-Z][a-z]{0,}|[0-9"'\[(])/g, "$1\n\n")
        .replace(/([.!?])\s+(?=[-*•])/g, "$1\n\n")
        .replace(/([a-z]):\s+(?=[A-Z"'\[])/g, "$1:\n\n")
        .replace(/\x00AB\d+\x00/g, (m) => abbrMap[m] || m)
        .replace(/\n{3,}/g, "\n\n");
      return { __html: marked.parse(formatted, { breaks: true }) };
    } catch (e) {
      return { __html: text || "" };
    }
  };

  // ── Tool helpers ──
  const getToolSummary = (tool) => {
    const args = tool.arguments || {};
    if (tool.name === "bash") return `Ran shell command: ${args.command || ""}`;
    if (tool.name === "write") return `Created file: ${args.path || ""}`;
    if (tool.name === "edit") return `Edited file: ${args.path || ""}`;
    if (tool.name === "read") return `Read file: ${args.path || ""}`;
    if (tool.name === "find") return `Searched files: ${args.pattern || ""}`;
    if (tool.name.includes("lightpanda")) {
      if (args.url) return `Navigated browser to: ${args.url}`;
      return `Browser action: ${tool.name.replace(/.*lightpanda_/, "")}`;
    }
    return `Called tool: ${tool.name}`;
  };

  const getToolOutput = (result) => {
    if (!result) return "No output returned.";
    if (typeof result === "string") return result;
    if (result.content && Array.isArray(result.content)) {
      return result.content.map(c => c.text || JSON.stringify(c)).join("\n");
    }
    if (result.text) return result.text;
    return JSON.stringify(result, null, 2);
  };

  // ── WebSocket ──
  const connectWebSocket = () => {
    console.log("Connecting to WebSocket...");
    const ws = new WebSocket(backendWsUrl);
    ws.onopen = () => {
      console.log("WebSocket connected.");
      if (currentSessionId) {
        setSessions(prev => { const current = prev.find(s => s.id === currentSessionId); if (current) saveIfChanged(current, true); return prev; });
      }
    };
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      // ── SESSION ISOLATION ──
      // If the event carries a sessionId AND it doesn't match the current session, IGNORE it.
      // This prevents cross-contamination when an old session's agent is still running.
      if (data.sessionId && data.sessionId !== currentSessionIdRef.current) {
        // Silently ignore events from other sessions to prevent cross-contamination
        return;
      }
      
      switch (data.type) {
        case "status":
          setStatus(data.status);
          if (data.status === "done" && startTimeRef.current) {
            const elapsed = ((Date.now() - startTimeRef.current) / 1000).toFixed(1);
            
            // 1. Update Metrics State
            setMetrics(prev => ({ ...prev, latency: elapsed }));
            
            // 2. Update Messages State
            setMessages(prevMsgs => {
              const nextMsgs = [...prevMsgs];
              if (nextMsgs.length > 0 && nextMsgs[nextMsgs.length - 1].role === "assistant") {
                nextMsgs[nextMsgs.length - 1] = { 
                  ...nextMsgs[nextMsgs.length - 1], 
                  latency: elapsed 
                };
              }
              return nextMsgs;
            });
            
            // 3. Save final state immediately on the next tick using refs
            setTimeout(() => {
              updateCurrentSessionRef.current({
                metrics: { ...metricsRef.current, latency: elapsed },
                messages: messagesRef.current.map((m, idx) => {
                  if (idx === messagesRef.current.length - 1 && m.role === "assistant") {
                    return { ...m, latency: elapsed };
                  }
                  return m;
                }),
                logs: logsRef.current,
                executionPlan: executionPlanRef.current,
                reasoningHistory: reasoningHistoryRef.current
              }, true);
            }, 0);
          }
          break;
        case "message":
          setMessages(prev => {
            const next = [...prev];
            if (next.length > 0 && next[next.length - 1].role === "assistant") {
              next[next.length - 1] = { ...next[next.length - 1], content: data.content };
            } else {
              next.push({ role: data.role, content: data.content });
            }
            return next;
          });
          setMetrics(prev => {
            if (data.sessionTokens !== undefined) return prev;
            const totalCharCount = data.content.length + (prompt ? prompt.length : 0);
            const estimatedTokens = Math.round(totalCharCount / 3.8);
            return { ...prev, tokens: prev.tokens || estimatedTokens, cost: prev.cost || (estimatedTokens * 0.000002).toFixed(6) };
          });
          break;
        case "tool_start":
          setMessages(prev => {
            const next = [...prev];
            let lastIndex = next.findLastIndex(m => m.role === "assistant");
            if (lastIndex === -1) { next.push({ role: "assistant", content: "", tools: [] }); lastIndex = next.length - 1; }
            const msg = next[lastIndex];
            const tools = msg.tools || [];
            const updatedTools = [...tools.filter(t => t.id !== data.toolCallId), { id: data.toolCallId, name: data.name, arguments: data.arguments, status: "running" }];
            next[lastIndex] = { ...msg, tools: updatedTools };
            return next;
          });
          setMetrics(prev => {
            const startToolSummary = getToolSummary({ name: data.name, arguments: data.arguments });
            const next = { ...prev, toolCalls: prev.toolCalls + 1, actionFeed: [{ timestamp: new Date().toLocaleTimeString(), text: startToolSummary, type: "start", id: data.toolCallId }, ...prev.actionFeed] };
            if (data.name === "subagent") {
              const saPrompt = data.arguments?.prompt || "Task execution";
              const subagentName = "Subagent (" + (saPrompt.substring(0, 24) + (saPrompt.length > 24 ? "..." : "")) + ")";
              next.activeSubagents = [{ id: data.toolCallId, name: subagentName, status: "active", time: new Date().toLocaleTimeString() }, ...prev.activeSubagents];
            }
            return next;
          });
          setTimeout(() => {
            updateCurrentSessionRef.current({
              messages: messagesRef.current,
              metrics: metricsRef.current
            });
          }, 0);
          break;
        case "tool_end":
          setMessages(prev => {
            const next = [...prev];
            let lastIndex = next.findLastIndex(m => m.role === "assistant");
            if (lastIndex === -1) { next.push({ role: "assistant", content: "", tools: [] }); lastIndex = next.length - 1; }
            const msg = next[lastIndex];
            const tools = msg.tools || [];
            const updatedTools = tools.map(t => t.id === data.toolCallId ? { ...t, result: data.result, status: "done" } : t);
            next[lastIndex] = { ...msg, tools: updatedTools };
            return next;
          });
          setMetrics(prev => {
            const next = { ...prev, actionFeed: prev.actionFeed.map(feed => feed.id === data.toolCallId ? { ...feed, type: "end", timestampEnd: new Date().toLocaleTimeString() } : feed) };
            if (data.name === "subagent") { next.activeSubagents = prev.activeSubagents.map(sa => sa.id === data.toolCallId ? { ...sa, status: "completed", timeEnd: new Date().toLocaleTimeString() } : sa); }
            return next;
          });
          setTimeout(() => {
            updateCurrentSessionRef.current({
              messages: messagesRef.current,
              metrics: metricsRef.current
            });
          }, 0);
          break;
        case "intelligent_speech":
          if (voiceStateRef.current === "audio") {
            const summarySentences = data.content.replace(/[*#`_\-\[\]]/g, "").split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 3);
            summarySentences.forEach(sentence => { if (!spokenSentencesRef.current.has(sentence)) { spokenSentencesRef.current.add(sentence); queueSentenceTTS(sentence); } });
            hasStreamedSentencesRef.current = true;
          }
          break;
        case "speech_sentence":
          if (voiceStateRef.current === "audio" && data.content && data.content.trim().length > 2) {
            hasStreamedSentencesRef.current = true;
            queueSentenceTTS(data.content.trim());
          }
          break;
        case "speech_tool":
          break;
        case "speech":
          break;
        case "plan":
          setExecutionPlan(data.content);
          break;
        case "log":
          setLogs(prev => [...prev, { text: data.content, isSystem: data.isSystem, timestamp: new Date().toLocaleTimeString() }]);
          const tokenMatch = data.content.match(/(?:tokens|token|tkn)\s*(?:used|usage|volume)?[:\s\-\=]+\s*(\d+)/i);
          if (tokenMatch) {
            const saTokens = parseInt(tokenMatch[1]);
            setMetrics(prev => ({ ...prev, tokens: prev.tokens + saTokens, cost: ((prev.tokens + saTokens) * 0.000002).toFixed(5) }));
          }
          if (data.content.includes("Spawning") || data.content.includes("spawning")) {
            let subagentName = "Subagent";
            if (data.content.includes("warmup")) subagentName = "Warmup Agent";
            if (data.content.includes("CLI session")) subagentName = "CLI Execution Agent";
            if (data.content.includes("Orchestrate planning")) subagentName = "Roadmap Planner Agent";
            setMetrics(prev => {
              if (prev.activeSubagents.some(sa => sa.name === subagentName && sa.status === "active")) return prev;
              return { ...prev, activeSubagents: [{ name: subagentName, status: "active", time: new Date().toLocaleTimeString() }, ...prev.activeSubagents] };
            });
          }
          if (data.content.includes("completed") || data.content.includes("exited")) {
            setMetrics(prev => ({ ...prev, activeSubagents: prev.activeSubagents.map(sa => sa.status === "active" ? { ...sa, status: "completed", timeEnd: new Date().toLocaleTimeString() } : sa) }));
          }
          break;
        case "approval_required":
          setApprovalRequest({ toolCallId: data.toolCallId, command: data.command });
          setApprovalsHistory(prev => [{ id: data.toolCallId, command: data.command, status: "pending", time: new Date().toLocaleTimeString() }, ...prev]);
          break;
        case "mode_suggestion":
          setMessages(prev => [
            ...prev,
            {
              role: "assistant",
              content: `⚠️ **Mode Change Required**`,
              isModeSuggestion: true,
              suggestedMode: data.mode,
              reason: data.reason
            }
          ]);
          setLogs(prev => [...prev, { text: `Agent suggests switching to "${data.mode}" mode: ${data.reason || "No reason given."}`, isSystem: true, timestamp: new Date().toLocaleTimeString() }]);
          setStatus("done");
          setTimeout(() => {
            updateCurrentSessionRef.current({
              messages: messagesRef.current,
              logs: logsRef.current
            });
          }, 0);
          break;
        case "edit_permission_request":
          setApprovalRequest({ type: "edit_permission", toolCallId: data.toolCallId, toolName: data.toolName, paths: data.outsidePaths || [], safeZone: data.safeZone, command: `Agent (${data.toolName}) accessing: ${(data.outsidePaths || []).join(", ")}\nSafe zone: ${data.safeZone}` });
          setApprovalsHistory(prev => [{ id: data.toolCallId, command: `${data.toolName} → ${(data.outsidePaths || []).join(", ")}`, status: "pending", time: new Date().toLocaleTimeString(), type: "edit_permission" }, ...prev]);
          break;
        case "subagent_metrics":
          if (data.sessionTokens !== undefined) {
            setMetrics(prev => ({ ...prev, tokens: data.sessionTokens, toolCalls: data.sessionToolCalls || prev.toolCalls, activeSubagents: data.subagents || prev.activeSubagents, cost: (data.sessionTokens * 0.000002).toFixed(6) }));
          } else {
            setMetrics(prev => {
              const next = { ...prev };
              if (data.subagents) next.activeSubagents = data.subagents;
              return next;
            });
          }
          break;
        case "reasoning_update":
          setExecutionPlan(data.content);
          setReasoningHistory(prev => {
            if (prev.length === 0) return prev;
            const updated = [...prev];
            const lastGroup = { ...updated[updated.length - 1] };
            const entries = lastGroup.entries || [];
            if (entries.length === 0) {
              lastGroup.entries = [{ content: data.content, timestamp: new Date().toLocaleTimeString() }];
            } else {
              const updatedEntries = [...entries];
              updatedEntries[updatedEntries.length - 1] = {
                ...updatedEntries[updatedEntries.length - 1],
                content: data.content
              };
              lastGroup.entries = updatedEntries;
            }
            updated[updated.length - 1] = lastGroup;
            return updated;
          });
          break;
        case "screenshot_updated":
          setScreenshotFile(`${backendHttpUrl}/screenshots/${data.file}?t=${Date.now()}`);
          break;
        case "error":
          setLogs(prev => [...prev, { text: `[Error] ${data.message}`, isError: true, timestamp: new Date().toLocaleTimeString() }]);
          setStatus("error");
          break;
        default:
          break;
      }
    };
    ws.onclose = () => { console.log("WebSocket closed. Reconnecting..."); setStatus("error"); setTimeout(connectWebSocket, 5000); };
    ws.onerror = (err) => { console.error("WebSocket error:", err); setStatus("error"); };
    socketRef.current = ws;
  };

  // ── TTS ──
  const queueSentenceTTS = (sentence) => {
    spokenSentencesRef.current.add(sentence);
    const queueItem = { sentence, audioUrl: null, status: "pending", session: ttsSessionRef.current };
    ttsQueueRef.current.push(queueItem);
    fetch(`${backendHttpUrl}/api/tts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: sentence, voice: selectedVoice }) })
      .then(res => { if (!res.ok) throw new Error("TTS failed"); return res.blob(); })
      .then(blob => { if (ttsSessionRef.current === queueItem.session) { queueItem.audioUrl = URL.createObjectURL(blob); queueItem.status = "ready"; playStreamingTTSQueue(); } })
      .catch(err => { console.error("Streaming TTS error:", err); if (ttsSessionRef.current === queueItem.session) { queueItem.status = "failed"; playStreamingTTSQueue(); } });
  };

  const playStreamingTTSQueue = () => {
    if (isPlayingRef.current) return;
    if (currentPlayingIndexRef.current >= ttsQueueRef.current.length) return;
    const nextItem = ttsQueueRef.current[currentPlayingIndexRef.current];
    if (nextItem.session !== ttsSessionRef.current) { currentPlayingIndexRef.current++; playStreamingTTSQueue(); return; }
    if (nextItem.status === "ready") {
      isPlayingRef.current = true;
      const audio = new Audio(nextItem.audioUrl);
      audioRef.current = audio;
      audio.play().catch(err => { console.error("Streaming playback failed:", err); isPlayingRef.current = false; currentPlayingIndexRef.current++; playStreamingTTSQueue(); });
      audio.onended = () => { isPlayingRef.current = false; currentPlayingIndexRef.current++; playStreamingTTSQueue(); };
    } else if (nextItem.status === "failed") { currentPlayingIndexRef.current++; playStreamingTTSQueue(); }
  };

  const speakText = async (text) => {
    if (hasStreamedSentencesRef.current) {
      const fallbackSentences = text.replace(/[*#`_\-\[\]]/g, "").split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 3 && !spokenSentencesRef.current.has(s));
      fallbackSentences.forEach(sentence => { spokenSentencesRef.current.add(sentence); queueSentenceTTS(sentence); });
      return;
    }
    try {
      if (audioRef.current) { try { audioRef.current.pause(); audioRef.current.src = ""; } catch (err) {} }
      if (typeof window !== "undefined" && window.speechSynthesis) { window.speechSynthesis.cancel(); }
      const cleanText = text.replace(/[*#`_\-]/g, "").replace(/\[.*?\]\(.*?\)/g, "");
      if (typeof window !== "undefined") {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) { try { const ctx = new AudioContext(); const osc = ctx.createOscillator(); const gain = ctx.createGain(); gain.gain.value = 0; osc.connect(gain); gain.connect(ctx.destination); osc.start(0); osc.stop(0.05); } catch (e) {} }
      }
      const sentences = cleanText.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 2);
      if (sentences.length === 0) return;
      const playQueue = new Array(sentences.length).fill(null);
      const statusQueue = new Array(sentences.length).fill("pending");
      let currentPlayingIndex = 0;
      let isPlaying = false;
      const currentSessionRef = Symbol("tts-session");
      audioRef.currentSession = currentSessionRef;
      const playNextInQueue = () => {
        if (audioRef.currentSession !== currentSessionRef) return;
        if (currentPlayingIndex >= sentences.length) { isPlaying = false; return; }
        const status = statusQueue[currentPlayingIndex];
        if (status === "ready") {
          isPlaying = true;
          const audio = new Audio(playQueue[currentPlayingIndex]);
          audioRef.current = audio;
          audio.play().catch(err => { console.error("Audio playback failed:", err); currentPlayingIndex++; playNextInQueue(); });
          audio.onended = () => { currentPlayingIndex++; playNextInQueue(); };
        } else if (status === "failed") { currentPlayingIndex++; playNextInQueue(); } else { isPlaying = false; }
      };
      sentences.forEach(async (sentence, index) => {
        try {
          const response = await fetch(`${backendHttpUrl}/api/tts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: sentence, voice: selectedVoice }) });
          if (!response.ok) throw new Error("TTS failed");
          const blob = await response.blob();
          const audioUrl = URL.createObjectURL(blob);
          if (audioRef.currentSession === currentSessionRef) { playQueue[index] = audioUrl; statusQueue[index] = "ready"; if (index === currentPlayingIndex && !isPlaying) playNextInQueue(); }
        } catch (e) { console.error("Sentence TTS fetch error:", e); if (audioRef.currentSession === currentSessionRef) { statusQueue[index] = "failed"; if (index === currentPlayingIndex && !isPlaying) playNextInQueue(); } }
      });
    } catch (e) {
      console.error("Local TTS failed, falling back to browser SpeechSynthesis:", e);
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
        setTimeout(() => {
          const cleanText = text.replace(/[*#`_\-]/g, "").replace(/\[.*?\]\(.*?\)/g, "").substring(0, 300);
          const utterance = new SpeechSynthesisUtterance(cleanText);
          window.activeUtterance = utterance;
          window.speechSynthesis.speak(utterance);
        }, 100);
      }
    }
  };

  // ── Speech recognition ──
  const toggleListening = () => {
    if (!recognitionRef.current) {
      alert("Speech recognition is not supported in this browser.");
      return;
    }
    if (isListening) { recognitionRef.current.stop(); }
    else { if (typeof window !== "undefined") window.speechSynthesis.cancel(); recognitionRef.current.start(); }
  };

  // ── Fetch configs & start WebSocket ──
  useEffect(() => {
    if (!backendHttpUrl || !backendWsUrl) return;
    fetchConfig();
    fetchVoicesList();
    connectWebSocket();
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const rec = new SpeechRecognition();
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = "en-US";
      rec.onstart = () => setIsListening(true);
      rec.onresult = (event) => { const text = event.results[0][0].transcript; setPrompt(text); handleSubmitPrompt(text); };
      rec.onerror = (event) => { console.error("Speech recognition error:", event.error); setIsListening(false); };
      rec.onend = () => setIsListening(false);
      recognitionRef.current = rec;
    }
    return () => { if (socketRef.current) socketRef.current.close(); };
  }, [backendHttpUrl, backendWsUrl]);

  useEffect(() => {
    if (showThinking) logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, showThinking]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const fetchConfig = () => {
    fetch(`${backendHttpUrl}/api/config`).then(res => res.json()).then(data => {
      setSecurityConfig(data);
      if (data.litellm) {
        setBaseURL(data.litellm.baseURL || "");
        setApiKey(data.litellm.apiKey || "");
        setSelectedNormalModel(data.litellm.selectedNormalModel || "");
        setSelectedReasoningModel(data.litellm.selectedReasoningModel || "");
        setTaskMode(data.litellm.taskMode || "hybrid");
      }
      if (data.systemPromptType) {
        setSystemPromptType(data.systemPromptType);
      }
      fetchModels();
    }).catch(err => console.error("Error loading config:", err));
  };

  const fetchModels = () => {
    fetch(`${backendHttpUrl}/api/models`).then(res => res.json()).then(data => setModels(data)).catch(err => console.error("Error loading models:", err));
  };

  const fetchVoicesList = () => {
    fetch(`${backendHttpUrl}/api/voices`).then(res => res.json()).then(data => { setVoices(data); if (data.length > 0) { const hasAlba = data.find(v => v.id === "alba"); setSelectedVoice(hasAlba ? "alba" : data[0].id); } }).catch(err => console.error("Error loading voices:", err));
  };

  // ── Submit prompt ──
  const handleSubmitPrompt = (overridePrompt) => {
    const finalPrompt = overridePrompt || prompt;
    if (!finalPrompt.trim()) return;
    const currentMode = sessionModeRef.current || (sessions.find(s => s.id === currentSessionId)?.mode) || "";
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) { alert("WebSocket is not connected."); return; }
    if (audioRef.current) { try { audioRef.current.pause(); audioRef.current.src = ""; } catch (err) {} }
    if (typeof window !== "undefined" && window.speechSynthesis) { window.speechSynthesis.cancel(); }
    startTimeRef.current = Date.now();
    setMetrics(prev => ({ ...prev, latency: 0 }));
    ttsSessionRef.current = Symbol("streaming-tts");
    spokenSentencesRef.current = new Set();
    ttsQueueRef.current = [];
    currentPlayingIndexRef.current = 0;
    isPlayingRef.current = false;
    hasStreamedSentencesRef.current = false;
    const nextMsg = [...messages, { role: "user", content: finalPrompt }];
    setMessages(nextMsg);
    setLogs([]);
    setExecutionPlan("");
    setReasoningHistory(prev => [...prev, { query: finalPrompt, queryTimestamp: new Date().toLocaleTimeString(), entries: [] }]);
    setPrompt("");
    updateCurrentSession({ messages: nextMsg, logs: [], executionPlan: "" }, true);
    socketRef.current.send(JSON.stringify({ type: "start_task", prompt: finalPrompt, systemPromptType, sessionId: currentSessionId, mode: currentMode }));
  };

  const handleStopAgent = () => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "cancel", sessionId: currentSessionId }));
      setLogs(prev => [...prev, { text: "[Client Command] Sent interruption request to stop the active agent process.", isSystem: true, timestamp: new Date().toLocaleTimeString() }]);
    }
  };

  const handleApproval = (approved) => {
    if (!approvalRequest) return;
    if (approvalRequest.type === "edit_permission") {
      socketRef.current.send(JSON.stringify({ type: "edit_permission_response", toolCallId: approvalRequest.toolCallId, decision: approved, path: (approvalRequest.paths || [])[0] || "" }));
      setApprovalsHistory(prev => prev.map(app => app.id === approvalRequest.toolCallId ? { ...app, status: approved === "deny" ? "denied" : "approved" } : app));
      setApprovalRequest(null);
      return;
    }
    socketRef.current.send(JSON.stringify({ type: "approval_response", toolCallId: approvalRequest.toolCallId, approved }));
    setApprovalsHistory(prev => prev.map(app => app.id === approvalRequest.toolCallId ? { ...app, status: approved ? "approved" : "denied" } : app));
    setApprovalRequest(null);
  };

  // ── Set session mode ──
  const handleSetSessionMode = (mode) => {
    setSessionMode(mode);
    setShowModePrompt(false);
    updateCurrentSession({ mode }, true);
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "mode_switch", sessionId: currentSessionId, mode }));
      setLogs(prev => [...prev, { text: `Mode switched to "${mode || "chat"}" — agent will use new behavior on next prompt.`, isSystem: true, timestamp: new Date().toLocaleTimeString() }]);
    }
    const pendingText = prompt.trim();
    if (pendingText) { setTimeout(() => handleSubmitPrompt(pendingText), 100); }
  };

  const handleSetSessionModeAndReRun = (mode) => {
    setSessionMode(mode);
    setShowModePrompt(false);
    updateCurrentSession({ mode }, true);
    
    // Find the last user prompt to re-run
    const userMsgs = messages.filter(m => m.role === "user");
    const lastUserPrompt = userMsgs.length > 0 ? userMsgs[userMsgs.length - 1].content : null;
    
    // Clean up the mode suggestion message from history
    setMessages(prev => {
      const cleanMsgs = [...prev];
      if (cleanMsgs.length > 0 && cleanMsgs[cleanMsgs.length - 1].isModeSuggestion) {
        cleanMsgs.pop();
      }
      return cleanMsgs;
    });
    
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      // Use the unified mode_switch_rerun RPC for atomic mode switch + re-run
      setLogs(prev => [...prev, { text: `Mode switched to "${mode || "chat"}" and prompt is being re-run.`, isSystem: true, timestamp: new Date().toLocaleTimeString() }]);
      
      // Reset metrics for fresh run
      startTimeRef.current = Date.now();
      setMetrics(prev => ({ ...prev, latency: 0 }));
      ttsSessionRef.current = Symbol("streaming-tts");
      spokenSentencesRef.current = new Set();
      ttsQueueRef.current = [];
      currentPlayingIndexRef.current = 0;
      isPlayingRef.current = false;
      hasStreamedSentencesRef.current = false;
      setLogs([]);
      setExecutionPlan("");
      
      socketRef.current.send(JSON.stringify({
        type: "mode_switch_rerun",
        sessionId: currentSessionId,
        mode: mode,
        prompt: lastUserPrompt,
        systemPromptType
      }));
    }
  };

  const handleLoadOlderMessages = (container) => {
    if (container && visibleCount < messages.length) {
      const previousScrollHeight = container.scrollHeight;
      setVisibleCount(prev => Math.min(prev + 10, messages.length));
      
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight - previousScrollHeight;
      });
    }
  };

  const handleSetSystemPromptType = (type) => {
    setSystemPromptType(type);
    if (securityConfig) {
      const updatedConfig = { ...securityConfig, systemPromptType: type };
      fetch(`${backendHttpUrl}/api/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedConfig)
      }).then(res => res.json()).then(result => {
        if (result.success) {
          setSecurityConfig(updatedConfig);
        }
      }).catch(err => console.error("Error saving prompt type:", err));
    }
  };

  // ── Save settings ──
  const saveAllSettings = () => {
    const updatedConfig = { ...securityConfig, systemPromptType, litellm: { baseURL, apiKey, selectedNormalModel, selectedReasoningModel, taskMode } };
    fetch(`${backendHttpUrl}/api/config`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updatedConfig) })
      .then(res => res.json()).then(data => { if (data.success) { setSecurityConfig(updatedConfig); alert("Settings saved successfully."); fetchModels(); } else { alert(`Error saving configurations: ${data.message}`); } })
      .catch(err => alert("Error saving configurations:", err));
  };

  const addConfigItem = (field, subfield, val, setVal) => {
    if (!val.trim()) return;
    const updated = { ...securityConfig };
    updated[field][subfield].push(val.trim());
    setSecurityConfig(updated);
    setVal("");
  };

  const removeConfigItem = (field, subfield, index) => {
    const updated = { ...securityConfig };
    updated[field][subfield].splice(index, 1);
    setSecurityConfig(updated);
  };

  const getStatusColor = () => {
    switch (status) {
      case "thinking": return "var(--accent-info)";
      case "executing": return "var(--accent-primary)";
      case "waiting_approval": return "var(--accent-warning)";
      case "done": return "var(--accent-success)";
      case "error": return "var(--accent-danger)";
      default: return "var(--text-tertiary)";
    }
  };

  // ── Get status label ──
  const getStatusLabel = () => {
    switch (status) {
      case "thinking": return "Thinking";
      case "executing": return "Executing";
      case "waiting_approval": return "Awaiting Approval";
      case "done": return "Done";
      case "error": return "Error";
      default: return "Idle";
    }
  };

  // ── Mobile bottom nav items ──
  const bottomNavItems = [
    { id: 'chat', label: 'Chat', icon: <MessageSquare size={18} /> },
    { id: 'logs', label: 'Logs', icon: <List size={18} /> },
    { id: 'metrics', label: 'Metrics', icon: <BarChart3 size={18} /> },
    { id: 'settings', label: 'Settings', icon: <Cog size={18} /> },
  ];

  const handleNavTabChange = (tabId) => {
    setActiveNavTab(tabId);
    if (tabId === 'logs' || tabId === 'metrics' || tabId === 'settings') {
      setShowThinking(true);
      setRightPanelTab(tabId === 'logs' ? 'console' : tabId === 'metrics' ? 'control_panel' : 'settings');
    }
  };

  // ── JSX ──
  return (
    <AppShell
      sidebar={
        <SessionList
          sessions={sessions}
          currentSessionId={currentSessionId}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          groupedSessions={groupedSessions}
          hoveredSessionId={hoveredSessionId}
          onHover={setHoveredSessionId}
          onLeave={() => setHoveredSessionId(null)}
          onSwitch={handleSwitchSession}
          onDelete={handleDeleteSession}
          onNewSession={handleCreateNewSession}
          getSessionPreview={getSessionPreview}
          sessionsLength={sessions.length}
        />
      }
      rightPanel={
        <RightPanelShell
          activeTab={rightPanelTab}
          onTabChange={setRightPanelTab}
          show={showThinking}
        >
          {rightPanelTab === "roadmap" && (
            <ExecutionPlan executionPlan={executionPlan} reasoningHistory={reasoningHistory} />
          )}
          {rightPanelTab === "console" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)", height: "100%" }}>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
                <div className="text-h4" style={{ marginBottom: "var(--space-2)" }}>
                  System Output Logs
                </div>
                <div
                  className="surface-secondary"
                  style={{
                    flex: 1,
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <LogViewer logs={logs} logEndRef={logEndRef} />
                </div>
              </div>
              {screenshotFile && (
                <div style={{ height: "200px", display: "flex", flexDirection: "column", flexShrink: 0 }}>
                  <div className="text-h4" style={{ marginBottom: "var(--space-2)" }}>
                    Browser State
                  </div>
                  <ScreenshotViewer screenshotFile={screenshotFile} />
                </div>
              )}
            </div>
          )}
          {rightPanelTab === "control_panel" && (
            <MetricsPanel metrics={metrics} status={status} approvalsHistory={approvalsHistory} />
          )}
          {rightPanelTab === "settings" && (
            <SettingsPanel
              securityConfig={securityConfig}
              setSecurityConfig={setSecurityConfig}
              baseURL={baseURL}
              setBaseURL={setBaseURL}
              apiKey={apiKey}
              setApiKey={setApiKey}
              selectedNormalModel={selectedNormalModel}
              setSelectedNormalModel={setSelectedNormalModel}
              selectedReasoningModel={selectedReasoningModel}
              setSelectedReasoningModel={setSelectedReasoningModel}
              selectedVoice={selectedVoice}
              setSelectedVoice={setSelectedVoice}
              taskMode={taskMode}
              setTaskMode={setTaskMode}
              systemPromptType={systemPromptType}
              setSystemPromptType={setSystemPromptType}
              voiceResponse={voiceState === "audio"}
              setVoiceResponse={(val) => setVoiceState(val ? "audio" : "disabled")}
              autoCompactEnabled={autoCompactEnabled}
              setAutoCompactEnabled={setAutoCompactEnabled}
              autoCompactThreshold={autoCompactThreshold}
              setAutoCompactThreshold={setAutoCompactThreshold}
              models={models}
              voices={voices}
              onSave={saveAllSettings}
              onManualCompact={handleManualCompact}
              onAddConfigItem={addConfigItem}
              onRemoveConfigItem={removeConfigItem}
              newReadPath={newReadPath}
              setNewReadPath={setNewReadPath}
              newWritePath={newWritePath}
              setNewWritePath={setNewWritePath}
              newBlockedPath={newBlockedPath}
              setNewBlockedPath={setNewBlockedPath}
              newAllowedPrefix={newAllowedPrefix}
              setNewAllowedPrefix={setNewAllowedPrefix}
              newAutoApprove={newAutoApprove}
              setNewAutoApprove={setNewAutoApprove}
              sessionMode={sessionMode}
              onSetSessionMode={handleSetSessionMode}
            />
          )}
        </RightPanelShell>
      }
      headerProps={{
        status: getStatusLabel(),
        getStatusColor,
        showThinking,
        onToggleThinking: () => {
          if (showThinking && rightPanelTab !== "settings") {
            setShowThinking(false);
          } else {
            if (rightPanelTab === "settings") setRightPanelTab("console");
            setShowThinking(true);
          }
        },
        showSettings: showThinking && rightPanelTab === "settings",
        onToggleSettings: () => {
          if (showThinking && rightPanelTab === "settings") {
            setShowThinking(false);
          } else {
            setRightPanelTab("settings");
            setShowThinking(true);
          }
        },
        theme,
        mounted,
        onToggleTheme: toggleTheme,
      }}
      bottomNavItems={bottomNavItems}
      activeNavTab={activeNavTab}
      onNavTabChange={handleNavTabChange}
    >
      <ChatArea
        messages={messages.slice(-visibleCount)}
        hasMoreMessages={messages.length > visibleCount}
        onLoadOlder={handleLoadOlderMessages}
        systemPromptType={systemPromptType}
        onSetSystemPromptType={handleSetSystemPromptType}
        status={status}
        renderMarkdown={renderMarkdown}
        expandedTools={expandedTools}
        toggleTool={toggleTool}
        getToolSummary={getToolSummary}
        getToolOutput={getToolOutput}
        chatEndRef={chatEndRef}
        metrics={metrics}
        approvalRequest={approvalRequest}
        onApprove={handleApproval}
        onDeny={handleApproval}
        sessionMode={sessionMode}
        showModePrompt={showModePrompt}
        onSetSessionMode={handleSetSessionMode}
        onSetSessionModeAndReRun={handleSetSessionModeAndReRun}
        prompt={prompt}
        setPrompt={setPrompt}
        voiceState={voiceState}
        onVoiceStateToggle={() => {
          setVoiceState(prev => prev === "audio" ? "mute" : prev === "mute" ? "disabled" : "audio");
        }}
        onToggleListening={toggleListening}
        isListening={isListening}
        onSubmit={handleSubmitPrompt}
        onStop={handleStopAgent}
        inputHistoryRef={inputHistoryRef}
        inputHistoryIndexRef={inputHistoryIndexRef}
        showEmptyState={true}
      />
    </AppShell>
  );
}
