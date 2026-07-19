// @ts-nocheck
'use client';

import React, { useState } from 'react';
import { useOrbitState } from '@/providers/OrbitProvider';
import {
  Check, Copy, ChevronDown, ChevronRight, Loader2, CheckCircle2,
  Shield, Edit3, Zap, Play, FileText, Search, Terminal, Globe, Wrench,
} from 'lucide-react';
import Banner from './chat/Banner';
import MarkdownMessage from './chat/MarkdownMessage';
import { getMode } from '@/lib/modes';

const TOOL_ICONS = {
  read: FileText,
  write: FileText,
  edit: Edit3,
  find: Search,
  grep: Search,
  bash: Terminal,
};

function toolIcon(name = '') {
  if (name.includes('lightpanda') || name.includes('browser')) return Globe;
  return TOOL_ICONS[name] || Wrench;
}

/**
 * ChatMessage — user messages as right-aligned accent bubbles,
 * assistant messages as avatar + prose with inline tool-call cards.
 */
function ChatMessageBase({
  message,
  expandedTools, toggleTool,
  getToolSummary, getToolOutput,
  onSetSessionMode, onSetSessionModeAndReRun, sessionMode,
}) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';

  if (message.isModeSuggestion) {
    const MODE_RANK = { '': -1, chat: 0, plan: 1, edit: 2, yolo: 3 };
    const currentRank = MODE_RANK[sessionMode || ''] ?? -1;
    const suggestedRank = MODE_RANK[message.suggestedMode || ''] ?? -1;
    if (currentRank >= suggestedRank) {
      return null;
    }
    return (
      <ModeSuggestionCard
        message={message}
        onReRun={onSetSessionModeAndReRun}
      />
    );
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const time = message.timestamp || '';

  // ── User: right-aligned bubble ──
  if (isUser) {
    return (
      <div className="animate-msg-in flex flex-col items-end">
        <div className="mb-1.5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-faint">
          You {time && <span className="font-medium normal-case tracking-normal">{time}</span>}
        </div>
        <div className="max-w-[460px] rounded-[14px] rounded-br-[4px] bg-primary px-3.5 py-2.5 text-[14.5px] text-primary-foreground shadow-card">
          <div className="whitespace-pre-wrap">{message.content}</div>
        </div>
      </div>
    );
  }

  // ── Assistant: avatar + prose + tools ──
  return (
    <div className="animate-msg-in flex gap-3">
      <div className="grid size-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-primary/80 to-primary text-white">
        <Shield size={15} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-faint">
          Orbit
          {time && <span className="font-medium normal-case tracking-normal">{time}</span>}
          <button
            onClick={handleCopy}
            className={`ml-auto flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium normal-case tracking-normal transition-colors ${
              copied ? 'text-success' : 'text-faint hover:text-foreground'
            }`}
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>

        {message.tools && message.tools.length > 0 && (
          <ToolGroup
            tools={message.tools}
            expandedTools={expandedTools}
            toggleTool={toggleTool}
            getToolSummary={getToolSummary}
            getToolOutput={getToolOutput}
          />
        )}

        {message.content && (
          <MarkdownMessage
            content={message.content}
            className={message.tools && message.tools.length > 0 ? 'mt-3' : ''}
          />
        )}

        {message.latency && (
          <div className="mt-1 text-[11px] text-faint">Completed in {message.latency}s</div>
        )}
      </div>
    </div>
  );
}

/**
 * While the agent streams, the reducer replaces ONLY the last message object on
 * every token; all earlier message objects keep their reference. Without
 * memoization, React still re-renders the whole list each token — re-parsing
 * every prior bubble's markdown — which compounded the streaming stutter. Skip a
 * bubble's re-render unless something that
 * actually changes its output changed. Function props are intentionally omitted:
 * toggleTool only closes over dispatch, and onSetSessionModeAndReRun is only
 * live on the (always-re-rendered) last message, so their changing identity must
 * NOT force every bubble to re-render.
 */
function chatMessagePropsEqual(prev, next) {
  return (
    prev.message === next.message &&
    prev.expandedTools === next.expandedTools &&
    prev.sessionMode === next.sessionMode &&
    prev.getToolSummary === next.getToolSummary &&
    prev.getToolOutput === next.getToolOutput
  );
}

const ChatMessage = React.memo(ChatMessageBase, chatMessagePropsEqual);
export default ChatMessage;

// ── Tool group card ─────────────────────────────────────────────

