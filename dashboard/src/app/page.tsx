'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { MessageSquare, List, BarChart3, Cog } from 'lucide-react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import CommandPalette from '@/components/widgets/CommandPalette';
import NotificationCenter from '@/components/widgets/NotificationCenter';

// Providers & Hooks
import { AegisProvider, useAegisState, useAegisDispatch, actions } from '@/providers/AegisProvider';
import { useTheme, useResponsive, useWebSocket, useSessions, useTTS, useSTT } from '@/hooks';

// Layout
import AppShell from '@/components/layout/AppShell';
import ChatArea from '@/components/chat/ChatArea';

// Panels
import DetailPanel from '@/components/panels/DetailPanel';
import AgentTab from '@/components/panels/AgentTab';
import WorkspaceTab from '@/components/panels/WorkspaceTab';

// Components
import SessionList from '@/components/SessionList';
import ExecutionPlan from '@/components/ExecutionPlan';
import MetricsPanel from '@/components/MetricsPanel';
import LogViewer from '@/components/LogViewer';
import ScreenshotViewer from '@/components/ScreenshotViewer';
import SettingsPanel from '@/components/SettingsPanel';

export default function Dashboard() {
  return (
    <AegisProvider>
      <DashboardInner />
    </AegisProvider>
  );
}

