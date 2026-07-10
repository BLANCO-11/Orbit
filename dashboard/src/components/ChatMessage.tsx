// @ts-nocheck
'use client';

import React, { useState } from 'react';
import { Check, Copy, ChevronDown, ChevronRight, Loader2, CheckCircle2, Shield, Edit3, Zap, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * ChatMessage — Clean text-block style message.
 * No bubbles. Left border indicates role. Tool calls inline.
 */
export default function ChatMessage({
  message, renderMarkdown,
  expandedTools, toggleTool,
  getToolSummary, getToolOutput,
  onSetSessionMode, onSetSessionModeAndReRun, sessionMode,
}) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';

  if (message.isModeSuggestion) {
    return (
      <ModeSuggestionCard
        message={message}
        sessionMode={sessionMode}
        onSetMode={onSetSessionMode}
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

  return (
    <div className="mb-2 flex w-full flex-col">
      {/* Role + timestamp row */}
      <div className="mb-1 flex items-center justify-between pl-3">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold ${isUser ? 'text-primary' : 'text-muted-foreground'}`}>
            {isUser ? 'You' : 'AegisAgent'}
          </span>
          {time && <span className="text-[0.65rem] text-muted-foreground/70">{time}</span>}
        </div>
        {!isUser && (
          <Button variant="ghost" size="xs" onClick={handleCopy} className={copied ? 'text-success' : 'text-muted-foreground'}>
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        )}
      </div>

      {/* Message content */}
      <div className={`border-l-[3px] py-2 px-4 text-[0.9rem] leading-relaxed ${isUser ? 'border-primary' : 'border-muted-foreground/40'}`}>
        {isUser ? (
          <div className="whitespace-pre-wrap">{message.content}</div>
        ) : (
          <div className="markdown-content" dangerouslySetInnerHTML={renderMarkdown(message.content)} />
        )}
      </div>

      {/* Latency */}
      {isAssistant && message.latency && (
        <div className="mt-0.5 pl-4 text-[0.68rem] text-muted-foreground">
          Completed in {message.latency}s
        </div>
      )}

      {/* Tool calls — inline */}
      {message.tools && message.tools.length > 0 && (
        <div className="mt-1.5 pl-4">
          <ToolGroupInline
            tools={message.tools}
            expandedTools={expandedTools}
            toggleTool={toggleTool}
            getToolSummary={getToolSummary}
            getToolOutput={getToolOutput}
          />
        </div>
      )}

      <div className="mx-3 mt-3 mb-0 h-px bg-border" />
    </div>
  );
}

// ── Tool Group (Inline, Collapsible) ────────────────────────────

function ToolGroupInline({ tools, expandedTools, toggleTool, getToolSummary, getToolOutput }) {
  const [isExpanded, setIsExpanded] = useState(true);
  const runningTools = tools.filter((t) => t.status === 'running');
  const isRunning = runningTools.length > 0;
  const totalCalls = tools.length;
  const uniqueNames = [...new Set(tools.map((t) => t.name))].join(', ');

  return (
    <div className="overflow-hidden rounded-md border border-border bg-muted/50 text-[0.78rem]">
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setIsExpanded(!isExpanded); }
        }}
        className="flex cursor-pointer select-none items-center justify-between px-2.5 py-1.5"
      >
        <div className="flex flex-1 items-center gap-1.5 overflow-hidden">
          {isRunning ? (
            <Loader2 size={12} className="shrink-0 animate-spin text-warning" />
          ) : (
            <CheckCircle2 size={12} className="shrink-0 text-success" />
          )}
          <span className="overflow-hidden text-ellipsis whitespace-nowrap font-medium">
            {isRunning ? getToolSummary(runningTools[runningTools.length - 1]) : `${totalCalls} tool${totalCalls > 1 ? 's' : ''} used`}
          </span>
          <span className="text-[0.7rem] text-muted-foreground">({uniqueNames})</span>
        </div>
        <div className="ml-2 flex items-center gap-1 text-muted-foreground">
          <span className="text-[0.68rem]">{isExpanded ? 'Hide' : `Show ${totalCalls}`}</span>
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </div>
      </div>

      {isExpanded && (
        <div className="flex flex-col gap-1.5 border-t border-border p-2">
          {tools.map((tool) => (
            <ToolCallCard
              key={tool.id}
              tool={tool}
              isExpanded={!!expandedTools[tool.id]}
              onToggle={() => toggleTool(tool.id)}
              getToolSummary={getToolSummary}
              getToolOutput={getToolOutput}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Single Tool Call Card ───────────────────────────────────────

function ToolCallCard({ tool, isExpanded, onToggle, getToolSummary, getToolOutput }) {
  const isRunning = tool.status === 'running';

  return (
    <div className="overflow-hidden rounded border border-border">
      <div
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        className={`flex cursor-pointer select-none items-center gap-1.5 border-l-2 px-2 py-1 text-xs ${
          isRunning ? 'border-warning' : 'border-success'
        }`}
      >
        {isRunning ? (
          <Loader2 size={10} className="animate-spin text-warning" />
        ) : (
          <CheckCircle2 size={10} className="text-success" />
        )}
        <span className="font-medium">{tool.name}</span>
        <span className="ml-auto text-[0.65rem] text-muted-foreground">
          {tool.latencyMs ? `${tool.latencyMs}ms` : isRunning ? 'running' : 'done'}
        </span>
        {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
      </div>
      {isExpanded && (
        <div className="border-t border-border bg-black/5 p-2 dark:bg-white/5">
          <div className="mb-1 text-[0.7rem] text-muted-foreground">{getToolSummary(tool)}</div>
          {tool.result && (
            <pre className="max-h-[150px] overflow-x-auto whitespace-pre-wrap break-words rounded bg-background p-1.5 font-mono text-[0.7rem]">
              {getToolOutput(tool.result)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ── Mode Suggestion Card ────────────────────────────────────────

function ModeSuggestionCard({ message, sessionMode, onSetMode, onReRun }) {
  const modes = {
    plan: { label: 'Plan Mode', desc: 'Plan then approve', icon: Shield, color: 'text-chart-3' },
    edit: { label: 'Edit Mode', desc: 'Read free, write needs approval', icon: Edit3, color: 'text-warning' },
    yolo: { label: 'YOLO Mode', desc: 'Full autonomous execution', icon: Zap, color: 'text-destructive' },
  };
  const suggested = modes[message.suggestedMode] || modes.plan;

  return (
    <div className="mb-3 rounded-md border border-warning/40 border-l-[3px] border-l-warning bg-warning/10 px-4 py-3">
      <div className="mb-1.5 flex items-center gap-1.5 font-semibold text-warning">
        <Shield size={14} /> Mode Change Suggested
      </div>
      <div className="mb-2.5 text-[0.85rem]">
        {message.reason || 'The agent needs a different mode to perform this action.'}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(modes).map(([key, m]) => (
          <Button
            key={key}
            variant={key === message.suggestedMode ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => onSetMode(key)}
          >
            <m.icon size={14} className={m.color} />
            {m.label}
          </Button>
        ))}
        {onReRun && (
          <Button size="sm" onClick={() => onReRun(message.suggestedMode || 'plan')}>
            <Play size={12} fill="currentColor" /> Switch &amp; Re-run
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Empty State ─────────────────────────────────────────────────

export function ChatEmptyState() {
  return (
    <div className="mx-auto my-20 max-w-[400px] text-center text-muted-foreground">
      <h3 className="mb-2 text-[1.1rem] font-semibold text-foreground">AegisAgent Active</h3>
      <p className="text-[0.85rem] leading-normal">
        Speak or type to delegate OS operations, write code, run audits, or browse web applications.
      </p>
    </div>
  );
}
