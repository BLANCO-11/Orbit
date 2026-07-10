// @ts-nocheck
'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, CheckCircle2, AlertTriangle, XCircle, Cpu, Clock, FileText, Activity } from 'lucide-react';

/**
 * AgentTab — Sub-agent deep tracking cards with expandable detail.
 */
export default function AgentTab({ metrics, status, approvalsHistory, subAgents = [] }) {
  const [expandedAgent, setExpandedAgent] = useState(null);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      {/* Session Metrics Summary */}
      <div>
        <div className="mb-2 text-sm font-semibold">Session</div>
        <div className="grid grid-cols-2 gap-2">
          <MetricBadge icon={<Cpu size={12} />} label="Tokens" value={metrics.tokens?.toLocaleString() || '0'} />
          <MetricBadge icon={<Activity size={12} />} label="Tools" value={`${metrics.toolCalls || 0} calls`} />
          <MetricBadge icon={<Clock size={12} />} label="Latency" value={`${((metrics.latency || 0) / 1000).toFixed(1)}s`} />
          <MetricBadge icon={<FileText size={12} />} label="Est. Cost" value={`$${(metrics.cost || 0).toFixed(metrics.cost < 0.01 ? 4 : 2)}`} className="text-success" />
        </div>
      </div>

      {/* Sub-agents */}
      {subAgents.length > 0 && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="mb-2 text-sm font-semibold">Sub-Agents ({subAgents.length})</div>
          <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto">
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
          <div className="mb-2 text-sm font-semibold">Approvals</div>
          <div className="flex max-h-[150px] flex-col gap-1 overflow-y-auto">
            {approvalsHistory.slice(0, 10).map((app, i) => (
              <div
                key={i}
                className={`rounded border px-2 py-1 text-[0.7rem] ${
                  app.status === 'pending'
                    ? 'border-warning bg-warning/10'
                    : app.status === 'approved'
                      ? 'border-success bg-success/10'
                      : 'border-destructive bg-destructive/10'
                }`}
              >
                <div className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[0.65rem]">{app.command}</div>
                <div className="mt-0.5 text-muted-foreground">{app.status} • {app.time}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Metric Badge ──────────────────────────────────────────────

function MetricBadge({ icon, label, value, className }) {
  return (
    <div className="rounded-md border border-border bg-muted/50 px-2.5 py-2">
      <div className="mb-0.5 flex items-center gap-1 text-[0.62rem] text-muted-foreground">
        {icon} {label}
      </div>
      <div className={`text-[0.9rem] font-bold ${className || ''}`}>{value}</div>
    </div>
  );
}

// ── Sub-Agent Card ────────────────────────────────────────────

const STATUS_META = {
  spawning: { color: 'text-muted-foreground', bg: 'bg-muted', label: 'SPAWNING', icon: Loader2 },
  reasoning: { color: 'text-chart-3', bg: 'bg-chart-3/15', label: 'THINKING', icon: Loader2 },
  working: { color: 'text-warning', bg: 'bg-warning/15', label: 'WORKING', icon: Loader2 },
  blocked: { color: 'text-destructive', bg: 'bg-destructive/15', label: 'BLOCKED', icon: AlertTriangle },
  completed: { color: 'text-success', bg: 'bg-success/15', label: 'DONE', icon: CheckCircle2 },
  failed: { color: 'text-destructive', bg: 'bg-destructive/15', label: 'FAILED', icon: XCircle },
};

function SubAgentCard({ subagent, isExpanded, onToggle }) {
  const status = subagent.status || 'idle';
  const cfg = STATUS_META[status] || STATUS_META.spawning;
  const isActive = ['spawning', 'reasoning', 'working'].includes(status);
  const Icon = cfg.icon;

  return (
    <div className={`overflow-hidden rounded-md border transition-colors ${isActive ? `${cfg.bg} border-transparent` : 'border-border bg-muted/30'}`}>
      <div
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        className="flex cursor-pointer select-none items-center justify-between gap-2 px-2.5 py-2"
      >
        <div className="flex flex-1 items-center gap-2 overflow-hidden">
          <span className={`size-1.5 shrink-0 rounded-full ${cfg.bg.replace('/15', '').replace('/10', '')} ${cfg.color.replace('text-', 'bg-')}`} />
          {isActive ? (
            <Loader2 size={12} className={`shrink-0 animate-spin ${cfg.color}`} />
          ) : (
            <Icon size={12} className={`shrink-0 ${cfg.color}`} />
          )}
          <div className="overflow-hidden">
            <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[0.73rem] font-medium">
              {subagent.name || 'Subagent'}
            </div>
            {subagent.currentAction && (
              <div className={`overflow-hidden text-ellipsis whitespace-nowrap text-[0.62rem] ${cfg.color}`}>
                {subagent.currentAction}
              </div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {subagent.toolCalls > 0 && <span className="text-[0.6rem] text-muted-foreground">{subagent.toolCalls}t</span>}
          <span className={`rounded-full px-1.5 py-px text-[0.58rem] font-semibold ${cfg.bg} ${cfg.color}`}>{cfg.label}</span>
          {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </div>
      </div>

      {isExpanded && (
        <div className="flex flex-col gap-1.5 border-t border-border bg-black/5 p-2.5 text-[0.7rem] dark:bg-white/5">
          {subagent.inheritedMode && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Permissions</span>
              <span className="font-semibold text-primary">{subagent.inheritedMode.toUpperCase()}</span>
            </div>
          )}
          {subagent.tokens > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Tokens</span>
              <span className="text-chart-4">{(subagent.tokens || 0).toLocaleString()} tkn</span>
            </div>
          )}
          {subagent.time && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Started</span>
              <span>{subagent.time}</span>
            </div>
          )}
          {subagent.reasoning && (
            <div className="rounded border border-chart-3/10 bg-chart-3/5 p-1.5">
              <div className="mb-0.5 text-[0.62rem] text-muted-foreground">Reasoning</div>
              <div className="whitespace-pre-wrap font-mono text-[0.68rem] leading-normal">
                {subagent.reasoning.length > 300 ? subagent.reasoning.substring(0, 300) + '...' : subagent.reasoning}
              </div>
            </div>
          )}
          {(subagent.recentToolCalls || []).length > 0 && (
            <div>
              <div className="mb-0.5 text-[0.62rem] text-muted-foreground">Tool Calls ({subagent.toolCalls})</div>
              {(subagent.recentToolCalls || []).slice(0, 5).map((tc, i) => (
                <div key={i} className="flex justify-between py-0.5 text-[0.68rem]">
                  <span>{tc.name}</span>
                  <span className={`text-[0.62rem] ${tc.status === 'done' ? 'text-success' : 'text-warning'}`}>
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
