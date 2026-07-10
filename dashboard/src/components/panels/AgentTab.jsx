'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Bot, Loader2, CheckCircle2, AlertTriangle, XCircle, Cpu, Clock, FileText, Activity } from 'lucide-react';

/**
 * AgentTab — Sub-agent deep tracking cards with expandable detail.
 */
export default function AgentTab({ metrics, status, approvalsHistory, subAgents = [] }) {
  const [expandedAgent, setExpandedAgent] = useState(null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', padding: 'var(--space-4)', overflowY: 'auto', height: '100%' }}>
      {/* Session Metrics Summary */}
      <div>
        <div className="text-h4" style={{ marginBottom: 'var(--space-2)' }}>Session</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <MetricBadge icon={<Cpu size={12} />} label="Tokens" value={metrics.tokens?.toLocaleString() || '0'} />
          <MetricBadge icon={<Activity size={12} />} label="Tools" value={`${metrics.toolCalls || 0} calls`} />
          <MetricBadge icon={<Clock size={12} />} label="Latency" value={`${metrics.latency || 0}s`} />
          <MetricBadge icon={<FileText size={12} />} label="Cost" value={`$${metrics.cost || '0'}`} color="var(--accent-success)" />
        </div>
      </div>

      {/* Sub-agents */}
      {subAgents.length > 0 && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div className="text-h4" style={{ marginBottom: 'var(--space-2)' }}>
            Sub-Agents ({subAgents.length})
          </div>
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {subAgents.map((sa) => (
              <SubAgentCard
                key={sa.id}
                subagent={sa}
                isExpanded={expandedAgent === sa.id}
                onToggle={() => setExpandedAgent(expandedAgent === sa.id ? null : sa.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Pending Approvals */}
      {approvalsHistory?.length > 0 && (
        <div>
          <div className="text-h4" style={{ marginBottom: 'var(--space-2)' }}>Approvals</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '150px', overflowY: 'auto' }}>
            {approvalsHistory.slice(0, 10).map((app, i) => (
              <div key={i} style={{
                fontSize: '0.7rem', padding: '4px 8px', borderRadius: '4px',
                background: app.status === 'pending' ? 'var(--accent-warning-muted)' : app.status === 'approved' ? 'var(--accent-success-muted)' : 'var(--accent-danger-muted)',
                border: `1px solid ${app.status === 'pending' ? 'var(--accent-warning)' : app.status === 'approved' ? 'var(--accent-success)' : 'var(--accent-danger)'}`,
                color: 'var(--text-primary)',
              }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {app.command}
                </div>
                <div style={{ marginTop: '2px', color: 'var(--text-tertiary)' }}>
                  {app.status} • {app.time}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Metric Badge ──────────────────────────────────────────────

function MetricBadge({ icon, label, value, color }) {
  return (
    <div style={{
      background: 'var(--surface-secondary)', border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-sm)', padding: '8px 10px',
    }}>
      <div style={{ fontSize: '0.62rem', color: 'var(--text-tertiary)', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
        {icon} {label}
      </div>
      <div style={{ fontSize: '0.9rem', fontWeight: '700', color: color || 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}

// ── Sub-Agent Card ────────────────────────────────────────────

function SubAgentCard({ subagent, isExpanded, onToggle }) {
  const status = subagent.status || 'idle';
  const statusConfig = {
    spawning: { color: 'var(--text-tertiary)', bg: 'rgba(113,113,122,0.15)', label: 'SPAWNING', icon: Loader2 },
    reasoning: { color: 'var(--accent-info)', bg: 'rgba(84,160,255,0.15)', label: 'THINKING', icon: Loader2 },
    working: { color: 'var(--accent-warning)', bg: 'rgba(255,170,0,0.15)', label: 'WORKING', icon: Loader2 },
    blocked: { color: 'var(--accent-danger)', bg: 'rgba(255,59,92,0.15)', label: 'BLOCKED', icon: AlertTriangle },
    completed: { color: 'var(--accent-success)', bg: 'rgba(0,214,143,0.15)', label: 'DONE', icon: CheckCircle2 },
    failed: { color: 'var(--accent-danger)', bg: 'rgba(255,59,92,0.15)', label: 'FAILED', icon: XCircle },
  };
  const cfg = statusConfig[status] || statusConfig.spawning;
  const isActive = ['spawning', 'reasoning', 'working'].includes(status);
  const isPulsing = isActive;
  const Icon = cfg.icon;

  return (
    <div style={{
      border: `1px solid ${isActive ? cfg.color + '44' : 'var(--border-subtle)'}`,
      borderRadius: 'var(--radius-sm)', background: isActive ? cfg.bg : 'var(--surface-secondary)',
      overflow: 'hidden', transition: 'all 0.15s ease',
    }}>
      {/* Header */}
      <div onClick={onToggle} style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 10px', cursor: 'pointer', userSelect: 'none', gap: '8px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, overflow: 'hidden' }}>
          <span style={{
            width: '6px', height: '6px', borderRadius: '50%', background: cfg.color,
            boxShadow: isActive ? `0 0 6px ${cfg.color}` : 'none', flexShrink: 0,
          }} />
          {isPulsing ? (
            <Loader2 size={12} className="animate-spin" style={{ color: cfg.color, flexShrink: 0 }} />
          ) : (
            <Icon size={12} style={{ color: cfg.color, flexShrink: 0 }} />
          )}
          <div style={{ overflow: 'hidden' }}>
            <div style={{ fontSize: '0.73rem', fontWeight: '500', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {subagent.name || 'Subagent'}
            </div>
            {subagent.currentAction && (
              <div style={{ fontSize: '0.62rem', color: cfg.color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {subagent.currentAction}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          {(subagent.toolCalls > 0) && (
            <span style={{ fontSize: '0.6rem', color: 'var(--text-tertiary)' }}>{subagent.toolCalls}t</span>
          )}
          <span style={{
            fontSize: '0.58rem', padding: '1px 6px', borderRadius: '10px', fontWeight: '600',
            background: cfg.bg, color: cfg.color,
          }}>{cfg.label}</span>
          {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </div>
      </div>

      {/* Expanded detail */}
      {isExpanded && (
        <div style={{ padding: '8px 10px', borderTop: '1px solid var(--border-subtle)', background: 'rgba(0,0,0,0.1)', fontSize: '0.7rem', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {/* Mode */}
          {subagent.inheritedMode && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-tertiary)' }}>Permissions</span>
              <span style={{ fontWeight: '600', color: 'var(--accent-primary)' }}>{subagent.inheritedMode.toUpperCase()}</span>
            </div>
          )}
          {/* Tokens */}
          {subagent.tokens > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-tertiary)' }}>Tokens</span>
              <span style={{ color: 'var(--accent-purple)' }}>{(subagent.tokens || 0).toLocaleString()} tkn</span>
            </div>
          )}
          {/* Time */}
          {subagent.time && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-tertiary)' }}>Started</span>
              <span style={{ color: 'var(--text-primary)' }}>{subagent.time}</span>
            </div>
          )}
          {/* Reasoning */}
          {subagent.reasoning && (
            <div style={{
              padding: '6px', background: 'rgba(84,160,255,0.05)', borderRadius: '4px',
              border: '1px solid rgba(84,160,255,0.1)',
            }}>
              <div style={{ color: 'var(--text-tertiary)', marginBottom: '3px', fontSize: '0.62rem' }}>Reasoning</div>
              <div style={{ color: 'var(--text-primary)', whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)', fontSize: '0.68rem', lineHeight: 1.4 }}>
                {subagent.reasoning.length > 300 ? subagent.reasoning.substring(0, 300) + '...' : subagent.reasoning}
              </div>
            </div>
          )}
          {/* Recent tool calls */}
          {(subagent.recentToolCalls || []).length > 0 && (
            <div>
              <div style={{ color: 'var(--text-tertiary)', marginBottom: '3px', fontSize: '0.62rem' }}>
                Tool Calls ({subagent.toolCalls})
              </div>
              {(subagent.recentToolCalls || []).slice(0, 5).map((tc, i) => (
                <div key={i} style={{
                  display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem',
                  padding: '2px 0', color: 'var(--text-primary)',
                }}>
                  <span>{tc.name}</span>
                  <span style={{ color: tc.status === 'done' ? 'var(--accent-success)' : 'var(--accent-warning)', fontSize: '0.62rem' }}>
                    {tc.status}{tc.latencyMs ? ` (${tc.latencyMs}ms)` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
