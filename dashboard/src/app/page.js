"use client";

import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Mic, Send, XCircle, Volume2, VolumeX } from "lucide-react";
import { marked } from "marked";
import Header from "@/components/Header";
import SessionList from "@/components/SessionList";
import ApprovalBanner from "@/components/ApprovalBanner";
import ChatMessage, { ChatEmptyState } from "@/components/ChatMessage";
import ExecutionPlan from "@/components/ExecutionPlan";
import MetricsPanel from "@/components/MetricsPanel";
import LogViewer from "@/components/LogViewer";
import ScreenshotViewer from "@/components/ScreenshotViewer";
import SettingsPanel from "@/components/SettingsPanel";

export default function Dashboard() {
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState("idle"); // idle, thinking, executing, waiting_approval, done, error
  const [messages, setMessages] = useState([]);
  const [logs, setLogs] = useState([]);
  const [models, setModels] = useState([]);
  const [voices, setVoices] = useState([]);
  const [executionPlan, setExecutionPlan] = useState("");
  
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



  // Memory & Compaction configurations
  const [autoCompactEnabled, setAutoCompactEnabled] = useState(true);
  const [autoCompactThreshold, setAutoCompactThreshold] = useState(70);

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

  const renderMarkdown = (text) => {
    try {
      return { __html: marked.parse(text || "") };
    } catch (e) {
      return { __html: text || "" };
    }
  };

  const getToolSummary = (tool) => {
    const args = tool.arguments || {};
    if (tool.name === "bash") {
      return `Ran shell command: ${args.command || ""}`;
    }
    if (tool.name === "write") {
      return `Created file: ${args.path || ""}`;
    }
    if (tool.name === "edit") {
      return `Edited file: ${args.path || ""}`;
    }
    if (tool.name === "read") {
      return `Read file: ${args.path || ""}`;
    }
    if (tool.name === "find") {
      return `Searched files: ${args.pattern || ""}`;
    }
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

  // Auto-grow textarea for chat input
  const autoGrowTextarea = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "44px";
      el.style.height = Math.min(el.scrollHeight, 200) + "px";
    }
  };

  // Input history navigation
  const navigateInputHistory = (direction) => {
    const history = inputHistoryRef.current;
    if (history.length === 0) return;
    
    if (direction === "up") {
      const newIndex = inputHistoryIndexRef.current < history.length - 1 
        ? inputHistoryIndexRef.current + 1 
        : history.length - 1;
      inputHistoryIndexRef.current = newIndex;
      setPrompt(history[history.length - 1 - newIndex]);
    } else if (direction === "down") {
      const newIndex = inputHistoryIndexRef.current - 1;
      if (newIndex < 0) {
        inputHistoryIndexRef.current = -1;
        setPrompt("");
      } else {
        inputHistoryIndexRef.current = newIndex;
        setPrompt(history[history.length - 1 - newIndex]);
      }
    }
  };

  // Security & LiteLLM Config States
  const [securityConfig, setSecurityConfig] = useState(null);
  
  // Config Parameters
  const [baseURL, setBaseURL] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [selectedNormalModel, setSelectedNormalModel] = useState("");
  const [selectedReasoningModel, setSelectedReasoningModel] = useState("");
  const [selectedVoice, setSelectedVoice] = useState("alba");
  const [taskMode, setTaskMode] = useState("hybrid");
  const [systemPromptType, setSystemPromptType] = useState("standard");

  // File Paths States
  const [newReadPath, setNewReadPath] = useState("");
  const [newWritePath, setNewWritePath] = useState("");
  const [newBlockedPath, setNewBlockedPath] = useState("");
  const [newAllowedPrefix, setNewAllowedPrefix] = useState("");
  const [newAutoApprove, setNewAutoApprove] = useState("");

  // Approval Pending
  const [approvalRequest, setApprovalRequest] = useState(null);

  // Audio / Speech settings
  const [isListening, setIsListening] = useState(false);
  const [voiceResponse, setVoiceResponse] = useState(true);
  const [screenshotFile, setScreenshotFile] = useState(null);

  const socketRef = useRef(null);
  const logEndRef = useRef(null);
  const chatEndRef = useRef(null);
  const recognitionRef = useRef(null);
  const audioRef = useRef(null);
  const textareaRef = useRef(null);
  const inputHistoryRef = useRef([]);
  const inputHistoryIndexRef = useRef(-1);

  // Streaming TTS queue tracking
  const spokenSentencesRef = useRef(new Set());
  const ttsQueueRef = useRef([]);
  const currentPlayingIndexRef = useRef(0);
  const isPlayingRef = useRef(false);
  const ttsSessionRef = useRef(null);

  const [backendHttpUrl, setBackendHttpUrl] = useState("");
  const [backendWsUrl, setBackendWsUrl] = useState("");

  // Resolve backend hosts on mount
  useEffect(() => {
    const backendHost = window.location.hostname || "localhost";
    setBackendHttpUrl(`http://${backendHost}:6800`);
    setBackendWsUrl(`ws://${backendHost}:6800/api/ws`);
  }, []);

  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState("");
  const [hoveredSessionId, setHoveredSessionId] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Refs and state updates declared early to avoid temporal dead zone compile issues
  const currentSessionIdRef = useRef(currentSessionId);
  const updateCurrentSessionRef = useRef(null);
  const voiceResponseRef = useRef(voiceResponse);
  const debouncedSaveTimeoutRef = useRef(null);
  const lastSavedStateRef = useRef(null);
  const fullTtsRequestedRef = useRef(false);

  const saveIfChanged = (session, immediate = false) => {
    const stateKey = JSON.stringify({
      messages: session.messages,
      logs: session.logs,
      executionPlan: session.executionPlan,
      metrics: session.metrics
    });
    if (stateKey !== lastSavedStateRef.current) {
      lastSavedStateRef.current = stateKey;
      
      if (immediate) {
        if (debouncedSaveTimeoutRef.current) {
          clearTimeout(debouncedSaveTimeoutRef.current);
          debouncedSaveTimeoutRef.current = null;
        }
        if (backendHttpUrl) {
          fetch(`${backendHttpUrl}/api/sessions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(session)
          }).catch(e => console.warn("Failed to save session immediately:", e));
        }
      } else {
        if (debouncedSaveTimeoutRef.current) {
          clearTimeout(debouncedSaveTimeoutRef.current);
        }
        debouncedSaveTimeoutRef.current = setTimeout(() => {
          if (backendHttpUrl) {
            fetch(`${backendHttpUrl}/api/sessions`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(session)
            }).catch(e => console.warn("Failed to save session debounced:", e));
          }
          debouncedSaveTimeoutRef.current = null;
        }, 1000);
      }
    }
  };

  const updateCurrentSession = (updatedFields, immediate = false) => {
    const activeId = currentSessionIdRef.current || currentSessionId;
    setSessions(prev => {
      const next = prev.map(s => {
        if (s.id === activeId) {
          let title = s.title;
          if (updatedFields.messages && updatedFields.messages.length > 0 && s.title === "New Session") {
            const firstUserMsg = updatedFields.messages.find(m => m.role === "user");
            if (firstUserMsg) {
              title = firstUserMsg.content.substring(0, 24) + (firstUserMsg.content.length > 24 ? "..." : "");
            }
          }
          const updatedSession = { ...s, ...updatedFields, title };
          
          saveIfChanged(updatedSession, immediate);

          return updatedSession;
        }
        return s;
      });
      localStorage.setItem("aegis_sessions", JSON.stringify(next));
      return next;
    });
  };

  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  useEffect(() => {
    updateCurrentSessionRef.current = updateCurrentSession;
  }, [updateCurrentSession]);

  useEffect(() => {
    voiceResponseRef.current = voiceResponse;
  }, [voiceResponse]);

  // Filter sessions by search query (client-side)
  const filteredSessions = sessions.filter(s => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      s.title.toLowerCase().includes(q) ||
      (s.messages || []).some(m => m.content && m.content.toLowerCase().includes(q))
    );
  });

  // Group sessions by date
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

  // Get session preview (first few words of last assistant message)
  const getSessionPreview = (s) => {
    if (!s.messages || s.messages.length === 0) return "";
    const lastAssistant = [...s.messages].reverse().find(m => m.role === "assistant");
    if (!lastAssistant || !lastAssistant.content) return "";
    const clean = lastAssistant.content.replace(/<[^>]*>/g, "").trim();
    return clean.substring(0, 60) + (clean.length > 60 ? "..." : "");
  };

  // Load sessions on mount from SQLite backend database (with localStorage fallback)
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
        if (stored) {
          try { loadedSessions = JSON.parse(stored); } catch (e) {}
        }
      }

      if (loadedSessions.length === 0) {
        const defaultId = `session-${Date.now()}`;
        loadedSessions = [{
          id: defaultId,
          title: "New Session",
          messages: [],
          logs: [],
          executionPlan: "",
          metrics: { toolCalls: 0, latency: 0, tokens: 0, cost: 0, activeSubagents: [], actionFeed: [] },
          timestamp: Date.now()
        }];
        localStorage.setItem("aegis_sessions", JSON.stringify(loadedSessions));
        try {
          await fetch(`${backendHttpUrl}/api/sessions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(loadedSessions[0])
          });
        } catch (e) {}
      }

      setSessions(loadedSessions);

      // Synced URL session lookup
      const params = new URLSearchParams(window.location.search);
      const urlSessionId = params.get("session");
      let activeSession = loadedSessions[0];

      if (urlSessionId) {
        const found = loadedSessions.find(s => s.id === urlSessionId);
        if (found) activeSession = found;
      }

      setCurrentSessionId(activeSession.id);
      setMessages(activeSession.messages || []);
      setLogs(activeSession.logs || []);
      setExecutionPlan(activeSession.executionPlan || "");
      setMetrics(activeSession.metrics || { toolCalls: 0, latency: 0, tokens: 0, cost: 0, activeSubagents: [], actionFeed: [] });
    };

    loadSessions();
  }, [backendHttpUrl]);

  // Synchronize URL with active session ID
  useEffect(() => {
    if (currentSessionId && typeof window !== "undefined") {
      const newUrl = `${window.location.pathname}?session=${currentSessionId}`;
      window.history.pushState(null, "", newUrl);
    }
  }, [currentSessionId]);



  const handleCreateNewSession = async () => {
    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.src = "";
      } catch (err) {}
    }
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    // Immediately save current active session's pending state to DB before creating new one
    const currentSession = sessions.find(s => s.id === currentSessionId);
    if (currentSession && backendHttpUrl) {
      fetch(`${backendHttpUrl}/api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(currentSession)
      }).catch(e => {});
    }

    const newId = `session-${Date.now()}`;
    const newSession = {
      id: newId,
      title: "New Session",
      messages: [],
      logs: [],
      executionPlan: "",
      metrics: { toolCalls: 0, latency: 0, tokens: 0, cost: 0, activeSubagents: [], actionFeed: [] },
      timestamp: Date.now()
    };

    setSessions(prev => {
      const next = [newSession, ...prev];
      localStorage.setItem("aegis_sessions", JSON.stringify(next));
      return next;
    });

    if (backendHttpUrl) {
      try {
        await fetch(`${backendHttpUrl}/api/sessions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newSession)
        });
      } catch (e) {}
    }

    setCurrentSessionId(newId);
    setMessages([]);
    setLogs([]);
    setExecutionPlan("");
    setMetrics({ toolCalls: 0, latency: 0, tokens: 0, cost: 0, activeSubagents: [], actionFeed: [] });
  };

  const handleSwitchSession = (sessionId) => {
    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.src = "";
      } catch (err) {}
    }
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    // Immediately save current active session's pending state to DB before switching
    const currentSession = sessions.find(s => s.id === currentSessionId);
    if (currentSession && backendHttpUrl) {
      fetch(`${backendHttpUrl}/api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(currentSession)
      }).catch(e => {});
    }

    const target = sessions.find(s => s.id === sessionId);
    if (target) {
      setCurrentSessionId(sessionId);
      setMessages(target.messages || []);
      setLogs(target.logs || []);
      setExecutionPlan(target.executionPlan || "");
      setMetrics(target.metrics || { toolCalls: 0, latency: 0, tokens: 0, cost: 0, activeSubagents: [], actionFeed: [] });
    }
  };

  const handleDeleteSession = async (sessionId) => {
    setSessions(prev => {
      const next = prev.filter(s => s.id !== sessionId);
      localStorage.setItem("aegis_sessions", JSON.stringify(next));
      
      if (sessionId === currentSessionId && next.length > 0) {
        setCurrentSessionId(next[0].id);
        setMessages(next[0].messages || []);
        setLogs(next[0].logs || []);
        setExecutionPlan(next[0].executionPlan || "");
        setMetrics(next[0].metrics || { toolCalls: 0, latency: 0, tokens: 0, cost: 0, activeSubagents: [], actionFeed: [] });
      }
      return next;
    });

    if (backendHttpUrl) {
      try {
        await fetch(`${backendHttpUrl}/api/sessions/${sessionId}`, {
          method: "DELETE"
        });
      } catch (e) {}
    }
  };

  // Fetch configs and start WebSocket when hosts are set
  useEffect(() => {
    if (!backendHttpUrl || !backendWsUrl) return;

    fetchConfig();
    fetchVoicesList();
    connectWebSocket();

    // Initialize Speech Recognition
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const rec = new SpeechRecognition();
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = "en-US";

      rec.onstart = () => {
        setIsListening(true);
      };

      rec.onresult = (event) => {
        const text = event.results[0][0].transcript;
        setPrompt(text);
        handleSubmitPrompt(text);
      };

      rec.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
        setIsListening(false);
      };

      rec.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = rec;
    }

    return () => {
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, [backendHttpUrl, backendWsUrl]);

  // Auto-scroll logs and chat
  useEffect(() => {
    if (showThinking) {
      logEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, showThinking]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Fetch security configurations
  const fetchConfig = () => {
    fetch(`${backendHttpUrl}/api/config`)
      .then(res => res.json())
      .then(data => {
        setSecurityConfig(data);
        if (data.litellm) {
          setBaseURL(data.litellm.baseURL || "");
          setApiKey(data.litellm.apiKey || "");
          setSelectedNormalModel(data.litellm.selectedNormalModel || "");
          setSelectedReasoningModel(data.litellm.selectedReasoningModel || "");
          setTaskMode(data.litellm.taskMode || "hybrid");
        }
        fetchModels();
      })
      .catch(err => console.error("Error loading config:", err));
  };

  // Fetch models from LiteLLM
  const fetchModels = () => {
    fetch(`${backendHttpUrl}/api/models`)
      .then(res => res.json())
      .then(data => {
        setModels(data);
      })
      .catch(err => console.error("Error loading models:", err));
  };

  // Fetch voices list from local TTS proxy
  const fetchVoicesList = () => {
    fetch(`${backendHttpUrl}/api/voices`)
      .then(res => res.json())
      .then(data => {
        setVoices(data);
        if (data.length > 0) {
          // Default to 'alba' or first available
          const hasAlba = data.find(v => v.id === "alba");
          setSelectedVoice(hasAlba ? "alba" : data[0].id);
        }
      })
      .catch(err => console.error("Error loading voices:", err));
  };

  const connectWebSocket = () => {
    console.log("Connecting to WebSocket...");
    const ws = new WebSocket(backendWsUrl);

    ws.onopen = () => {
      console.log("WebSocket connected.");
      // Re-save current session on reconnect to sync any pending changes
      if (currentSessionId) {
        setSessions(prev => {
          const current = prev.find(s => s.id === currentSessionId);
          if (current) {
            saveIfChanged(current, true);
          }
          return prev;
        });
      }
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case "status":
          setStatus(data.status);
          if (data.status === "done" && startTimeRef.current) {
            const elapsed = ((Date.now() - startTimeRef.current) / 1000).toFixed(1);
            setMetrics(prev => {
              const next = { ...prev, latency: elapsed };
              updateCurrentSessionRef.current({ metrics: next });
              return next;
            });
          }
          break;
        
        case "message":
          setMessages(prev => {
            let next;
            if (prev.length > 0 && prev[prev.length - 1].role === "assistant") {
              const updated = [...prev];
              updated[updated.length - 1] = {
                ...updated[updated.length - 1],
                content: data.content
              };
              next = updated;
            } else {
              next = [...prev, { role: data.role, content: data.content }];
            }
            updateCurrentSessionRef.current({ messages: next });
            return next;
          });
          // Estimate token usage and cost
          const totalCharCount = data.content.length + (prompt ? prompt.length : 0);
          const estimatedTokens = Math.round(totalCharCount / 3.8);
          const estimatedCost = (estimatedTokens * 0.000002).toFixed(5);
          setMetrics(prev => {
            const next = {
              ...prev,
              tokens: estimatedTokens,
              cost: estimatedCost
            };
            updateCurrentSessionRef.current({ metrics: next });
            return next;
          });

          // Also do client-side streaming speech detection from message events (backup)
          handleStreamingSpeech(data.content);
          break;

        case "tool_start":
          setMessages(prev => {
            const next = [...prev];
            let lastIndex = next.findLastIndex(m => m.role === "assistant");
            if (lastIndex === -1) {
              next.push({ role: "assistant", content: "", tools: [] });
              lastIndex = next.length - 1;
            }
            const msg = next[lastIndex];
            const tools = msg.tools || [];
            const updatedTools = [
              ...tools.filter(t => t.id !== data.toolCallId),
              { id: data.toolCallId, name: data.name, arguments: data.arguments, status: "running" }
            ];
            next[lastIndex] = { ...msg, tools: updatedTools };
            updateCurrentSessionRef.current({ messages: next });
            return next;
          });
          
          // Increment tool calls and append to chronological action feed
          const startToolSummary = getToolSummary({ name: data.name, arguments: data.arguments });
          setMetrics(prev => {
            const next = {
              ...prev,
              toolCalls: prev.toolCalls + 1,
              actionFeed: [
                { timestamp: new Date().toLocaleTimeString(), text: startToolSummary, type: "start", id: data.toolCallId },
                ...prev.actionFeed
              ]
            };
            
            // Register subagent tool starts in orchestration list
            if (data.name === "subagent") {
              const saPrompt = data.arguments?.prompt || "Task execution";
              const subagentName = "Subagent (" + (saPrompt.substring(0, 24) + (saPrompt.length > 24 ? "..." : "")) + ")";
              next.activeSubagents = [
                { id: data.toolCallId, name: subagentName, status: "active", time: new Date().toLocaleTimeString() },
                ...prev.activeSubagents
              ];
            }

            updateCurrentSessionRef.current({ metrics: next });
            return next;
          });
          break;

        case "tool_end":
          setMessages(prev => {
            const next = [...prev];
            let lastIndex = next.findLastIndex(m => m.role === "assistant");
            if (lastIndex === -1) {
              next.push({ role: "assistant", content: "", tools: [] });
              lastIndex = next.length - 1;
            }
            const msg = next[lastIndex];
            const tools = msg.tools || [];
            const updatedTools = tools.map(t => 
              t.id === data.toolCallId 
                ? { ...t, result: data.result, status: "done" } 
                : t
            );
            next[lastIndex] = { ...msg, tools: updatedTools };
            updateCurrentSessionRef.current({ messages: next });
            return next;
          });
          
          // Update chronological action feed
          setMetrics(prev => {
            const next = {
              ...prev,
              actionFeed: prev.actionFeed.map(feed => 
                feed.id === data.toolCallId 
                  ? { ...feed, type: "end", timestampEnd: new Date().toLocaleTimeString() }
                  : feed
              )
            };

            // Complete subagent runs in orchestration list
            if (data.name === "subagent") {
              next.activeSubagents = prev.activeSubagents.map(sa => 
                sa.id === data.toolCallId 
                  ? { ...sa, status: "completed", timeEnd: new Date().toLocaleTimeString() } 
                  : sa
              );
            }

            updateCurrentSessionRef.current({ metrics: next });
            return next;
          });
          break;

        case "intelligent_speech":
          if (voiceResponseRef.current && !fullTtsRequestedRef.current) {
            // Cancel active streaming speech queue to play the final intelligent summary
            ttsSessionRef.current = Symbol("summary-tts");
            spokenSentencesRef.current = new Set();
            ttsQueueRef.current = [];
            currentPlayingIndexRef.current = 0;
            isPlayingRef.current = false;
            
            speakText(data.content);
          }
          break;

        case "speech_sentence":
          // Real-time streaming TTS: play each completed sentence as it arrives (only if explicitly requested)
          if (voiceResponseRef.current && fullTtsRequestedRef.current && data.content && data.content.trim().length > 2) {
            queueSentenceTTS(data.content.trim());
          }
          break;

        case "speech_tool":
          // Spoken tool announcement during execution (only if explicitly requested)
          if (voiceResponseRef.current && fullTtsRequestedRef.current && data.content) {
            queueSentenceTTS(data.content);
          }
          break;

        case "speech":
          // Disabled to prevent duplicate voice output, since we stream completed sentences in real-time
          break;

        case "plan":
          setExecutionPlan(data.content);
          updateCurrentSessionRef.current({ executionPlan: data.content });
          break;

        case "log":
          setLogs(prev => {
            const next = [...prev, { 
              text: data.content, 
              isSystem: data.isSystem,
              timestamp: new Date().toLocaleTimeString() 
            }];
            updateCurrentSessionRef.current({ logs: next });
            return next;
          });
          
          // Parse token counts from subagent stdout/stderr logs
          const tokenMatch = data.content.match(/(?:tokens|token|tkn)\s*(?:used|usage|volume)?[:\s\-\=]+\s*(\d+)/i);
          if (tokenMatch) {
            const saTokens = parseInt(tokenMatch[1]);
            setMetrics(prev => {
              const next = {
                ...prev,
                tokens: prev.tokens + saTokens,
                cost: ((prev.tokens + saTokens) * 0.000002).toFixed(5)
              };
              updateCurrentSessionRef.current({ metrics: next });
              return next;
            });
          }

          // Parse subagents
          if (data.content.includes("Spawning") || data.content.includes("spawning")) {
            let subagentName = "Subagent";
            if (data.content.includes("warmup")) subagentName = "Warmup Agent";
            if (data.content.includes("CLI session")) subagentName = "CLI Execution Agent";
            if (data.content.includes("Orchestrate planning")) subagentName = "Roadmap Planner Agent";
            
            setMetrics(prev => {
              if (prev.activeSubagents.some(sa => sa.name === subagentName && sa.status === "active")) return prev;
              const next = {
                ...prev,
                activeSubagents: [
                  { name: subagentName, status: "active", time: new Date().toLocaleTimeString() },
                  ...prev.activeSubagents
                ]
              };
              updateCurrentSessionRef.current({ metrics: next });
              return next;
            });
          }
          if (data.content.includes("completed") || data.content.includes("exited")) {
            setMetrics(prev => {
              const next = {
                ...prev,
                activeSubagents: prev.activeSubagents.map(sa => 
                  sa.status === "active" ? { ...sa, status: "completed", timeEnd: new Date().toLocaleTimeString() } : sa
                )
              };
              updateCurrentSessionRef.current({ metrics: next });
              return next;
            });
          }
          break;

        case "approval_required":
          setApprovalRequest({
            toolCallId: data.toolCallId,
            command: data.command
          });
          // Add to approvals history
          setApprovalsHistory(prev => [
            { id: data.toolCallId, command: data.command, status: "pending", time: new Date().toLocaleTimeString() },
            ...prev
          ]);
          break;

        case "screenshot_updated":
          setScreenshotFile(`${backendHttpUrl}/screenshots/${data.file}?t=${Date.now()}`);
          break;

        case "error":
          setLogs(prev => [...prev, { 
            text: `[Error] ${data.message}`, 
            isError: true, 
            timestamp: new Date().toLocaleTimeString() 
          }]);
          setStatus("error");
          break;

        default:
          break;
      }
    };

    ws.onclose = () => {
      console.log("WebSocket closed. Reconnecting...");
      setStatus("error");
      setTimeout(connectWebSocket, 5000);
    };

    ws.onerror = (err) => {
      console.error("WebSocket error:", err);
      setStatus("error");
    };

    socketRef.current = ws;
  };

  // Text to Speech using the local API proxy (Parallel generation + queue playback)
  const speakText = async (text) => {
    try {
      // Cancel any currently playing audio
      if (audioRef.current) {
        try {
          audioRef.current.pause();
          audioRef.current.src = "";
        } catch (err) {
          console.error("Error stopping previous audio:", err);
        }
      }
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }

      const cleanText = text
        .replace(/[*#`_\-]/g, "") 
        .replace(/\[.*?\]\(.*?\)/g, "");

      // Wake up the AudioContext/hardware to prevent Bluetooth/sound card cut-offs
      if (typeof window !== "undefined") {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
          try {
            const ctx = new AudioContext();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            gain.gain.value = 0;
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(0);
            osc.stop(0.05);
          } catch (e) {
            console.warn("AudioContext wake-up failed:", e);
          }
        }
      }

      // Split text into sentences
      const sentences = cleanText
        .split(/(?<=[.!?])\s+/)
        .map(s => s.trim())
        .filter(s => s.length > 2); // ignore tiny snippets

      if (sentences.length === 0) return;

      const playQueue = new Array(sentences.length).fill(null);
      const statusQueue = new Array(sentences.length).fill("pending"); // pending, ready, failed
      let currentPlayingIndex = 0;
      let isPlaying = false;

      // Track active audio session ID to avoid playing older tracks if user triggers new turns
      const currentSessionRef = Symbol("tts-session");
      audioRef.currentSession = currentSessionRef;

      const playNextInQueue = () => {
        if (audioRef.currentSession !== currentSessionRef) return;
        
        if (currentPlayingIndex >= sentences.length) {
          isPlaying = false;
          return;
        }

        const status = statusQueue[currentPlayingIndex];
        if (status === "ready") {
          isPlaying = true;
          const audioUrl = playQueue[currentPlayingIndex];
          const audio = new Audio(audioUrl);
          audioRef.current = audio;

          audio.play().catch(err => {
            console.error("Audio playback failed, skipping sentence:", err);
            currentPlayingIndex++;
            playNextInQueue();
          });

          audio.onended = () => {
            currentPlayingIndex++;
            playNextInQueue();
          };
        } else if (status === "failed") {
          currentPlayingIndex++;
          playNextInQueue();
        } else {
          isPlaying = false;
        }
      };

      // Start fetching sentences in parallel!
      sentences.forEach(async (sentence, index) => {
        try {
          const response = await fetch(`${backendHttpUrl}/api/tts`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: sentence, voice: selectedVoice })
          });

          if (!response.ok) throw new Error("TTS failed");

          const blob = await response.blob();
          const audioUrl = URL.createObjectURL(blob);

          if (audioRef.currentSession === currentSessionRef) {
            playQueue[index] = audioUrl;
            statusQueue[index] = "ready";

            if (index === currentPlayingIndex && !isPlaying) {
              playNextInQueue();
            }
          }
        } catch (e) {
          console.error("Sentence TTS fetch error:", e);
          if (audioRef.currentSession === currentSessionRef) {
            statusQueue[index] = "failed";
            if (index === currentPlayingIndex && !isPlaying) {
              playNextInQueue();
            }
          }
        }
      });

    } catch (e) {
      console.error("Local TTS failed, falling back to browser SpeechSynthesis:", e);
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
        
        // Wrap speak in a timeout to let the SpeechSynthesis engine fully reset
        setTimeout(() => {
          const cleanText = text.replace(/[*#`_\-]/g, "").replace(/\[.*?\]\(.*?\)/g, "").substring(0, 300);
          const utterance = new SpeechSynthesisUtterance(cleanText);
          window.activeUtterance = utterance; // Prevent garbage collection
          window.speechSynthesis.speak(utterance);
        }, 100);
      }
    }
  };

  const handleStreamingSpeech = (text) => {
    if (!voiceResponse) return;

    // Filter by <tts> tag if present in the streamed message
    const ttsRegex = /<tts>([\s\S]*?)(?:<\/tts>|$)/i;
    const ttsMatch = text.match(ttsRegex);
    let textToSpeak = "";
    if (ttsMatch) {
      textToSpeak = ttsMatch[1].trim();
    } else {
      textToSpeak = text;
    }

    const cleanText = textToSpeak
      .replace(/[*#`_\-]/g, "") 
      .replace(/\[.*?\]\(.*?\)/g, "");

    // Split into sentences using standard regex
    const allSentences = cleanText
      .split(/(?<=[.!?])\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 2);

    // Only process sentences that have a terminating punctuation at the end (completed sentences)
    const completedSentences = allSentences.filter(s => /[.!?]$/.test(s));
    
    // Speak all completed sentences as they arrive (no cap)
    const sentencesToSpeak = completedSentences;

    // Find sentences that we haven't processed yet in the current session
    const pendingSentences = sentencesToSpeak.filter(s => !spokenSentencesRef.current.has(s));

    pendingSentences.forEach(sentence => {
      // Mark it as spoken/queued
      spokenSentencesRef.current.add(sentence);
      queueSentenceTTS(sentence);
    });
  };

  const queueSentenceTTS = (sentence) => {
    const queueItem = {
      sentence,
      audioUrl: null,
      status: "pending",
      session: ttsSessionRef.current
    };
    ttsQueueRef.current.push(queueItem);

    // Trigger parallel fetch
    fetch(`${backendHttpUrl}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: sentence, voice: selectedVoice })
    })
    .then(res => {
      if (!res.ok) throw new Error("TTS failed");
      return res.blob();
    })
    .then(blob => {
      // Ensure we are still in the same session before caching
      if (ttsSessionRef.current === queueItem.session) {
        queueItem.audioUrl = URL.createObjectURL(blob);
        queueItem.status = "ready";
        playStreamingTTSQueue();
      }
    })
    .catch(err => {
      console.error("Streaming TTS error for sentence:", sentence, err);
      if (ttsSessionRef.current === queueItem.session) {
        queueItem.status = "failed";
        playStreamingTTSQueue();
      }
    });
  };

  const playStreamingTTSQueue = () => {
    if (isPlayingRef.current) return;
    if (currentPlayingIndexRef.current >= ttsQueueRef.current.length) return;

    const nextItem = ttsQueueRef.current[currentPlayingIndexRef.current];

    // Ensure we are in the same session
    if (nextItem.session !== ttsSessionRef.current) {
      currentPlayingIndexRef.current++;
      playStreamingTTSQueue();
      return;
    }

    if (nextItem.status === "ready") {
      isPlayingRef.current = true;
      const audio = new Audio(nextItem.audioUrl);
      audioRef.current = audio;

      audio.play().catch(err => {
        console.error("Streaming playback failed, skipping sentence:", err);
        isPlayingRef.current = false;
        currentPlayingIndexRef.current++;
        playStreamingTTSQueue();
      });

      audio.onended = () => {
        isPlayingRef.current = false;
        currentPlayingIndexRef.current++;
        playStreamingTTSQueue();
      };
    } else if (nextItem.status === "failed") {
      currentPlayingIndexRef.current++;
      playStreamingTTSQueue();
    } else {
      // Still pending. Wait for the fetch callback to complete.
    }
  };

  // Toggle Microphone listener
  const toggleListening = () => {
    if (!recognitionRef.current) {
      alert("Speech recognition is not supported in this browser. Please use Chrome/Edge.");
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
    } else {
      if (typeof window !== "undefined") {
        window.speechSynthesis.cancel(); 
      }
      recognitionRef.current.start();
    }
  };

  // Send request to backend
  const handleSubmitPrompt = (overridePrompt) => {
    const finalPrompt = overridePrompt || prompt;
    if (!finalPrompt.trim()) return;

    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      alert("WebSocket is not connected.");
      return;
    }

    // Stop any active audio playback immediately when sending a new prompt
    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.src = "";
      } catch (err) {
        console.error("Error stopping audio on submit:", err);
      }
    }
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    // Reset metrics and start latency timer
    startTimeRef.current = Date.now();
    setMetrics({ toolCalls: 0, latency: 0, tokens: 0, cost: 0, activeSubagents: [], actionFeed: [] });

    // Detect if full vocal read-out is requested
    const q = finalPrompt.toLowerCase();
    fullTtsRequestedRef.current = q.includes("read to me") || 
                                  q.includes("read aloud") || 
                                  q.includes("speak the full") || 
                                  q.includes("speak the entire") || 
                                  q.includes("recite") || 
                                  q.includes("read the content") ||
                                  q.includes("read out the");

    // Initialize new streaming speech session to cancel previous ones
    ttsSessionRef.current = Symbol("streaming-tts");
    spokenSentencesRef.current = new Set();
    ttsQueueRef.current = [];
    currentPlayingIndexRef.current = 0;
    isPlayingRef.current = false;

    const nextMsg = [...messages, { role: "user", content: finalPrompt }];
    setMessages(nextMsg);
    setLogs([]);
    setExecutionPlan("");
    setPrompt("");
    
    // Synchronously write the user prompt to the SQLite DB
    updateCurrentSession({ messages: nextMsg, logs: [], executionPlan: "" }, true);

    socketRef.current.send(JSON.stringify({
      type: "start_task",
      prompt: finalPrompt,
      systemPromptType,
      sessionId: currentSessionId
    }));
  };

  const handleStopAgent = () => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ 
        type: "cancel", 
        sessionId: currentSessionId 
      }));
      setLogs(prev => [...prev, { 
        text: "[Client Command] Sent interruption request to stop the active agent process.", 
        isSystem: true,
        timestamp: new Date().toLocaleTimeString() 
      }]);
    }
  };

  const handleApproval = (approved) => {
    if (!approvalRequest) return;

    socketRef.current.send(JSON.stringify({
      type: "approval_response",
      toolCallId: approvalRequest.toolCallId,
      approved
    }));

    // Save decision to approvals history
    setApprovalsHistory(prev => prev.map(app => 
      app.id === approvalRequest.toolCallId 
        ? { ...app, status: approved ? "approved" : "denied" } 
        : app
    ));

    setApprovalRequest(null);
  };

  const saveAllSettings = () => {
    const updatedConfig = {
      ...securityConfig,
      litellm: {
        baseURL,
        apiKey,
        selectedNormalModel,
        selectedReasoningModel,
        taskMode
      }
    };

    fetch(`${backendHttpUrl}/api/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updatedConfig)
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setSecurityConfig(updatedConfig);
          alert("Settings saved successfully.");
          fetchModels();
        } else {
          alert(`Error saving configurations: ${data.message}`);
        }
      })
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
      case "thinking": return "#3b82f6";
      case "executing": return "#8b5cf6";
      case "waiting_approval": return "#f59e0b";
      case "done": return "#10b981";
      case "error": return "#ef4444";
      default: return "#71717a";
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", backgroundColor: "var(--bg-color)" }}>
      {/* HEADER NAVBAR */}
      <Header
        status={status}
        getStatusColor={getStatusColor}
        showThinking={showThinking}
        onToggleThinking={() => {
          if (showThinking && rightPanelTab !== "settings") {
            setShowThinking(false);
          } else {
            if (rightPanelTab === "settings") {
              setRightPanelTab("console");
            }
            setShowThinking(true);
          }
        }}
        showSettings={showThinking && rightPanelTab === "settings"}
        onToggleSettings={() => {
          if (showThinking && rightPanelTab === "settings") {
            setShowThinking(false);
          } else {
            setRightPanelTab("settings");
            setShowThinking(true);
          }
        }}
      />

      {/* MAIN CONTAINER */}
      <div style={{ display: "flex", flex: "1", overflow: "hidden" }}>
        
        {/* SESSIONS SIDEBAR */}
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
        
        {/* CENTRAL AREA: Chat & Input */}
        <div style={{ 
          flex: "1", 
          display: "flex", 
          flexDirection: "column", 
          padding: "20px", 
          overflow: "hidden",
          backgroundColor: "var(--bg-color)" 
        }}>
          
          {/* HITL APPROVAL BANNER */}
          <ApprovalBanner
            approvalRequest={approvalRequest}
            onApprove={() => handleApproval(true)}
            onDeny={() => handleApproval(false)}
          />

          {/* CHAT AREA */}
          <div style={{ 
            flex: "1", 
            display: "flex",
            flexDirection: "column",
            position: "relative",
            maxWidth: "900px",
            margin: "0 auto",
            width: "100%",
            height: "100%",
            minHeight: 0,
            overflowY: "auto",
            paddingBottom: "20px"
          }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {messages.length === 0 && <ChatEmptyState />}
              {messages.map((msg, i) => (
                <ChatMessage
                  key={i}
                  message={msg}
                  renderMarkdown={renderMarkdown}
                  expandedTools={expandedTools}
                  toggleTool={toggleTool}
                  getToolSummary={getToolSummary}
                  getToolOutput={getToolOutput}
                />
              ))}
              <div ref={chatEndRef}></div>
            </div>
          </div>

          {/* LIVE PROGRESS OBSERVABILITY BANNER */}
          {(status === "thinking" || status === "executing") && (
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "10px 16px",
              maxWidth: "900px",
              width: "100%",
              margin: "0 auto 12px auto",
              background: "rgba(59, 130, 246, 0.08)",
              border: "1px solid rgba(59, 130, 246, 0.2)",
              borderRadius: "8px",
              fontSize: "0.8rem",
              color: "#60a5fa"
            }}>
              <div className="pulsing-mic" style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: "#3b82f6",
                boxShadow: "0 0 8px #3b82f6"
              }}></div>
              <span style={{ fontWeight: "500", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                {status === "thinking" ? "🤖 Agent is thinking and planning..." : "⚙️ Executing: "}
                {metrics.actionFeed.length > 0 ? metrics.actionFeed[0].text : "Working on the task in background..."}
              </span>
            </div>
          )}

          {/* INPUT CONTROLS BAR */}
          <div style={{ display: "flex", gap: "10px", maxWidth: "900px", width: "100%", margin: "0 auto" }}>
            <Button 
              onClick={toggleListening}
              className={isListening ? "pulsing-mic" : ""}
              variant="outline"
              style={{ 
                width: "44px", 
                height: "44px", 
                borderRadius: "var(--radius-md)"
              }}
              title="Voice input"
              disabled={status === "thinking" || status === "executing"}
            >
              <Mic size={18} />
            </Button>

            <Button 
              onClick={() => setVoiceResponse(prev => !prev)}
              variant="outline"
              style={{ 
                width: "44px", 
                height: "44px", 
                borderRadius: "var(--radius-md)",
                borderColor: voiceResponse ? "rgba(16, 185, 129, 0.4)" : "var(--border-color)",
                color: voiceResponse ? "#10b981" : "var(--text-muted)",
                background: voiceResponse ? "rgba(16, 185, 129, 0.04)" : "transparent"
              }}
              title={voiceResponse ? "Mute TTS response" : "Unmute TTS response"}
            >
              {voiceResponse ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </Button>
            
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                autoGrowTextarea();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey) {
                  e.preventDefault();
                  if (status !== "thinking" && status !== "executing") {
                    const trimmed = prompt.trim();
                    if (trimmed) {
                      inputHistoryRef.current.push(trimmed);
                      inputHistoryIndexRef.current = -1;
                    }
                    handleSubmitPrompt();
                  }
                } else if (e.key === "ArrowUp" && !e.shiftKey) {
                  e.preventDefault();
                  navigateInputHistory("up");
                } else if (e.key === "ArrowDown" && !e.shiftKey) {
                  e.preventDefault();
                  navigateInputHistory("down");
                }
              }}
              placeholder={status === "thinking" || status === "executing" ? "Agent is working... click Stop to interrupt." : "Deploy code, browse websites, run shell operations... (Shift+Enter for newline)"}
              rows={1}
              disabled={status === "thinking" || status === "executing"}
              style={{ 
                flex: "1", 
                borderRadius: "var(--radius-md)",
                minHeight: "44px",
                maxHeight: "200px",
                fontSize: "0.95rem",
                backgroundColor: "var(--input-bg)",
                color: "var(--text-main)",
                border: "1px solid var(--border-color)",
                padding: "10px 14px",
                resize: "none",
                overflowY: "auto",
                lineHeight: "1.5",
                fontFamily: "inherit",
                outline: "none"
              }}
            />
            
            {(status === "thinking" || status === "executing") ? (
              <Button 
                onClick={handleStopAgent}
                style={{ 
                  borderRadius: "var(--radius-md)", 
                  padding: "0 20px",
                  height: "44px",
                  backgroundColor: "rgba(239, 68, 68, 0.9)",
                  color: "#fff"
                }}
              >
                <XCircle size={16} style={{ marginRight: "6px" }} /> Stop
              </Button>
            ) : (
              <Button 
                onClick={() => handleSubmitPrompt()}
                style={{ 
                  borderRadius: "var(--radius-md)", 
                  padding: "0 20px",
                  height: "44px"
                }}
              >
                <Send size={16} /> Send
              </Button>
            )}
          </div>

        </div>

        {/* DIAGNOSTICS & CONTROL DRAWER (Frosted Glass - Layer 2) */}
        {showThinking && (
          <aside style={{ 
            display: "flex", 
            flexDirection: "column",
            width: "420px",
            borderLeft: "1px solid var(--border-color)",
            background: "var(--panel-bg)",
            backdropFilter: "blur(20px)",
            height: "100%",
            flexShrink: 0
          }}>
            {/* Tab Switcher */}
            <div style={{ 
              display: "flex", 
              background: "rgba(0,0,0,0.2)", 
              borderBottom: "1px solid var(--border-color)",
              padding: "4px"
            }}>
              {[
                { id: "roadmap", label: "Plan", icon: "📋" },
                { id: "console", label: "Console", icon: "💻" },
                { id: "control_panel", label: "Health", icon: "📊" },
                { id: "settings", label: "Settings", icon: "⚙️" }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setRightPanelTab(tab.id)}
                  style={{
                    flex: "1",
                    padding: "8px 4px",
                    fontSize: "0.75rem",
                    fontWeight: "600",
                    background: rightPanelTab === tab.id ? "var(--input-bg)" : "transparent",
                    border: "1px solid " + (rightPanelTab === tab.id ? "var(--border-color)" : "transparent"),
                    color: rightPanelTab === tab.id ? "#fff" : "var(--text-muted)",
                    borderRadius: "6px",
                    cursor: "pointer",
                    transition: "all 0.12s ease",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "4px"
                  }}
                >
                  <span>{tab.icon}</span>
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>

            {/* Tab Content Area */}
            <div style={{ flex: "1", overflowY: "auto", padding: "20px", display: "flex", flexDirection: "column", gap: "20px" }}>
              {rightPanelTab === "roadmap" && (
                <ExecutionPlan executionPlan={executionPlan} />
              )}
              
              {rightPanelTab === "console" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "20px", height: "100%" }}>
                  <div style={{ flex: "1", display: "flex", flexDirection: "column", minHeight: 0 }}>
                    <div style={{ fontSize: "0.75rem", fontWeight: "700", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "8px" }}>
                      📂 System Output Logs
                    </div>
                    <div style={{ flex: "1", background: "rgba(0,0,0,0.3)", border: "1px solid var(--border-color)", borderRadius: "8px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
                      <LogViewer logs={logs} logEndRef={logEndRef} />
                    </div>
                  </div>

                  {screenshotFile && (
                    <div style={{ height: "200px", display: "flex", flexDirection: "column", flexShrink: 0 }}>
                      <div style={{ fontSize: "0.75rem", fontWeight: "700", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "8px" }}>
                        📸 Browser State
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
                  voiceResponse={voiceResponse}
                  setVoiceResponse={setVoiceResponse}
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
                />
              )}
            </div>
          </aside>
        )}

      </div>
    </div>
  );
}