function ToolGroup({ tools, expandedTools, toggleTool, getToolSummary, getToolOutput }) {
  const { status } = useOrbitState();
  const isSessionRunning = status === 'running' || status === 'connecting';

  // Hidden/collapsed by default — only a compact affordance shows; never
  // auto-expands, even while tools are running (kills the streaming noise).
  const [isExpanded, setIsExpanded] = useState(false);
  const running = tools.filter((t) => t.status === 'running' && isSessionRunning);
  const isRunning = running.length > 0;
  const names = [...new Set(tools.map((t) => t.name))].join(' · ');
  const lastStatus = isRunning
    ? getToolSummary(running[running.length - 1])
    : `done · ${names}`;

  return (
    <div className="overflow-hidden rounded-[11px] border border-border bg-card shadow-card">
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setIsExpanded(!isExpanded); } }}
        className="flex cursor-pointer select-none items-center gap-2 px-3 py-[9px]"
      >
        {isRunning ? (
          <Loader2 size={15} className="shrink-0 animate-spin text-warning" />
        ) : (
          <Wrench size={14} className="shrink-0 text-faint" />
        )}
        <span className="text-[12.5px] font-semibold">
          {tools.length} tool{tools.length > 1 ? 's' : ''}
        </span>
        <span className="overflow-hidden text-ellipsis whitespace-nowrap text-xs text-faint">{lastStatus}</span>
        {isExpanded ? (
          <ChevronDown size={14} className="ml-auto shrink-0 text-faint" />
        ) : (
          <ChevronRight size={14} className="ml-auto shrink-0 text-faint" />
        )}
      </div>

      {isExpanded && tools.map((tool) => (
        <ToolRow
          key={tool.id}
          tool={tool}
          isExpanded={!!expandedTools[tool.id]}
          onToggle={() => toggleTool(tool.id)}
          getToolSummary={getToolSummary}
          getToolOutput={getToolOutput}
        />
      ))}
    </div>
  );
}

function ToolRow({ tool, isExpanded, onToggle, getToolSummary, getToolOutput }) {
  const { status } = useOrbitState();
  const isSessionRunning = status === 'running' || status === 'connecting';
  const isRunning = tool.status === 'running' && isSessionRunning;
  const isInterrupted = tool.status === 'running' && !isSessionRunning;

  const Icon = toolIcon(tool.name);
  const target = (() => {
    const a = tool.arguments || {};
    return a.path || a.command || a.pattern || a.url || '';
  })();

  return (
    <div className="border-t border-border-soft">
      <div
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        className="flex cursor-pointer select-none items-center gap-2 px-3 py-[7px] text-[12.5px] hover:bg-muted/60"
      >
        {isRunning ? (
          <Loader2 size={13} className="shrink-0 animate-spin text-warning" />
        ) : (
          <Icon size={13} className={`shrink-0 ${isInterrupted ? 'text-faint/60 opacity-60' : 'text-faint'}`} />
        )}
        <span className={`font-medium ${isInterrupted ? 'text-muted-foreground/80' : ''}`}>{tool.name}</span>
        {target && (
          <span className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-xs text-faint">{target}</span>
        )}
        <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-faint">
          {tool.latencyMs ? `${tool.latencyMs}ms` : isRunning ? 'running' : isInterrupted ? 'interrupted' : 'done'}
        </span>
        {isExpanded ? <ChevronDown size={12} className="shrink-0 text-faint" /> : <ChevronRight size={12} className="shrink-0 text-faint" />}
      </div>
      {isExpanded && (
        <div className="border-t border-border-soft bg-muted/40 px-3 py-2">
          <div className="mb-1 text-xs text-muted-foreground">{isInterrupted ? 'Tool call was cancelled or interrupted.' : getToolSummary(tool)}</div>
          {tool.result && (
            <pre className="max-h-[180px] overflow-auto whitespace-pre-wrap break-words rounded-md bg-background p-2 font-mono text-[11.5px] leading-relaxed">
              {getToolOutput(tool.result)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ── Mode suggestion card ────────────────────────────────────────

// Compact, single-line mode prompt (Workstream D3). After Workstream A this
// fires far less often, so it's a one-liner — the reason plus one primary
// action — not a heading + three mode buttons. Mode metadata comes from the
// single source in @/lib/modes (Workstream D1).
function ModeSuggestionCard({ message, onReRun }) {
  const suggested = getMode(message.suggestedMode) || getMode('plan');
  const Icon = suggested.icon;

  return (
    <Banner tone="warning" className="flex items-center gap-3">
      <Icon size={15} className={`shrink-0 ${suggested.color}`} />
      <span className="min-w-0 flex-1 text-[13px] text-muted-foreground">
        {message.reason || `This action needs ${suggested.label} mode.`}
      </span>
      {onReRun && (
        <button
          onClick={() => onReRun(message.suggestedMode || 'plan')}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-[12.5px] font-semibold text-primary-foreground hover:opacity-90"
        >
          <Play size={12} fill="currentColor" /> Switch to {suggested.label} &amp; re-run
        </button>
      )}
    </Banner>
  );
}

// ── Empty state ─────────────────────────────────────────────────

export function ChatEmptyState() {
  return (
    <div className="mx-auto my-24 flex max-w-sm flex-col items-center text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-primary/80 to-primary text-white shadow-card">
        <Shield size={22} />
      </div>
      <h3 className="mb-1.5 text-[17px] font-semibold tracking-tight">Orbit ready</h3>
      <p className="text-[13.5px] leading-relaxed text-muted-foreground">
        Delegate OS operations, write code, run audits, or browse the web — by voice or text.
      </p>
    </div>
  );
}