function DashboardInner() {
  const dispatch = useAegisDispatch();
  const state = useAegisState();
  const { theme, mounted, toggleTheme, setTheme } = useTheme();
  const { isMobile } = useResponsive();

  // ── Backend URLs ──
  const [backendWsUrl, setBackendWsUrl] = useState('');
  useEffect(() => {
    const host = window.location.hostname || 'localhost';
    // API calls use relative URLs (proxied by Next.js rewrites → 127.0.0.1:6800)
    // WebSocket connects directly to backend on localhost:6800
    setBackendWsUrl(`ws://${host}:6800/api/ws`);
  }, []);

  // ── WebSocket ──
  const { sendMessage, connectionState, setSessionId } = useWebSocket(backendWsUrl);

  // ── Sessions ──
  const {
    sessions, searchQuery, setSearchQuery,
    groupedSessions, hoveredSessionId, setHoveredSessionId,
    createSession, switchSession, deleteSession, renameSession,
    updateCurrentSession, getSessionPreview,
  } = useSessions();

  // Keep WebSocket session ID in sync
  useEffect(() => {
    setSessionId(state.currentSessionId);
  }, [state.currentSessionId, setSessionId]);

  // ── Config ──
  const [securityConfig, setSecurityConfig] = useState(null);
  const [models, setModels] = useState([]);
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState('alba');
  const [systemPromptType, setSystemPromptType] = useState('standard');

  // Config field states (passed to SettingsPanel)
  const [baseURL, setBaseURL] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [selectedNormalModel, setSelectedNormalModel] = useState('');
  const [selectedReasoningModel, setSelectedReasoningModel] = useState('');
  const [taskMode, setTaskMode] = useState('hybrid');
  const [autoCompactEnabled, setAutoCompactEnabled] = useState(true);
  const [autoCompactThreshold, setAutoCompactThreshold] = useState(70);
  const [newReadPath, setNewReadPath] = useState('');
  const [newWritePath, setNewWritePath] = useState('');
  const [newBlockedPath, setNewBlockedPath] = useState('');
  const [newAllowedPrefix, setNewAllowedPrefix] = useState('');
  const [newAutoApprove, setNewAutoApprove] = useState('');

  const fetchConfig = useCallback(() => {
    fetch(`/api/config`)
      .then(res => res.json())
      .then(data => {
        setSecurityConfig(data);
        if (data.litellm) {
          setBaseURL(data.litellm.baseURL || '');
          setApiKey(data.litellm.apiKey || '');
          setSelectedNormalModel(data.litellm.selectedNormalModel || '');
          setSelectedReasoningModel(data.litellm.selectedReasoningModel || '');
          setTaskMode(data.litellm.taskMode || 'hybrid');
        }
        if (data.systemPromptType) setSystemPromptType(data.systemPromptType);
        fetchModels();
      })
      .catch(err => console.error('Error loading config:', err));
  }, []);

  const fetchModels = useCallback(() => {
    fetch(`/api/models`)
      .then(res => res.json())
      .then(data => setModels(data))
      .catch(() => {});
  }, []);

  const fetchVoices = useCallback(() => {
    fetch(`/api/voices`)
      .then(res => res.json())
      .then(data => {
        setVoices(data);
        if (data.length > 0) {
          const hasAlba = data.find(v => v.id === 'alba');
          setSelectedVoice(hasAlba ? 'alba' : data[0].id);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => { fetchConfig(); fetchVoices(); }, [fetchConfig, fetchVoices]);

  // ── TTS ──
  const { speakText, startSession: startTtsSession, stopSpeaking } = useTTS(selectedVoice);

  // ── STT ──
  const { isListening, isSupported: sttSupported, startListening, stopListening } = useSTT();

  // ── UI State (local) ──
  const [prompt, setPrompt] = useState('');
  const [showThinking, setShowThinking] = useState(true);
  const [rightPanelTab, setRightPanelTab] = useState('agent');
  const [activeNavTab, setActiveNavTab] = useState('chat');
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);
  const inputHistoryRef = useRef([]);
  const inputHistoryIndexRef = useRef(-1);
  const startTimeRef = useRef(null);
  const chatEndRef = useRef(null);
  const logEndRef = useRef(null);

  // ── Handlers ──
  const handleSubmitPrompt = useCallback((finalPrompt) => {
    if (!finalPrompt?.trim()) return;
    if (!sendMessage) return;

    stopSpeaking();
    startTtsSession();
    startTimeRef.current = Date.now();

    const userMsg = { role: 'user', content: finalPrompt };
    dispatch(actions.addMessage(userMsg));
    dispatch(actions.clearLogs());
    dispatch(actions.setExecutionPlan(''));
    dispatch(actions.addReasoningGroup({
      query: finalPrompt,
      queryTimestamp: new Date().toLocaleTimeString(),
      entries: [],
    }));
    dispatch(actions.resetRun());
    setPrompt('');

    updateCurrentSession({
      messages: [...state.messages, userMsg],
      logs: [],
      executionPlan: '',
    }, true);

    sendMessage({
      type: 'start_task',
      prompt: finalPrompt,
      systemPromptType,
      sessionId: state.currentSessionId,
      mode: state.sessionMode,
    });
  }, [sendMessage, stopSpeaking, startTtsSession, dispatch, state.messages, state.currentSessionId, state.sessionMode, systemPromptType, updateCurrentSession]);

  const handleStopAgent = useCallback(() => {
    if (sendMessage) {
      sendMessage({ type: 'cancel', sessionId: state.currentSessionId });
      dispatch(actions.addLog({
        text: '[Client Command] Sent interruption request to stop the active agent process.',
        isSystem: true,
        timestamp: new Date().toLocaleTimeString(),
      }));
    }
  }, [sendMessage, state.currentSessionId, dispatch]);

  const handleApproval = useCallback((decision) => {
    if (!state.approvalRequest || !sendMessage) return;
    
    if (state.approvalRequest.type === 'edit_permission') {
      sendMessage({
        type: 'edit_permission_response',
        toolCallId: state.approvalRequest.toolCallId,
        decision,
        path: (state.approvalRequest.paths || [])[0] || '',
      });
      dispatch(actions.updateApprovalHistory(state.approvalRequest.toolCallId, {
        status: decision === 'deny' ? 'denied' : 'approved',
      }));
      dispatch(actions.setApprovalRequest(null));
      return;
    }
    
    sendMessage({
      type: 'approval_response',
      toolCallId: state.approvalRequest.toolCallId,
      approved: decision,
    });
    dispatch(actions.updateApprovalHistory(state.approvalRequest.toolCallId, {
      status: decision ? 'approved' : 'denied',
    }));
    dispatch(actions.setApprovalRequest(null));
  }, [state.approvalRequest, sendMessage, dispatch]);

  const handleSetSessionMode = useCallback((mode) => {
    dispatch(actions.setSessionMode(mode));
    if (sendMessage) {
      sendMessage({ type: 'mode_switch', sessionId: state.currentSessionId, mode });
    }
    updateCurrentSession({ mode }, true);
  }, [sendMessage, state.currentSessionId, dispatch, updateCurrentSession]);

  const handleManualCompact = useCallback(() => {
    if (sendMessage) {
      sendMessage({ type: 'compact', sessionId: state.currentSessionId });
      dispatch(actions.addLog({
        text: '[Client Command] Sent context compaction request to agent.',
        isSystem: true,
        timestamp: new Date().toLocaleTimeString(),
      }));
    }
  }, [sendMessage, state.currentSessionId, dispatch]);

  const saveAllSettings = useCallback(() => {
    const updatedConfig = {
      ...securityConfig,
      systemPromptType,
      litellm: { baseURL, apiKey, selectedNormalModel, selectedReasoningModel, taskMode },
    };
    fetch(`/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedConfig),
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setSecurityConfig(updatedConfig);
          fetchModels();
        }
      })
      .catch(err => console.error('Error saving settings:', err));
  }, [securityConfig, systemPromptType, baseURL, apiKey, selectedNormalModel, selectedReasoningModel, taskMode, fetchModels]);

  const addConfigItem = useCallback((field, subfield, val, setVal) => {
    if (!val.trim() || !securityConfig) return;
    const updated = { ...securityConfig };
    updated[field][subfield].push(val.trim());
    setSecurityConfig(updated);
    setVal('');
  }, [securityConfig]);

  const removeConfigItem = useCallback((field, subfield, index) => {
    if (!securityConfig) return;
    const updated = { ...securityConfig };
    updated[field][subfield].splice(index, 1);
    setSecurityConfig(updated);
  }, [securityConfig]);

  // ── Markdown ──
  const renderMarkdown = useCallback((text: string) => {
    try {
      const raw = marked.parse(text || '', { breaks: true }) as string;
      const clean = DOMPurify.sanitize(raw);
      return { __html: clean };
    } catch {
      return { __html: text || '' };
    }
  }, []);

  // ── Tool helpers ──
  const getToolSummary = useCallback((tool) => {
    const args = tool.arguments || {};
    if (tool.name === 'bash') return `Ran shell command: ${args.command || ''}`;
    if (tool.name === 'write') return `Created file: ${args.path || ''}`;
    if (tool.name === 'edit') return `Edited file: ${args.path || ''}`;
    if (tool.name === 'read') return `Read file: ${args.path || ''}`;
    if (tool.name === 'find') return `Searched files: ${args.pattern || ''}`;
    if (tool.name.includes('lightpanda')) {
      if (args.url) return `Navigated browser to: ${args.url}`;
      return `Browser action: ${tool.name.replace(/.*lightpanda_/, '')}`;
    }
    return `Called tool: ${tool.name}`;
  }, []);

  const getToolOutput = useCallback((result) => {
    if (!result) return 'No output returned.';
    if (typeof result === 'string') return result;
    if (result.content && Array.isArray(result.content)) {
      return result.content.map(c => c.text || JSON.stringify(c)).join('\n');
    }
    if (result.text) return result.text;
    return JSON.stringify(result, null, 2);
  }, []);

  // ── Status ──
  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setCmdPaletteOpen(prev => !prev);
      }
      if (e.key === 'Escape' && !cmdPaletteOpen) {
        if (state.status === 'thinking' || state.status === 'executing') {
          handleStopAgent();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [state.status, cmdPaletteOpen, handleStopAgent]);

  const getStatusColor = useCallback(() => {
    switch (state.status) {
      case 'thinking': return 'var(--accent-info)';
      case 'executing': return 'var(--accent-primary)';
      case 'waiting_approval': return 'var(--accent-warning)';
      case 'done': return 'var(--accent-success)';
      case 'error': return 'var(--accent-danger)';
      default: return 'var(--text-tertiary)';
    }
  }, [state.status]);

  const getStatusLabel = useCallback(() => {
    switch (state.status) {
      case 'thinking': return 'Thinking';
      case 'executing': return 'Executing';
      case 'waiting_approval': return 'Awaiting Approval';
      case 'done': return 'Done';
      case 'error': return 'Error';
      default: return 'Idle';
    }
  }, [state.status]);

  // ── Mobile nav ──
  const bottomNavItems = [
    { id: 'chat', label: 'Chat', icon: <MessageSquare size={18} /> },
    { id: 'logs', label: 'Logs', icon: <List size={18} /> },
    { id: 'metrics', label: 'Metrics', icon: <BarChart3 size={18} /> },
    { id: 'settings', label: 'Settings', icon: <Cog size={18} /> },
  ];

  const handleNavTabChange = useCallback((tabId) => {
    setActiveNavTab(tabId);
    if (tabId === 'logs' || tabId === 'metrics' || tabId === 'settings') {
      setShowThinking(true);
      setRightPanelTab(tabId === 'logs' ? 'console' : tabId === 'metrics' ? 'agent' : 'settings');
    }
  }, []);

  // ── Session switch with WebSocket cancel ──
  const handleSwitchSession = useCallback((sessionId) => {
    stopSpeaking();
    // Cancel old session's agent
    if (sendMessage && state.currentSessionId) {
      sendMessage({ type: 'cancel_session', sessionId: state.currentSessionId });
    }
    switchSession(sessionId);
  }, [stopSpeaking, sendMessage, state.currentSessionId, switchSession]);

  // ── Load older messages ──
  const handleLoadOlderMessages = useCallback((container) => {
    if (container && state.visibleCount < state.messages.length) {
      const prevHeight = container.scrollHeight;
      dispatch(actions.setVisibleCount(Math.min(state.visibleCount + 10, state.messages.length)));
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight - prevHeight;
      });
    }
  }, [state.visibleCount, state.messages.length, dispatch]);

  // ── JSX ──
  return (
    <ErrorBoundary>
    <AppShell
      sidebar={
        <SessionList
          sessions={sessions}
          currentSessionId={state.currentSessionId}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          groupedSessions={groupedSessions}
          hoveredSessionId={hoveredSessionId}
          onHover={setHoveredSessionId}
          onLeave={() => setHoveredSessionId(null)}
          onSwitch={handleSwitchSession}
          onDelete={deleteSession}
          onNewSession={createSession}
          getSessionPreview={getSessionPreview}
          sessionsLength={sessions.length}
        />
      }
      rightPanel={
        <DetailPanel activeTab={rightPanelTab} onTabChange={setRightPanelTab}>
          {rightPanelTab === 'agent' && (
            <AgentTab
              metrics={state.metrics}
              status={state.status}
              approvalsHistory={state.approvalsHistory}
              subAgents={state.metrics.activeSubagents || []}
            />
          )}
          {rightPanelTab === 'workspace' && (
            <WorkspaceTab />
          )}
          {rightPanelTab === 'plan' && (
            <ExecutionPlan executionPlan={state.executionPlan} reasoningHistory={state.reasoningHistory} />
          )}
          {rightPanelTab === 'logs' && (
            <div style={{ padding: 'var(--space-4)', height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <LogViewer logs={state.logs} logEndRef={logEndRef} />
            </div>
          )}
          {rightPanelTab === 'settings' && (
            <div style={{ padding: 'var(--space-4)', height: '100%', overflowY: 'auto' }}>
              <SettingsPanel
                securityConfig={securityConfig}
                setSecurityConfig={setSecurityConfig}
                baseURL={baseURL} setBaseURL={setBaseURL}
                apiKey={apiKey} setApiKey={setApiKey}
                selectedNormalModel={selectedNormalModel} setSelectedNormalModel={setSelectedNormalModel}
                selectedReasoningModel={selectedReasoningModel} setSelectedReasoningModel={setSelectedReasoningModel}
                selectedVoice={selectedVoice} setSelectedVoice={setSelectedVoice}
                taskMode={taskMode} setTaskMode={setTaskMode}
                systemPromptType={systemPromptType} setSystemPromptType={setSystemPromptType}
                voiceResponse={state.voiceState === 'audio'}
                setVoiceResponse={(val) => dispatch(actions.setVoiceState(val ? 'audio' : 'disabled'))}
                autoCompactEnabled={autoCompactEnabled} setAutoCompactEnabled={setAutoCompactEnabled}
                autoCompactThreshold={autoCompactThreshold} setAutoCompactThreshold={setAutoCompactThreshold}
                models={models} voices={voices}
                onSave={saveAllSettings}
                onManualCompact={handleManualCompact}
                onAddConfigItem={addConfigItem} onRemoveConfigItem={removeConfigItem}
                newReadPath={newReadPath} setNewReadPath={setNewReadPath}
                newWritePath={newWritePath} setNewWritePath={setNewWritePath}
                newBlockedPath={newBlockedPath} setNewBlockedPath={setNewBlockedPath}
                newAllowedPrefix={newAllowedPrefix} setNewAllowedPrefix={setNewAllowedPrefix}
                newAutoApprove={newAutoApprove} setNewAutoApprove={setNewAutoApprove}
                sessionMode={state.sessionMode}
                onSetSessionMode={handleSetSessionMode}
              />
            </div>
          )}
        </DetailPanel>
      }
      headerProps={{
        status: getStatusLabel(),
        getStatusColor,
        showThinking,
        onToggleThinking: () => {
          if (showThinking && rightPanelTab !== 'settings') {
            setShowThinking(false);
          } else {
            if (rightPanelTab === 'settings') setRightPanelTab('logs');
            setShowThinking(true);
          }
        },
        showSettings: showThinking && rightPanelTab === 'settings',
        onToggleSettings: () => {
          if (showThinking && rightPanelTab === 'settings') {
            setShowThinking(false);
          } else {
            setRightPanelTab('settings');
            setShowThinking(true);
          }
        },
        theme, mounted, onToggleTheme: toggleTheme,
        notificationCenter: <NotificationCenter logs={state.logs} />,
      }}
      bottomNavItems={bottomNavItems}
      activeNavTab={activeNavTab}
      onNavTabChange={handleNavTabChange}
    >
      <ChatArea
        messages={state.messages.slice(-state.visibleCount)}
        hasMoreMessages={state.messages.length > state.visibleCount}
        onLoadOlder={handleLoadOlderMessages}
        systemPromptType={systemPromptType}
        onSetSystemPromptType={setSystemPromptType}
        status={state.status}
        renderMarkdown={renderMarkdown}
        expandedTools={state.expandedTools}
        toggleTool={(id) => dispatch(actions.toggleTool(id))}
        getToolSummary={getToolSummary}
        getToolOutput={getToolOutput}
        chatEndRef={chatEndRef}
        metrics={state.metrics}
        approvalRequest={state.approvalRequest}
        onApprove={(d) => handleApproval(d !== undefined ? d : true)}
        onDeny={() => handleApproval(state.approvalRequest?.type === 'edit_permission' ? 'deny' : false)}
        sessionMode={state.sessionMode}
        showModePrompt={state.showModePrompt}
        onSetSessionMode={handleSetSessionMode}
        onSetSessionModeAndReRun={(mode) => {
          handleSetSessionMode(mode);
          const userMsgs = state.messages.filter(m => m.role === 'user');
          const lastPrompt = userMsgs.length > 0 ? userMsgs[userMsgs.length - 1].content : null;
          if (lastPrompt && sendMessage) {
            dispatch(actions.resetRun());
            startTtsSession();
            startTimeRef.current = Date.now();
            sendMessage({
              type: 'mode_switch_rerun',
              sessionId: state.currentSessionId,
              mode,
              prompt: lastPrompt,
              systemPromptType,
            });
          }
        }}
        prompt={prompt}
        setPrompt={setPrompt}
        voiceState={state.voiceState}
        onVoiceStateToggle={() => {
          dispatch(actions.setVoiceState(
            state.voiceState === 'audio' ? 'mute' : state.voiceState === 'mute' ? 'disabled' : 'audio'
          ));
        }}
        onToggleListening={() => {
          if (isListening) {
            stopListening();
          } else {
            startListening((text) => {
              setPrompt(text);
              handleSubmitPrompt(text);
            });
          }
        }}
        isListening={isListening}
        onSubmit={handleSubmitPrompt}
        onStop={handleStopAgent}
        inputHistoryRef={inputHistoryRef}
        inputHistoryIndexRef={inputHistoryIndexRef}
        showEmptyState={true}
      />
    </AppShell>
      <CommandPalette
        isOpen={cmdPaletteOpen}
        onClose={() => setCmdPaletteOpen(false)}
        handlers={{
          onNewSession: createSession,
          onToggleSidebar: () => {},
          onTogglePanel: () => setShowThinking(prev => !prev),
          onStop: handleStopAgent,
          onCompact: handleManualCompact,
          onOpenSettings: () => { setRightPanelTab('settings'); setShowThinking(true); },
          onToggleLogs: () => { setRightPanelTab('logs'); setShowThinking(true); },
          onToggleWorkspace: () => { setRightPanelTab('workspace'); setShowThinking(true); },
          onSetTheme: setTheme,
        }}
      />
    </ErrorBoundary>
  );
}
