'use client';

import React, { useRef } from 'react';
import ApprovalBanner from '@/components/ApprovalBanner';
import ChatMessage, { ChatEmptyState } from '@/components/ChatMessage';
import ReasoningAccordion from './ReasoningAccordion';
import { ModeBadge, ModePrompt } from './ModePrompt';
import ChatInput from './ChatInput';
import ModeSelector from './ModeSelector';
import PromptTypeSelector from './PromptTypeSelector';
import SkillSelector from './SkillSelector';
import EffortSelector from './EffortSelector';
import HarnessSelector from './HarnessSelector';
import ProfileSelector from './ProfileSelector';

/**
 * ChatArea — the central conversation column.
 * Messages scroll under a floating, frosted input dock.
 */
export default function ChatArea({
  messages,
  reasoningHistory = [],
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

  // Prompt type
  systemPromptType,
  onSetSystemPromptType,

  // Skills
  attachedSkills,
  onSetAttachedSkills,

  // Effort
  effort,
  onSetEffort,

  // Harness
  harnessId,
  onSetHarnessId,

  // Profile
  activeProfileId,
  onApplyProfile,

  // Resume
  canResume,
  onResume,

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

  showEmptyState,
}) {
  const containerRef = useRef(null);

  const handleScroll = (e) => {
    const container = e.currentTarget;
    if (container.scrollTop === 0 && onLoadOlder && hasMoreMessages) {
      onLoadOlder(container);
    }
  };

  const isProcessing = status === 'thinking' || status === 'executing';
  const lastAction = metrics?.actionFeed?.[metrics.actionFeed.length - 1]?.toolName;

  return (
    <>
      {/* ── Scrolling conversation ── */}
      <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-6 pb-40 pt-7">
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6">
          <ApprovalBanner
            approvalRequest={approvalRequest}
            onApprove={(decision) => onApprove(decision !== undefined ? decision : true)}
            onDeny={() => onDeny(approvalRequest?.type === 'edit_permission' ? 'deny' : false)}
          />

          {canResume && (
            <div className="flex items-center gap-3 rounded-[11px] border border-warning/40 bg-warning/8 px-4 py-3">
              <span className="text-[13px] text-muted-foreground">
                This session was <span className="font-semibold text-warning">interrupted</span> mid-run. Resume to continue where it left off.
              </span>
              <button onClick={onResume} className="ml-auto shrink-0 rounded-lg bg-primary px-3.5 py-1.5 text-[12.5px] font-semibold text-primary-foreground hover:opacity-90">
                Resume
              </button>
            </div>
          )}

          {sessionMode && !showModePrompt && <ModeBadge sessionMode={sessionMode} />}
          {showModePrompt && <ModePrompt onSetMode={onSetSessionMode} />}

          {hasMoreMessages && (
            <div className="border-b border-dashed border-border pb-2 text-center text-xs text-faint">
              Scroll up or{' '}
              <button
                onClick={() => onLoadOlder && onLoadOlder(containerRef.current)}
                className="font-semibold text-primary hover:underline"
              >
                load older messages
              </button>
            </div>
          )}

          {messages.length === 0 && showEmptyState && <ChatEmptyState />}

          {(() => {
            // Interleave per-turn reasoning accordions after each user message.
            // Messages are windowed (slice(-visibleCount)) so match groups by
            // query content, consuming each group at most once.
            const used = new Set();
            let userTurn = 0;
            return messages.map((msg, i) => {
              const isUser = msg.role === 'user';
              let group = null;
              if (isUser) {
                userTurn++;
                group = reasoningHistory.find(
                  (g, gi) => !used.has(gi) && g.query === msg.content && (used.add(gi) || true)
                ) || null;
              }
              return (
                <React.Fragment key={i}>
                  <ChatMessage
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
                  {group && group.entries?.length > 0 && (
                    <ReasoningAccordion group={group} turnIndex={userTurn} />
                  )}
                </React.Fragment>
              );
            });
          })()}
          <div ref={chatEndRef} />
        </div>
      </div>

      {/* ── Floating dock ── */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 px-6 pb-5">
        <div className="mx-auto w-full max-w-[720px]">
          {isProcessing && (
            <div className="pointer-events-auto mb-2.5 flex items-center gap-2.5 rounded-xl border border-primary/25 bg-accent px-4 py-2.5 text-[13px] font-medium text-accent-foreground shadow-card">
              <span className="size-2 shrink-0 animate-pulse rounded-full bg-primary" />
              <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                {status === 'thinking' ? 'Thinking through the task…' : 'Working on it…'}
                {lastAction ? ` (${lastAction})` : ''}
              </span>
            </div>
          )}

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
            profileButton={<ProfileSelector activeProfileId={activeProfileId} onApplyProfile={onApplyProfile} />}
            harnessButton={<HarnessSelector harnessId={harnessId} onSetHarnessId={onSetHarnessId} />}
            modeButton={<ModeSelector sessionMode={sessionMode} onSetSessionMode={onSetSessionMode} />}
            promptTypeButton={
              <PromptTypeSelector systemPromptType={systemPromptType} onSetSystemPromptType={onSetSystemPromptType} />
            }
            skillButton={
              <SkillSelector attachedSkills={attachedSkills || []} onSetAttachedSkills={onSetAttachedSkills} />
            }
            effortButton={
              <EffortSelector effort={effort} onSetEffort={onSetEffort} />
            }
          />
        </div>
      </div>
    </>
  );
}
