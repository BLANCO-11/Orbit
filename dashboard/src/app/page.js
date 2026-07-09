"use client";

import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Play, Mic, Send, Eye, EyeOff, Settings, AlertTriangle, ShieldCheck, Check, Trash2, Plus,
  ChevronDown, ChevronRight, Terminal, FileCode, Globe, CheckCircle2, Loader2, XCircle
} from "lucide-react";
import { marked } from "marked";

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

  const updateCurrentSession = (updatedFields) => {
    setSessions(prev => {
      const next = prev.map(s => {
        if (s.id === currentSessionId) {
          let title = s.title;
          if (updatedFields.messages && updatedFields.messages.length > 0 && s.title === "New Session") {
            const firstUserMsg = updatedFields.messages.find(m => m.role === "user");
            if (firstUserMsg) {
              title = firstUserMsg.content.substring(0, 24) + (firstUserMsg.content.length > 24 ? "..." : "");
            }
          }
          const updatedSession = { ...s, ...updatedFields, title };
          
          // Fire-and-forget save to SQLite backend DB
          if (backendHttpUrl) {
            fetch(`${backendHttpUrl}/api/sessions`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(updatedSession)
            }).catch(e => console.warn("Failed to save session to SQLite:", e));
          }

          return updatedSession;
        }
        return s;
      });
      localStorage.setItem("aegis_sessions", JSON.stringify(next));
      return next;
    });
  };

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
              updateCurrentSession({ metrics: next });
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
            updateCurrentSession({ messages: next });
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
            updateCurrentSession({ metrics: next });
            return next;
          });

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
            updateCurrentSession({ messages: next });
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

            updateCurrentSession({ metrics: next });
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
            updateCurrentSession({ messages: next });
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

            updateCurrentSession({ metrics: next });
            return next;
          });
          break;

        case "intelligent_speech":
          if (voiceResponse) {
            // Cancel active streaming speech queue to play the final intelligent summary
            ttsSessionRef.current = Symbol("summary-tts");
            spokenSentencesRef.current = new Set();
            ttsQueueRef.current = [];
            currentPlayingIndexRef.current = 0;
            isPlayingRef.current = false;
            
            speakText(data.content);
          }
          break;

        case "speech":
          // Disabled to prevent duplicate voice output, since we stream completed sentences in real-time
          break;

        case "plan":
          setExecutionPlan(data.content);
          updateCurrentSession({ executionPlan: data.content });
          break;

        case "log":
          setLogs(prev => {
            const next = [...prev, { 
              text: data.content, 
              isSystem: data.isSystem,
              timestamp: new Date().toLocaleTimeString() 
            }];
            updateCurrentSession({ logs: next });
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
              updateCurrentSession({ metrics: next });
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
              updateCurrentSession({ metrics: next });
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
              updateCurrentSession({ metrics: next });
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
    
    // We cap the maximum number of spoken sentences to 2 to keep TTS concise!
    const MAX_SPOKEN_SENTENCES = 2;
    let sentencesToSpeak = [];
    let shouldAddSummaryNotice = false;

    if (completedSentences.length <= MAX_SPOKEN_SENTENCES) {
      sentencesToSpeak = completedSentences;
    } else {
      sentencesToSpeak = completedSentences.slice(0, MAX_SPOKEN_SENTENCES);
      shouldAddSummaryNotice = true;
    }

    // Find sentences that we haven't processed yet in the current session
    const pendingSentences = sentencesToSpeak.filter(s => !spokenSentencesRef.current.has(s));

    pendingSentences.forEach(sentence => {
      // Mark it as spoken/queued
      spokenSentencesRef.current.add(sentence);
      queueSentenceTTS(sentence);
    });

    // If we exceeded the cap, add a single concise summarization suffix
    if (shouldAddSummaryNotice && !spokenSentencesRef.current.has("__summary_notice__")) {
      spokenSentencesRef.current.add("__summary_notice__");
      queueSentenceTTS("I have displayed the remaining detailed steps in the chat box.");
    }
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

    // Initialize new streaming speech session to cancel previous ones
    ttsSessionRef.current = Symbol("streaming-tts");
    spokenSentencesRef.current = new Set();
    ttsQueueRef.current = [];
    currentPlayingIndexRef.current = 0;
    isPlayingRef.current = false;

    setMessages(prev => [...prev, { role: "user", content: finalPrompt }]);
    setLogs([]);
    setExecutionPlan("");
    setPrompt("");

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
      <header className="app-header">
        <div className="logo-container">
          <div className="logo-glow"></div>
          <span className="logo-text">AegisAgent OS Assistant</span>
        </div>
        
        {/* Central Controls using Shadcn Buttons */}
        <div style={{ display: "flex", gap: "8px" }}>
          <Button 
            variant="outline"
            onClick={() => setShowThinking(!showThinking)}
            style={{ fontSize: "0.8rem", padding: "6px 12px", height: "32px" }}
          >
            {showThinking ? <EyeOff size={14} /> : <Eye size={14} />}
            {showThinking ? "Hide Logs (Chat View)" : "Show Logs (Console View)"}
          </Button>
          
          <Button 
            variant="outline"
            onClick={() => setShowSettings(!showSettings)}
            style={{ fontSize: "0.8rem", padding: "6px 12px", height: "32px" }}
          >
            <Settings size={14} />
            {showSettings ? "Hide Settings" : "Configure Agent"}
          </Button>
        </div>
        
        {/* Status Indicator */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{ 
            width: "8px", 
            height: "8px", 
            borderRadius: "50%", 
            backgroundColor: getStatusColor(),
            boxShadow: `0 0 8px ${getStatusColor()}`
          }}></div>
          <span style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "1px", fontWeight: "600", color: getStatusColor() }}>
            {status}
          </span>
        </div>
      </header>

      {/* MAIN CONTAINER */}
      <div style={{ display: "flex", flex: "1", overflow: "hidden" }}>
        
        {/* SESSIONS SIDEBAR */}
        <aside style={{
          width: "240px",
          borderRight: "1px solid var(--border-color)",
          background: "rgba(9, 9, 11, 0.4)",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0
        }}>
          {/* New Session Button */}
          <div style={{ padding: "16px" }}>
            <Button 
              onClick={handleCreateNewSession}
              style={{ width: "100%", justifyContent: "flex-start", gap: "8px", height: "36px", fontSize: "0.8rem", borderRadius: "var(--radius-sm)" }}
              variant="outline"
            >
              <Plus size={14} /> New Session
            </Button>
          </div>

          {/* Sessions List */}
          <div style={{ flex: "1", overflowY: "auto", padding: "0 12px 16px 12px", display: "flex", flexDirection: "column", gap: "4px" }}>
            {sessions.map((s) => {
              const isActive = s.id === currentSessionId;
              return (
                <div 
                  key={s.id}
                  onClick={() => handleSwitchSession(s.id)}
                  onMouseEnter={() => setHoveredSessionId(s.id)}
                  onMouseLeave={() => setHoveredSessionId(null)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 12px",
                    borderRadius: "6px",
                    cursor: "pointer",
                    fontSize: "0.75rem",
                    background: isActive ? "var(--input-bg)" : "transparent",
                    border: isActive ? "1px solid var(--border-color)" : "1px solid transparent",
                    color: isActive ? "#fff" : "var(--text-muted)",
                    transition: "all 0.12s ease",
                    minHeight: "36px"
                  }}
                >
                  <span style={{ 
                    overflow: "hidden", 
                    textOverflow: "ellipsis", 
                    whiteSpace: "nowrap", 
                    maxWidth: "80%",
                    fontWeight: isActive ? "600" : "400"
                  }}>
                    {s.title}
                  </span>
                  {(isActive || hoveredSessionId === s.id) && sessions.length > 1 && (
                    <Trash2 
                      size={12} 
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteSession(s.id);
                      }} 
                      style={{ 
                        color: "var(--danger)",
                        cursor: "pointer",
                        opacity: 0.7,
                        transition: "opacity 0.1s ease"
                      }}
                      onMouseEnter={(e) => e.target.style.opacity = 1}
                      onMouseLeave={(e) => e.target.style.opacity = 0.7}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </aside>
        
        {/* CENTRAL AREA: Chat, Plans, Logs */}
        <div style={{ flex: "1", display: "flex", flexDirection: "column", padding: "20px", overflow: "hidden" }}>
          
          {/* HITL APPROVAL BANNER (Shadcn Card style) */}
          {approvalRequest && (
            <Card style={{ marginBottom: "16px", borderColor: "var(--warning)", background: "rgba(245, 158, 11, 0.08)" }}>
              <CardContent style={{ padding: "16px" }}>
                <h4 style={{ color: "var(--warning)", marginBottom: "8px", fontSize: "0.95rem", display: "flex", alignItems: "center", gap: "6px" }}>
                  <AlertTriangle size={16} /> Command Execution Requested
                </h4>
                <p style={{ fontFamily: "monospace", fontSize: "0.85rem", background: "rgba(0,0,0,0.5)", padding: "10px", borderRadius: "6px", marginBottom: "12px", border: "1px solid var(--border-muted)" }}>
                  {approvalRequest.command}
                </p>
                <div style={{ display: "flex", gap: "8px" }}>
                  <Button 
                    onClick={() => handleApproval(true)}
                    style={{ background: "var(--success)", hover: "none" }}
                    size="sm"
                  >
                    <ShieldCheck size={14} /> Approve
                  </Button>
                  <Button 
                    onClick={() => handleApproval(false)}
                    variant="destructive"
                    size="sm"
                  >
                    Deny
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* CHAT AND ROADMAP AREA */}
          <div style={{ 
            flex: "1", 
            display: "grid", 
            gridTemplateColumns: showThinking ? "1.5fr 1fr" : "1fr", 
            gap: "20px", 
            overflow: "hidden", 
            marginBottom: "20px" 
          }}>
            
            {/* CHAT BUBBLES PANELS using Shadcn Card */}
            <Card className="tui-panel" style={{ 
              display: "flex", 
              flexDirection: "column", 
              flex: "3", 
              position: "relative",
              maxWidth: !showThinking ? "800px" : "100%",
              margin: !showThinking ? "0 auto" : "0",
              width: "100%",
              height: "100%",
              minHeight: 0
            }}>
              <div style={{ flex: "1", overflowY: "auto", padding: "20px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  {messages.length === 0 && (
                    <div style={{ margin: "100px auto", textAlign: "center", color: "var(--text-muted)", maxWidth: "380px" }}>
                      <h3 style={{ color: "#fff", marginBottom: "8px", fontWeight: "600" }}>AegisAgent Active</h3>
                      <p style={{ fontSize: "0.85rem" }}>Speak or type to delegate OS operations, write code, run audits, or browse web applications.</p>
                    </div>
                  )}
                  
                  {messages.map((msg, i) => (
                    <div 
                      key={i} 
                      style={{ 
                        display: "flex", 
                        flexDirection: "column",
                        alignItems: msg.role === "user" ? "flex-end" : "flex-start",
                        width: "100%"
                      }}
                    >
                      <div style={{ 
                        background: msg.role === "user" ? "var(--primary)" : "var(--input-bg)", 
                        padding: "10px 14px", 
                        borderRadius: msg.role === "user" ? "14px 14px 2px 14px" : "14px 14px 14px 2px",
                        maxWidth: "85%",
                        fontSize: "0.9rem",
                        border: msg.role === "user" ? "none" : "1px solid var(--border-color)",
                        color: msg.role === "user" ? "var(--primary-foreground)" : "var(--text-main)",
                        boxShadow: msg.role === "user" ? "0 4px 12px var(--primary-glow)" : "none",
                        width: "fit-content"
                      }}>
                        {msg.role === "user" ? (
                          <div style={{ whiteSpace: "pre-wrap" }}>{msg.content}</div>
                        ) : (
                          <div 
                            className="markdown-content" 
                            dangerouslySetInnerHTML={renderMarkdown(msg.content)} 
                          />
                        )}
                      </div>

                      {/* COLLAPSIBLE TOOL CALLS */}
                      {msg.tools && msg.tools.length > 0 && (
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px", width: "100%", maxWidth: "600px", paddingLeft: "14px" }}>
                          {msg.tools.map((tool) => {
                            const isExpanded = !!expandedTools[tool.id];
                            
                            // Determine tool icon
                            let ToolIcon = Settings;
                            if (tool.name === "bash") ToolIcon = Terminal;
                            else if (["write", "edit", "read", "find"].includes(tool.name)) ToolIcon = FileCode;
                            else if (tool.name.includes("lightpanda")) ToolIcon = Globe;

                            return (
                              <div key={tool.id} style={{
                                border: "1px solid var(--border-color)",
                                borderRadius: "6px",
                                background: "rgba(0,0,0,0.2)",
                                overflow: "hidden"
                              }}>
                                {/* Header Row */}
                                <div 
                                  onClick={() => toggleTool(tool.id)}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    padding: "6px 10px",
                                    cursor: "pointer",
                                    userSelect: "none",
                                    fontSize: "0.75rem",
                                    background: "rgba(255,255,255,0.02)"
                                  }}
                                >
                                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: "1", overflow: "hidden" }}>
                                    {tool.status === "running" ? (
                                      <Loader2 className="animate-spin" style={{ width: "12px", height: "12px", color: "var(--warning)", flexShrink: 0 }} />
                                    ) : (
                                      <CheckCircle2 style={{ width: "12px", height: "12px", color: "var(--success)", flexShrink: 0 }} />
                                    )}
                                    <ToolIcon style={{ width: "12px", height: "12px", color: "var(--text-muted)", flexShrink: 0 }} />
                                    <span style={{ color: "var(--text-main)", fontWeight: "500", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                      {getToolSummary(tool)}
                                    </span>
                                  </div>
                                  <div style={{ color: "var(--text-muted)", display: "flex", alignItems: "center", marginLeft: "8px" }}>
                                    {isExpanded ? <ChevronDown style={{ width: "14px", height: "14px" }} /> : <ChevronRight style={{ width: "14px", height: "14px" }} />}
                                  </div>
                                </div>

                                {/* Expanded Content */}
                                {isExpanded && (
                                  <div style={{
                                    padding: "8px 10px",
                                    borderTop: "1px solid var(--border-color)",
                                    background: "#0c0c0e",
                                    fontSize: "0.75rem",
                                    fontFamily: "ui-monospace, monospace"
                                  }}>
                                    {/* Arguments Block */}
                                    {tool.arguments && Object.keys(tool.arguments).length > 0 && (
                                      <div style={{ marginBottom: "6px" }}>
                                        <div style={{ color: "var(--text-dark)", marginBottom: "2px", fontSize: "0.65rem", textTransform: "uppercase" }}>Arguments:</div>
                                        <pre style={{ 
                                          background: "rgba(255,255,255,0.03)", 
                                          padding: "5px", 
                                          borderRadius: "4px", 
                                          overflowX: "auto",
                                          color: "#a78bfa"
                                        }}>{JSON.stringify(tool.arguments, null, 2)}</pre>
                                      </div>
                                    )}

                                    {/* Output Block */}
                                    <div>
                                      <div style={{ color: "var(--text-dark)", marginBottom: "2px", fontSize: "0.65rem", textTransform: "uppercase" }}>Output:</div>
                                      <pre style={{ 
                                        background: "rgba(0,0,0,0.4)", 
                                        padding: "6px", 
                                        borderRadius: "4px", 
                                        overflowX: "auto", 
                                        whiteSpace: "pre-wrap",
                                        color: "#34d399",
                                        maxHeight: "150px",
                                        overflowY: "auto"
                                      }}>{getToolOutput(tool.result)}</pre>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                  <div ref={chatEndRef}></div>
                </div>
              </div>
            </Card>

            {/* RIGHT SIDE PANEL (Roadmap / Security Control Panel Sidecar) */}
            {showThinking && (
              <Card className="tui-panel" style={{ 
                display: "flex", 
                flexDirection: "column",
                height: "100%",
                minHeight: 0
              }}>
                {/* Panel Tab Switcher */}
                <div style={{ display: "flex", gap: "1px", background: "var(--border-color)", borderBottom: "1px solid var(--border-color)" }}>
                  <button 
                    onClick={() => setRightPanelTab("roadmap")}
                    style={{
                      flex: "1",
                      padding: "10px 14px",
                      fontSize: "0.8rem",
                      fontWeight: "600",
                      background: rightPanelTab === "roadmap" ? "transparent" : "rgba(0,0,0,0.3)",
                      color: rightPanelTab === "roadmap" ? "#fff" : "var(--text-muted)",
                      border: "none",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                      borderBottom: rightPanelTab === "roadmap" ? "2px solid var(--primary)" : "none"
                    }}
                  >
                    📋 Roadmap Plan
                  </button>
                  <button 
                    onClick={() => setRightPanelTab("control_panel")}
                    style={{
                      flex: "1",
                      padding: "10px 14px",
                      fontSize: "0.8rem",
                      fontWeight: "600",
                      background: rightPanelTab === "control_panel" ? "transparent" : "rgba(0,0,0,0.3)",
                      color: rightPanelTab === "control_panel" ? "#fff" : "var(--text-muted)",
                      border: "none",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                      borderBottom: rightPanelTab === "control_panel" ? "2px solid var(--primary)" : "none"
                    }}
                  >
                    🛡️ Control Panel
                  </button>
                </div>

                <div style={{ flex: "1", overflowY: "auto", padding: "16px 20px" }}>
                  {rightPanelTab === "roadmap" ? (
                    executionPlan ? (
                      <div style={{ fontSize: "0.8rem", color: "var(--text-main)", whiteSpace: "pre-wrap", lineHeight: "1.5" }}>
                        {executionPlan}
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)", gap: "10px", minHeight: "150px" }}>
                        <Loader2 className="animate-spin" style={{ width: "20px", height: "20px" }} />
                        <span style={{ fontSize: "0.8rem" }}>Waiting for roadmap generation...</span>
                      </div>
                    )
                  ) : (
                    /* SECURITY CONTROL PANEL SIDECAR */
                    <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
                      
                      {/* SECTION 1: METRICS GRID */}
                      <div>
                        <div style={{ fontSize: "0.75rem", fontWeight: "700", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "8px" }}>
                          📊 Session Metrics
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                          
                          {/* Metric: Latency */}
                          <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-color)", padding: "8px 12px", borderRadius: "6px" }}>
                            <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginBottom: "2px" }}>⏱️ Turn Latency</div>
                            <div style={{ fontSize: "1.1rem", fontWeight: "700", color: "#fff" }}>
                              {status === "thinking" || status === "executing" ? (
                                <span style={{ color: "var(--warning)", display: "flex", alignItems: "center", gap: "4px" }}>
                                  <Loader2 className="animate-spin" style={{ width: "12px", height: "12px" }} /> Calculating
                                </span>
                              ) : (
                                `${metrics.latency}s`
                              )}
                            </div>
                          </div>

                          {/* Metric: Tool Calls */}
                          <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-color)", padding: "8px 12px", borderRadius: "6px" }}>
                            <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginBottom: "2px" }}>🔧 Tool Calls</div>
                            <div style={{ fontSize: "1.1rem", fontWeight: "700", color: "#fff" }}>
                              {metrics.toolCalls} calls
                            </div>
                          </div>

                          {/* Metric: Token Usage */}
                          <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-color)", padding: "8px 12px", borderRadius: "6px" }}>
                            <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginBottom: "2px" }}>🪙 Token Volume</div>
                            <div style={{ fontSize: "1.1rem", fontWeight: "700", color: "#fff" }}>
                              {metrics.tokens.toLocaleString()} tkn
                            </div>
                          </div>

                          {/* Metric: Cost */}
                          <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-color)", padding: "8px 12px", borderRadius: "6px" }}>
                            <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginBottom: "2px" }}>💸 Est. Session Cost</div>
                            <div style={{ fontSize: "1.1rem", fontWeight: "700", color: "#34d399" }}>
                              ${metrics.cost}
                            </div>
                          </div>

                        </div>
                      </div>

                      {/* SECTION 2: ACTIVE ORCHESTRATION (SUBAGENTS) */}
                      <div>
                        <div style={{ fontSize: "0.75rem", fontWeight: "700", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "8px" }}>
                          🤖 Subagent Orchestration
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "150px", overflowY: "auto" }}>
                          {metrics.activeSubagents.length === 0 ? (
                            <div style={{ fontSize: "0.75rem", color: "var(--text-dark)", fontStyle: "italic" }}>
                              No subagents spawned in this session.
                            </div>
                          ) : (
                            metrics.activeSubagents.map((sa, i) => (
                              <div key={i} style={{ 
                                display: "flex", 
                                justifyContent: "space-between", 
                                alignItems: "center", 
                                background: sa.status === "active" ? "rgba(59, 130, 246, 0.05)" : "rgba(255,255,255,0.01)", 
                                border: sa.status === "active" ? "1px solid rgba(59, 130, 246, 0.2)" : "1px solid var(--border-muted)", 
                                padding: "6px 10px", 
                                borderRadius: "6px", 
                                fontSize: "0.75rem" 
                              }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                  <span style={{ 
                                    width: "6px", 
                                    height: "6px", 
                                    borderRadius: "50%", 
                                    background: sa.status === "active" ? "#3b82f6" : "var(--text-dark)",
                                    boxShadow: sa.status === "active" ? "0 0 8px #3b82f6" : "none"
                                  }} />
                                  <span style={{ fontWeight: sa.status === "active" ? "600" : "400", color: sa.status === "active" ? "#fff" : "var(--text-main)" }}>
                                    {sa.name}
                                  </span>
                                </div>
                                <span style={{ fontSize: "0.7rem", color: "var(--text-dark)" }}>
                                  {sa.status === "active" ? `Started ${sa.time}` : `Exited ${sa.timeEnd || sa.time}`}
                                </span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>

                      {/* SECTION 3: CHRONOLOGICAL ACTION TIMELINE */}
                      <div>
                        <div style={{ fontSize: "0.75rem", fontWeight: "700", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "8px" }}>
                          📜 Chronological Action Feed
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "180px", overflowY: "auto", paddingRight: "4px" }}>
                          {metrics.actionFeed.length === 0 ? (
                            <div style={{ fontSize: "0.75rem", color: "var(--text-dark)", fontStyle: "italic" }}>
                              Waiting for tool activities...
                            </div>
                          ) : (
                            metrics.actionFeed.map((feed, i) => (
                              <div key={i} style={{ 
                                display: "flex", 
                                flexDirection: "column", 
                                background: "rgba(0,0,0,0.15)", 
                                borderLeft: feed.type === "start" ? "2px solid var(--warning)" : "2px solid var(--success)",
                                padding: "6px 10px", 
                                borderRadius: "0 6px 6px 0",
                                fontSize: "0.75rem"
                              }}>
                                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px" }}>
                                  <span style={{ color: "var(--text-main)", fontWeight: "500" }}>{feed.text}</span>
                                  <span style={{ fontSize: "0.65rem", color: "var(--text-dark)" }}>{feed.timestamp}</span>
                                </div>
                                <div style={{ fontSize: "0.65rem", color: feed.type === "start" ? "var(--warning)" : "var(--success)" }}>
                                  {feed.type === "start" ? "Executing..." : `Completed at ${feed.timestampEnd}`}
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>

                      {/* SECTION 4: APPROVAL DECISION QUEUE */}
                      <div>
                        <div style={{ fontSize: "0.75rem", fontWeight: "700", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "8px" }}>
                          🛡️ Approval Guard History
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "150px", overflowY: "auto" }}>
                          {approvalsHistory.length === 0 ? (
                            <div style={{ fontSize: "0.75rem", color: "var(--text-dark)", fontStyle: "italic" }}>
                              No HITL approval actions taken.
                            </div>
                          ) : (
                            approvalsHistory.map((app, i) => (
                              <div key={i} style={{ 
                                display: "flex", 
                                flexDirection: "column",
                                background: "rgba(0,0,0,0.15)", 
                                border: "1px solid var(--border-color)",
                                padding: "6px 10px", 
                                borderRadius: "6px", 
                                fontSize: "0.75rem"
                              }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                                  <span style={{ 
                                    fontSize: "0.65rem", 
                                    padding: "2px 6px", 
                                    borderRadius: "4px", 
                                    fontWeight: "600",
                                    background: app.status === "approved" ? "rgba(52, 211, 153, 0.15)" : app.status === "denied" ? "rgba(239, 68, 68, 0.15)" : "rgba(245, 158, 11, 0.15)",
                                    color: app.status === "approved" ? "#34d399" : app.status === "denied" ? "#f87171" : "#fbbf24"
                                  }}>
                                    {app.status.toUpperCase()}
                                  </span>
                                  <span style={{ fontSize: "0.65rem", color: "var(--text-dark)" }}>{app.time}</span>
                                </div>
                                <div style={{ fontFamily: "monospace", fontSize: "0.7rem", background: "rgba(0,0,0,0.2)", padding: "4px 6px", borderRadius: "4px", overflowX: "auto" }}>
                                  {app.command}
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>

                    </div>
                  )}
                </div>
              </Card>
            )}
          </div>
          {showThinking && (
            <div style={{ 
                display: "grid", 
                gridTemplateColumns: screenshotFile ? "1.2fr 1fr" : "1fr", 
                gap: "20px", 
                height: "220px", 
                minHeight: "220px", 
                overflow: "hidden", 
                marginBottom: "20px" 
              }}>
              
              {/* ACTION LOGS */}
              <Card style={{ display: "flex", flexDirection: "column", background: "var(--panel-bg)", borderColor: "var(--border-color)" }}>
                <CardHeader style={{ padding: "10px 16px", borderBottom: "1px solid var(--border-muted)" }}>
                  <CardTitle style={{ fontSize: "0.75rem", fontWeight: "600", color: "var(--text-muted)" }}>
                    📂 Console Logs
                  </CardTitle>
                </CardHeader>
                <div style={{ flex: "1", overflowY: "auto", padding: "8px" }}>
                  <div style={{ background: "rgba(9, 9, 11, 0.4)", borderRadius: "var(--radius-sm)", padding: "4px" }}>
                    {logs.length === 0 && <span style={{ color: "var(--text-dark)", fontSize: "0.75rem", fontFamily: "monospace" }}>No activity logs yet.</span>}
                    {logs.map((log, index) => (
                      <div 
                        key={index} 
                        className={`terminal-line ${log.isError ? "error" : log.isSystem ? "system" : "log"}`}
                      >
                        <span style={{ color: "var(--text-dark)", marginRight: "6px" }}>[{log.timestamp}]</span>
                        {log.text}
                      </div>
                    ))}
                    <div ref={logEndRef}></div>
                  </div>
                </div>
              </Card>

              {/* BROWSER SCREENSHOT VIEWPORT */}
              {screenshotFile && (
                <Card style={{ display: "flex", flexDirection: "column", background: "var(--panel-bg)", borderColor: "var(--border-color)" }}>
                  <CardHeader style={{ padding: "10px 16px", borderBottom: "1px solid var(--border-muted)" }}>
                    <CardTitle style={{ fontSize: "0.75rem", fontWeight: "600", color: "var(--text-muted)" }}>
                      🌐 Browser Preview (Lightpanda)
                    </CardTitle>
                  </CardHeader>
                  <CardContent style={{ flex: "1", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.3)", padding: "12px", overflow: "hidden" }}>
                    <img 
                      src={screenshotFile} 
                      alt="Browser Screenshot" 
                      style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} 
                    />
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* LIVE PROGRESS OBSERVABILITY BANNER */}
          {(status === "thinking" || status === "executing") && (
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "10px 16px",
              maxWidth: !showThinking ? "800px" : "100%",
              width: "100%",
              margin: !showThinking ? "0 auto 12px auto" : "0 0 12px 0",
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
          <div style={{ display: "flex", gap: "10px", maxWidth: !showThinking ? "800px" : "100%", width: "100%", margin: !showThinking ? "0 auto" : "0" }}>
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
            
            <Input 
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && status !== "thinking" && status !== "executing" && handleSubmitPrompt()}
              placeholder={status === "thinking" || status === "executing" ? "Agent is working... click Stop to interrupt." : "Deploy code, browse websites, run shell operations..."}
              style={{ 
                flex: "1", 
                borderRadius: "var(--radius-md)",
                height: "44px",
                fontSize: "0.95rem",
                backgroundColor: "var(--input-bg)",
                color: "var(--text-main)",
                border: "1px solid var(--border-color)"
              }}
              disabled={status === "thinking" || status === "executing"}
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

        {/* RIGHT COLUMN: Slide Settings Sidebar */}
        {showSettings && (
          <aside className="sidebar-panel">
            <div style={{ fontSize: "0.95rem", fontWeight: "700", color: "var(--text-main)", borderBottom: "1px solid var(--border-muted)", paddingBottom: "10px" }}>
              ⚙️ Agent Settings
            </div>

            {/* LiteLLM configurations */}
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "4px", fontWeight: "600" }}>
                  LITELLM BASE ENDPOINT
                </label>
                <Input 
                  value={baseURL}
                  onChange={(e) => setBaseURL(e.target.value)}
                  style={{ height: "32px", fontSize: "0.8rem" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "4px", fontWeight: "600" }}>
                  API KEY
                </label>
                <Input 
                  type="password" 
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  style={{ height: "32px", fontSize: "0.8rem" }}
                />
              </div>
            </div>

            {/* Model Selections using Shadcn Select */}
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "4px", fontWeight: "600" }}>
                  NORMAL EXECUTION MODEL
                </label>
                <Select value={selectedNormalModel} onValueChange={setSelectedNormalModel}>
                  <SelectTrigger style={{ width: "100%", height: "32px", fontSize: "0.8rem" }}>
                    <SelectValue placeholder="Select model" />
                  </SelectTrigger>
                  <SelectContent>
                    {models.length > 0 ? (
                      models.map(m => (
                        <SelectItem key={m.id} value={m.id}>{m.id}</SelectItem>
                      ))
                    ) : (
                      <SelectItem value="loading" disabled>No models loaded</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "4px", fontWeight: "600" }}>
                  REASONING PLANNER MODEL
                </label>
                <Select value={selectedReasoningModel} onValueChange={setSelectedReasoningModel}>
                  <SelectTrigger style={{ width: "100%", height: "32px", fontSize: "0.8rem" }}>
                    <SelectValue placeholder="Select model" />
                  </SelectTrigger>
                  <SelectContent>
                    {models.length > 0 ? (
                      models.map(m => (
                        <SelectItem key={m.id} value={m.id}>{m.id}</SelectItem>
                      ))
                    ) : (
                      <SelectItem value="loading" disabled>No models loaded</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Execution / Thinking Mode using Shadcn Select */}
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "4px", fontWeight: "600" }}>
                AGENT THINKING MODE
              </label>
              <Select value={taskMode} onValueChange={setTaskMode}>
                <SelectTrigger style={{ width: "100%", height: "32px", fontSize: "0.8rem" }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normal Model Only (Fast)</SelectItem>
                  <SelectItem value="reasoning">Reasoning Model Only (Deep)</SelectItem>
                  <SelectItem value="hybrid">Hybrid Orchestrator (Plan + Exec)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Prompt Directives Selection using Shadcn Select */}
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "4px", fontWeight: "600" }}>
                SYSTEM PROMPT DIRECTIVES
              </label>
              <Select value={systemPromptType} onValueChange={setSystemPromptType}>
                <SelectTrigger style={{ width: "100%", height: "32px", fontSize: "0.8rem" }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard PA Prompt</SelectItem>
                  <SelectItem value="fable-5">Claude Fable 5 Leak Prompt</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* TTS Voice Selection using Shadcn Select */}
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "4px", fontWeight: "600" }}>
                LOCAL TTS VOICE
              </label>
              <Select value={selectedVoice} onValueChange={setSelectedVoice}>
                <SelectTrigger style={{ width: "100%", height: "32px", fontSize: "0.8rem" }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {voices.length > 0 ? (
                    voices.map(v => (
                      <SelectItem key={v.id} value={v.id}>{v.display_name || v.id}</SelectItem>
                    ))
                  ) : (
                    <SelectItem value="alba">alba (Default)</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Voice feedback toggle using Shadcn Switch */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(255,255,255,0.02)", padding: "8px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-color)", marginBottom: "14px" }}>
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: "600" }}>VOICE RESPONSES (TTS)</span>
              <Switch checked={voiceResponse} onCheckedChange={setVoiceResponse} />
            </div>

            {/* Memory & Compaction Section */}
            <div style={{ fontSize: "0.95rem", fontWeight: "700", color: "var(--text-main)", borderBottom: "1px solid var(--border-muted)", paddingBottom: "10px", marginTop: "10px", marginBottom: "10px" }}>
              🧹 Memory & Compaction
            </div>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "18px" }}>
              {/* Auto Compaction toggle */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(255,255,255,0.02)", padding: "8px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-color)" }}>
                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: "600" }}>AUTO COMPACTION</span>
                <Switch 
                  checked={autoCompactEnabled} 
                  onCheckedChange={(checked) => {
                    setAutoCompactEnabled(checked);
                    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
                      socketRef.current.send(JSON.stringify({ type: "set_auto_compaction", enabled: checked }));
                    }
                  }} 
                />
              </div>

              {/* Compaction Threshold */}
              <div style={{ padding: "4px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "6px", fontWeight: "600" }}>
                  <span>COMPACTION THRESHOLD</span>
                  <span style={{ color: "var(--primary-foreground)" }}>{autoCompactThreshold}%</span>
                </div>
                <input 
                  type="range"
                  min="30"
                  max="90"
                  step="5"
                  value={autoCompactThreshold}
                  onChange={(e) => setAutoCompactThreshold(parseInt(e.target.value))}
                  style={{ width: "100%", accentColor: "var(--primary)", cursor: "pointer" }}
                  disabled={!autoCompactEnabled}
                />
              </div>

              {/* Manual Compact Button */}
              <Button 
                variant="outline" 
                onClick={handleManualCompact}
                style={{ width: "100%", height: "32px", fontSize: "0.8rem", gap: "6px" }}
              >
                🧹 Compact Memory Now
              </Button>
            </div>

            <div style={{ fontSize: "0.95rem", fontWeight: "700", color: "var(--text-main)", borderBottom: "1px solid var(--border-muted)", paddingBottom: "10px", marginTop: "10px" }}>
              🛡️ Security configurations
            </div>

            {securityConfig ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                
                {/* HITL Toggle using Shadcn Switch */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px", background: "rgba(255,255,255,0.02)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-color)" }}>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Require Approval (HITL)</span>
                  <Switch 
                    checked={securityConfig.shellCommands.requireApproval}
                    onCheckedChange={(checked) => {
                      const updated = { ...securityConfig };
                      updated.shellCommands.requireApproval = checked;
                      setSecurityConfig(updated);
                    }}
                  />
                </div>

                {/* Whitelist Prefixes */}
                <div>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: "600" }}>Allowed Utilities list:</span>
                  <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", margin: "6px 0" }}>
                    {securityConfig.shellCommands.allowedPrefixes.map((p, i) => (
                      <span key={i} style={{ background: "rgba(124, 58, 237, 0.15)", border: "1px solid rgba(124, 58, 237, 0.3)", padding: "1px 6px", borderRadius: "12px", fontSize: "0.7rem", display: "flex", alignItems: "center", gap: "3px" }}>
                        {p}
                        <button onClick={() => removeConfigItem("shellCommands", "allowedPrefixes", i)} style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: "0.7rem" }}>×</button>
                      </span>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: "4px" }}>
                    <Input 
                      value={newAllowedPrefix}
                      onChange={(e) => setNewAllowedPrefix(e.target.value)}
                      placeholder="e.g. git"
                      style={{ flex: "1", height: "26px", fontSize: "0.75rem", padding: "2px 8px" }}
                    />
                    <Button onClick={() => addConfigItem("shellCommands", "allowedPrefixes", newAllowedPrefix, setNewAllowedPrefix)} variant="outline" style={{ height: "26px", padding: "0 10px", fontSize: "0.75rem" }}><Plus size={12} /></Button>
                  </div>
                </div>

                {/* Auto Approve Whitelist */}
                <div>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: "600" }}>Auto-Approve commands:</span>
                  <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", margin: "6px 0" }}>
                    {securityConfig.shellCommands.autoApprove.map((a, i) => (
                      <span key={i} style={{ background: "rgba(16, 185, 129, 0.15)", border: "1px solid rgba(16, 185, 129, 0.3)", padding: "1px 6px", borderRadius: "12px", fontSize: "0.7rem", display: "flex", alignItems: "center", gap: "3px" }}>
                        {a}
                        <button onClick={() => removeConfigItem("shellCommands", "autoApprove", i)} style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: "0.7rem" }}>×</button>
                      </span>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: "4px" }}>
                    <Input 
                      value={newAutoApprove}
                      onChange={(e) => setNewAutoApprove(e.target.value)}
                      placeholder="e.g. ls"
                      style={{ flex: "1", height: "26px", fontSize: "0.75rem", padding: "2px 8px" }}
                    />
                    <Button onClick={() => addConfigItem("shellCommands", "autoApprove", newAutoApprove, setNewAutoApprove)} variant="outline" style={{ height: "26px", padding: "0 10px", fontSize: "0.75rem" }}><Plus size={12} /></Button>
                  </div>
                </div>

                {/* Allowed Read Paths */}
                <div>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: "600", display: "block", marginBottom: "3px" }}>Allowed Read Directories:</span>
                  <div style={{ display: "flex", flexDirection: "column", gap: "3px", margin: "4px 0" }}>
                    {securityConfig.fileSystem.allowedReadPaths.map((p, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(255,255,255,0.02)", padding: "3px 6px", borderRadius: "6px", fontSize: "0.7rem", border: "1px solid var(--border-color)" }}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "85%" }}>{p}</span>
                        <Trash2 size={12} onClick={() => removeConfigItem("fileSystem", "allowedReadPaths", i)} style={{ color: "#f87171", cursor: "pointer" }} />
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: "4px" }}>
                    <Input 
                      value={newReadPath}
                      onChange={(e) => setNewReadPath(e.target.value)}
                      placeholder="/absolute/path"
                      style={{ flex: "1", height: "26px", fontSize: "0.75rem", padding: "2px 8px" }}
                    />
                    <Button onClick={() => addConfigItem("fileSystem", "allowedReadPaths", newReadPath, setNewReadPath)} variant="outline" style={{ height: "26px", padding: "0 10px", fontSize: "0.75rem" }}><Plus size={12} /></Button>
                  </div>
                </div>

                {/* Allowed Write Paths */}
                <div>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: "600", display: "block", marginBottom: "3px" }}>Allowed Write Directories:</span>
                  <div style={{ display: "flex", flexDirection: "column", gap: "3px", margin: "4px 0" }}>
                    {securityConfig.fileSystem.allowedWritePaths.map((p, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(255,255,255,0.02)", padding: "3px 6px", borderRadius: "6px", fontSize: "0.7rem", border: "1px solid var(--border-color)" }}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "85%" }}>{p}</span>
                        <Trash2 size={12} onClick={() => removeConfigItem("fileSystem", "allowedWritePaths", i)} style={{ color: "#f87171", cursor: "pointer" }} />
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: "4px" }}>
                    <Input 
                      value={newWritePath}
                      onChange={(e) => setNewWritePath(e.target.value)}
                      placeholder="/absolute/path"
                      style={{ flex: "1", height: "26px", fontSize: "0.75rem", padding: "2px 8px" }}
                    />
                    <Button onClick={() => addConfigItem("fileSystem", "allowedWritePaths", newWritePath, setNewWritePath)} variant="outline" style={{ height: "26px", padding: "0 10px", fontSize: "0.75rem" }}><Plus size={12} /></Button>
                  </div>
                </div>

                {/* Blocked Paths */}
                <div>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: "600", display: "block", marginBottom: "3px" }}>Explicitly Blocked Directories:</span>
                  <div style={{ display: "flex", flexDirection: "column", gap: "3px", margin: "4px 0" }}>
                    {securityConfig.fileSystem.blockedPaths.map((p, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(239, 68, 68, 0.03)", border: "1px solid rgba(239, 68, 68, 0.15)", padding: "3px 6px", borderRadius: "6px", fontSize: "0.7rem" }}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "85%" }}>{p}</span>
                        <Trash2 size={12} onClick={() => removeConfigItem("fileSystem", "blockedPaths", i)} style={{ color: "#f87171", cursor: "pointer" }} />
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: "4px" }}>
                    <Input 
                      value={newBlockedPath}
                      onChange={(e) => setNewBlockedPath(e.target.value)}
                      placeholder="/absolute/path"
                      style={{ flex: "1", height: "26px", fontSize: "0.75rem", padding: "2px 8px" }}
                    />
                    <Button onClick={() => addConfigItem("fileSystem", "blockedPaths", newBlockedPath, setNewBlockedPath)} variant="outline" style={{ height: "26px", padding: "0 10px", fontSize: "0.75rem" }}><Plus size={12} /></Button>
                  </div>
                </div>

                {/* Save button */}
                <Button 
                  onClick={saveAllSettings}
                  style={{ width: "100%", padding: "10px", marginTop: "10px", fontSize: "0.85rem" }}
                >
                  Save Settings & Policies
                </Button>

              </div>
            ) : (
              <div style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>Loading settings...</div>
            )}

          </aside>
        )}

      </div>
    </div>
  );
}
