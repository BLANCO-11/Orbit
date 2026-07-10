// @ts-nocheck
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

  const currentTool = metrics?.actionFeed?.[metrics.actionFeed.length - 1]?.toolName;

  return (
    <div className="flex flex-1 flex-col overflow-hidden p-4 sm:p-5">
      <ApprovalBanner
        approvalRequest={approvalRequest}
        onApprove={(decision) => onApprove(decision !== undefined ? decision : true)}
        onDeny={() => onDeny(approvalRequest?.type === 'edit_permission' ? 'deny' : false)}
      />

      {sessionMode && !showModePrompt && <ModeBadge sessionMode={sessionMode} />}
      {showModePrompt && <ModePrompt onSetMode={onSetSessionMode} />}

      {/* ── Chat Messages ── */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="relative mx-auto flex w-full min-h-0 max-w-3xl flex-1 flex-col overflow-y-auto pb-5"
      >
        <div className="flex flex-col gap-4">
          {hasMoreMessages && (
            <div className="mb-1.5 border-b border-dashed border-border pb-1.5 text-center text-[0.72rem] text-muted-foreground">
              Scroll up or click{' '}
              <button
                onClick={() => onLoadOlder && onLoadOlder(containerRef.current)}
                className="font-semibold text-primary underline"
              >
                here
              </button>{' '}
              to load older messages
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
        <div className="mx-auto mb-3 flex w-full max-w-3xl animate-in fade-in items-center gap-2.5 rounded-lg border border-primary/25 bg-accent px-4 py-2.5 text-sm text-accent-foreground">
          <div className="size-2 shrink-0 animate-pulse rounded-full bg-primary" />
          <span className="overflow-hidden text-ellipsis whitespace-nowrap font-medium">
            {status === 'thinking' ? 'Agent is thinking and planning...' : 'Working on your task...'}
            {currentTool ? ` (${currentTool})` : ''}
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
        modeButton={<ModeSelector sessionMode={sessionMode} onSetSessionMode={onSetSessionMode} />}
        promptTypeButton={
          <PromptTypeSelector systemPromptType={systemPromptType} onSetSystemPromptType={onSetSystemPromptType} />
        }
      />
    </div>
  );
}
