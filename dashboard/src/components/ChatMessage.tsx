'use client';

import React, { useState } from 'react';
import { Check, Copy, ChevronDown, ChevronRight, Loader2, CheckCircle2, Shield, Edit3, Zap, Play } from 'lucide-react';

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

  // ── Mode suggestion ──
  if (message.isModeSuggestion) {
    return <ModeSuggestionCard message={message} sessionMode={sessionMode} onSetMode={onSetSessionMode} onReRun={onSetSessionModeAndReRun} />;
  }

  // ── Copy handler ──
  const handleCopy = () => {
    navigator.clipboard.writeText(message.content || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const time = message.timestamp || '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', marginBottom: 'var(--space-2)' }}>
      {/* Role + timestamp row */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: '4px', paddingLeft: '12px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{
            fontWeight: '600', fontSize: '0.75rem',
            color: isUser ? 'var(--accent-primary)' : 'var(--text-secondary)',
          }}>
            {isUser ? 'You' : 'AegisAgent'}
          </span>
          {time && <span style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)' }}>{time}</span>}
        </div>
        {!isUser && (
          <button onClick={handleCopy} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: copied ? 'var(--accent-success)' : 'var(--text-tertiary)',
            padding: '2px 6px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '4px',
            fontSize: '0.7rem', transition: 'color 0.15s ease',
          }}>
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
      </div>

      {/* Message content */}
      <div style={{
        padding: 'var(--space-2) var(--space-4)',
        borderLeft: `3px solid ${isUser ? 'var(--accent-primary)' : 'var(--text-tertiary)'}`,
        fontSize: '0.9rem', lineHeight: '1.6',
        color: 'var(--text-primary)',
      }}>
        {isUser ? (
          <div style={{ whiteSpace: 'pre-wrap' }}>{message.content}</div>
        ) : (
          <div className="markdown-content" dangerouslySetInnerHTML={renderMarkdown(message.content)} />
        )}
      </div>

      {/* Latency */}
      {isAssistant && message.latency && (
        <div style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', marginTop: '2px', paddingLeft: '16px' }}>
          Completed in {message.latency}s
        </div>
      )}

      {/* Tool calls — inline */}
      {message.tools && message.tools.length > 0 && (
        <div style={{ paddingLeft: '16px', marginTop: '6px' }}>
          <ToolGroupInline
            tools={message.tools}
            expandedTools={expandedTools}
            toggleTool={toggleTool}
            getToolSummary={getToolSummary}
            getToolOutput={getToolOutput}
          />
        </div>
      )}

      {/* Separator */}
      <div style={{ height: '1px', background: 'var(--border-subtle)', margin: 'var(--space-3) 0 var(--space-3) 12px' }} />
    </div>
  );
}

// ── Tool Group (Inline, Collapsible) ────────────────────────────

