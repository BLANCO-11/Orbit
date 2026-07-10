'use client';

import React, { useRef } from 'react';
import ApprovalBanner from '@/components/ApprovalBanner';
import ChatMessage, { ChatEmptyState } from '@/components/ChatMessage';
import { ModeBadge, ModePrompt } from './ModePrompt';
import ChatInput from './ChatInput';
import ModeSelector from './ModeSelector';
import PromptTypeSelector from './PromptTypeSelector';

/**
 * ChatArea — The central chat column.
 *
 * Composes:
 *   Approval banner (HITL overlay)
 *   Mode badge or mode prompt
 *   Chat message list
 *   Live progress banner
 *   Chat input bar (with mic, TTS, mode selector, textarea, send/stop)
 */
export default function ChatArea({
  messages,
  status,
  renderMarkdown,
  expandedTools,
  toggleTool,
  getToolSummary,
  getToolOutput,
  chatEndRef,
  metrics,
  hasMoreMessages,
  onLoadOlder,

  // Approval
  approvalRequest,
  onApprove,
  onDeny,

  // Mode
  sessionMode,
  showModePrompt,
  onSetSessionMode,
  onSetSessionModeAndReRun,

  // Prompt Type
  systemPromptType,
  onSetSystemPromptType,

  // Input
  prompt,
  setPrompt,
  voiceState,
  onVoiceStateToggle,
  onToggleListening,
  isListening,
  onSubmit,
  onStop,
  inputHistoryRef,
  inputHistoryIndexRef,

  // Empty state
  showEmptyState,
}) {
  const containerRef = useRef(null);

  const handleScroll = (e) => {
    const container = e.currentTarget;
    if (container.scrollTop === 0 && onLoadOlder && hasMoreMessages) {
      onLoadOlder(container);
    }
  };

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        padding: 'var(--space-5)',
        overflow: 'hidden',
      }}
    >
      {/* ── HITL Approval Banner ── */}
      <ApprovalBanner
        approvalRequest={approvalRequest}
        onApprove={(decision) => onApprove(decision !== undefined ? decision : true)}
        onDeny={() => onDeny(approvalRequest?.type === 'edit_permission' ? 'deny' : false)}
      />

      {/* ── Mode Badge ── */}
      {sessionMode && !showModePrompt && (
        <ModeBadge sessionMode={sessionMode} />
      )}

      {/* ── Mode Prompt ── */}
      {showModePrompt && <ModePrompt onSetMode={onSetSessionMode} />}

      {/* ── Chat Messages ── */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          maxWidth: '900px',
          margin: '0 auto',
          width: '100%',
          minHeight: 0,
          overflowY: 'auto',
          paddingBottom: 'var(--space-5)',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-4)',
          }}
        >
          {hasMoreMessages && (
            <div style={{
              textAlign: 'center',
              padding: '6px 0',
              fontSize: '0.72rem',
              color: 'var(--text-tertiary)',
              borderBottom: '1px dashed var(--border-subtle)',
              marginBottom: '6px'
            }}>
              Scroll up or click <span style={{ color: 'var(--accent-primary)', cursor: 'pointer', textDecoration: 'underline', fontWeight: '600' }} onClick={() => onLoadOlder && onLoadOlder(containerRef.current)}>here</span> to load older messages
            </div>
          )}
          {messages.length === 0 && showEmptyState && <ChatEmptyState />}
          {messages.map((msg, i) => (
            <ChatMessage
              key={i}
              message={msg}
              renderMarkdown={renderMarkdown}
              expandedTools={expandedTools}
              toggleTool={toggleTool}
              getToolSummary={getToolSummary}
              getToolOutput={getToolOutput}
              onSetSessionMode={onSetSessionMode}
              onSetSessionModeAndReRun={onSetSessionModeAndReRun}
              sessionMode={sessionMode}
            />
          ))}
          <div ref={chatEndRef} />
        </div>
      </div>

      {/* ── Live Progress Banner ── */}
      {(status === 'thinking' || status === 'executing') && (
        <div
          className="animate-fade-in"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '10px 16px',
            maxWidth: '900px',
            width: '100%',
            margin: '0 auto var(--space-3) auto',
            background: 'var(--accent-info-muted)',
            border: '1px solid color-mix(in oklch, var(--accent-info) 25%, transparent)',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.8rem',
            color: 'var(--accent-info)',
          }}
        >
          <div
            className="pulsing-mic"
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: 'var(--accent-info)',
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontWeight: '500',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {status === 'thinking'
              ? 'Agent is thinking and planning...'
              : 'Working on your task...'}
            {metrics?.actionFeed?.[0]?.text
              ? ` ${metrics.actionFeed[0].text}`
              : ''}
          </span>
        </div>
      )}

      {/* ── Chat Input ── */}
      <ChatInput
        prompt={prompt}
        setPrompt={setPrompt}
        status={status}
        voiceState={voiceState}
        onVoiceStateToggle={onVoiceStateToggle}
        onToggleListening={onToggleListening}
        isListening={isListening}
        onSubmit={onSubmit}
        onStop={onStop}
        inputHistoryRef={inputHistoryRef}
        inputHistoryIndexRef={inputHistoryIndexRef}
        modeButton={
          <ModeSelector
            sessionMode={sessionMode}
            onSetSessionMode={onSetSessionMode}
          />
        }
        promptTypeButton={
          <PromptTypeSelector
            systemPromptType={systemPromptType}
            onSetSystemPromptType={onSetSystemPromptType}
          />
        }
      />
    </div>
  );
}