function ToolGroupInline({ tools, expandedTools, toggleTool, getToolSummary, getToolOutput }) {
  const [isExpanded, setIsExpanded] = useState(true);
  const runningTools = tools.filter(t => t.status === 'running');
  const isRunning = runningTools.length > 0;
  const totalCalls = tools.length;
  const uniqueNames = [...new Set(tools.map(t => t.name))].join(', ');

  return (
    <div style={{
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-sm)',
      background: 'var(--surface-secondary)',
      overflow: 'hidden',
      fontSize: '0.78rem',
    }}>
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setIsExpanded(!isExpanded); } }}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 10px', cursor: 'pointer', userSelect: 'none',
        }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, overflow: 'hidden' }}>
          {isRunning
            ? <Loader2 size={12} className="animate-spin" style={{ color: 'var(--accent-warning)', flexShrink: 0 }} />
            : <CheckCircle2 size={12} style={{ color: 'var(--accent-success)', flexShrink: 0 }} />
          }
          <span style={{ fontWeight: '500', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {isRunning ? getToolSummary(runningTools[runningTools.length - 1]) : `${totalCalls} tool${totalCalls > 1 ? 's' : ''} used`}
          </span>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>({uniqueNames})</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-tertiary)', marginLeft: '8px' }}>
          <span style={{ fontSize: '0.68rem' }}>{isExpanded ? 'Hide' : `Show ${totalCalls}`}</span>
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </div>
      </div>

      {isExpanded && (
        <div style={{ padding: '8px', borderTop: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {tools.map(tool => (
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
  const accentColor = isRunning ? 'var(--accent-warning)' : 'var(--accent-success)';

  return (
    <div style={{ border: '1px solid var(--border-subtle)', borderRadius: '4px', overflow: 'hidden' }}>
      <div
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        style={{
          display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 8px',
          cursor: 'pointer', userSelect: 'none', fontSize: '0.75rem',
          borderLeft: `2px solid ${accentColor}`,
      }}>
        {isRunning
          ? <Loader2 size={10} className="animate-spin" style={{ color: accentColor }} />
          : <CheckCircle2 size={10} style={{ color: accentColor }} />
        }
        <span style={{ fontWeight: '500', color: 'var(--text-primary)' }}>{tool.name}</span>
        <span style={{ color: 'var(--text-tertiary)', fontSize: '0.65rem', marginLeft: 'auto' }}>
          {tool.latencyMs ? `${tool.latencyMs}ms` : isRunning ? 'running' : 'done'}
        </span>
        {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
      </div>
      {isExpanded && (
        <div style={{ padding: '6px 8px', borderTop: '1px solid var(--border-subtle)', background: 'rgba(0,0,0,0.1)' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>{getToolSummary(tool)}</div>
          {tool.result && (
            <pre style={{
              fontSize: '0.7rem', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)',
              background: 'color-mix(in oklch, var(--bg-base) 80%, transparent)',
              padding: '6px', borderRadius: '4px', overflowX: 'auto', maxHeight: '150px',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
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
    plan: { label: 'Plan Mode', desc: 'Plan then approve', icon: Shield, color: 'var(--accent-info)' },
    edit: { label: 'Edit Mode', desc: 'Read free, write needs approval', icon: Edit3, color: 'var(--accent-warning)' },
    yolo: { label: 'YOLO Mode', desc: 'Full autonomous execution', icon: Zap, color: 'var(--accent-danger)' },
  };
  const suggested = modes[message.suggestedMode] || modes.plan;

  return (
    <div style={{
      border: '1px solid var(--accent-warning)',
      borderLeft: '3px solid var(--accent-warning)',
      borderRadius: 'var(--radius-sm)',
      background: 'var(--accent-warning-muted)',
      padding: 'var(--space-3) var(--space-4)',
      marginBottom: 'var(--space-3)',
    }}>
      <div style={{ fontWeight: '600', color: 'var(--accent-warning)', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
        <Shield size={14} /> Mode Change Suggested
      </div>
      <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', marginBottom: '10px' }}>
        {message.reason || 'The agent needs a different mode to perform this action.'}
      </div>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {Object.entries(modes).map(([key, m]) => (
          <button key={key} onClick={() => onSetMode(key)} style={{
            padding: '6px 12px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
            border: key === message.suggestedMode ? '1px solid var(--accent-warning)' : '1px solid var(--border-default)',
            background: key === message.suggestedMode ? 'var(--accent-warning-muted)' : 'var(--surface-secondary)',
            color: 'var(--text-primary)', fontSize: '0.78rem', fontWeight: '500',
            display: 'flex', alignItems: 'center', gap: '6px',
          }}>
            <m.icon size={14} style={{ color: m.color }} />
            {m.label}
          </button>
        ))}
        {onReRun && (
          <button onClick={() => onReRun(message.suggestedMode || 'plan')} style={{
            padding: '6px 14px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
            border: '1px solid var(--accent-primary)', background: 'var(--accent-primary)',
            color: '#fff', fontSize: '0.78rem', fontWeight: '600',
            display: 'flex', alignItems: 'center', gap: '6px',
          }}>
            <Play size={12} fill="currentColor" /> Switch & Re-run
          </button>
        )}
      </div>
    </div>
  );
}

// ── Empty State ─────────────────────────────────────────────────

export function ChatEmptyState() {
  return (
    <div style={{ margin: '80px auto', textAlign: 'center', color: 'var(--text-secondary)', maxWidth: '400px' }}>
      <h3 style={{ color: 'var(--text-primary)', marginBottom: '8px', fontWeight: '600', fontSize: '1.1rem' }}>
        AegisAgent Active
      </h3>
      <p style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>
        Speak or type to delegate OS operations, write code, run audits, or browse web applications.
      </p>
    </div>
  );
}
