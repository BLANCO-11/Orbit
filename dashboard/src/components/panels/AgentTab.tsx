// @ts-nocheck
'use client';

import React, { useState } from 'react';
import {
  ChevronDown, ChevronRight, Loader2, CheckCircle2, AlertTriangle, XCircle,
  Cpu, Clock, DollarSign, Activity, Check,
} from 'lucide-react';

function SectionLabel({ children }) {
  return (
    <div className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.06em] text-faint">{children}</div>
  );
}

function MetricCard({ icon: Icon, label, value, sub, valueCls }) {
  return (
    <div className="rounded-[11px] border border-border-soft bg-card px-3 py-[11px] shadow-card">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-faint">
        <Icon size={12} />
        {label}
      </div>
      <div className={`font-mono text-[19px] font-bold tabular-nums tracking-tight ${valueCls || ''}`}>{value}</div>
      {sub && <div className="mt-1 text-[11px] text-faint">{sub}</div>}
    </div>
  );
}

/**
 * TokensPerTurnChart — grouped in/out mini-bars per prompt turn, fed by the
 * per-turn ledger (metrics.turns). Series colors are the CVD-validated pair.
 */
function TokensPerTurnChart({ turns }) {
  if (!turns || turns.length === 0) return null;
  const max = Math.max(1, ...turns.map((t) => Math.max(t.tokens?.input || 0, (t.tokens?.output || 0) + (t.tokens?.reasoning || 0))));
  return (
    <div className="rounded-[11px] border border-border-soft bg-card px-3 py-[11px] shadow-card">
      <div className="mb-2 flex items-center gap-3 text-[10.5px] text-faint">
        Tokens per turn
        <span className="ml-auto inline-flex items-center gap-1">
          <i className="inline-block size-[7px] rounded-[2px]" style={{ background: 'var(--series-in)' }} /> in
        </span>
        <span className="inline-flex items-center gap-1">
          <i className="inline-block size-[7px] rounded-[2px]" style={{ background: 'var(--series-out)' }} /> out
        </span>
      </div>
      <div className="flex h-[46px] items-end gap-[6px]" aria-hidden="true">
        {turns.map((t, i) => {
          const inH = Math.max(4, ((t.tokens?.input || 0) / max) * 100);
          const outH = Math.max(4, (((t.tokens?.output || 0) + (t.tokens?.reasoning || 0)) / max) * 100);
          return (
            <div key={i} className="flex h-full flex-1 items-end gap-[2px]" title={`${t.prompt || `turn ${i + 1}`} — in ${t.tokens?.input ?? 0} / out ${(t.tokens?.output ?? 0) + (t.tokens?.reasoning ?? 0)}${t.source ? ` · ${t.source}` : ''}`}>
              <i className="block flex-1 rounded-t-[3px]" style={{ height: `${inH}%`, background: 'var(--series-in)' }} />
              <i className="block flex-1 rounded-t-[3px]" style={{ height: `${outH}%`, background: 'var(--series-out)' }} />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[10px] tabular-nums text-faint">
        <span>last {turns.length} turn{turns.length > 1 ? 's' : ''}</span>
        <span>{turns[turns.length - 1]?.source || ''}</span>
      </div>
    </div>
  );
}

/**
 * AgentTab — session metrics, live sub-agents, per-tool latency, action feed.
 */
export default function AgentTab({ metrics, status, approvalsHistory, subAgents = [] }) {
  const [expandedAgent, setExpandedAgent] = useState(null);

  const perTool = metrics.latencyPerTool || {};
  const toolNames = Object.keys(perTool);
  const maxAvg = Math.max(1, ...toolNames.map((t) => perTool[t].avgMs || 0));
  const feed = [...(metrics.actionFeed || [])].reverse().slice(0, 8);
  const avgLatency = metrics.toolCalls > 0 ? Math.round((metrics.latency || 0) / metrics.toolCalls) : 0;

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto p-4">
      {/* ── Session metrics ── */}
      <div>
        <SectionLabel>Session</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          <MetricCard
            icon={Cpu}
            label="Tokens"
            value={(metrics.tokens || 0).toLocaleString()}
            sub={
              metrics.tokensSource === 'reported'
                ? `${(metrics.tokensIn || 0).toLocaleString()} in / ${(metrics.tokensOut || 0).toLocaleString()} out · reported`
                : 'estimated'
            }
          />
          <MetricCard
            icon={Activity}
            label="Tool calls"
            value={metrics.toolCalls || 0}
            sub={toolNames.length > 0 ? `across ${toolNames.length} tool${toolNames.length > 1 ? 's' : ''}` : null}
          />
          <MetricCard
            icon={Clock}
            label="Latency"
            value={`${((metrics.latency || 0) / 1000).toFixed(1)}s`}
            sub={avgLatency > 0 ? `avg ${avgLatency}ms / call` : null}
          />
          <MetricCard
            icon={DollarSign}
            label={metrics.costEstimated === false ? 'Cost' : 'Est. cost'}
            value={`$${(metrics.cost || 0).toFixed(metrics.cost < 0.01 ? 4 : 2)}`}
            valueCls="text-success"
            sub={metrics.costEstimated === false ? 'from reported usage' : 'estimated'}
          />
        </div>
        {(metrics.turns?.length ?? 0) > 0 && (
          <div className="mt-2">
            <TokensPerTurnChart turns={metrics.turns} />
          </div>
        )}
      </div>

      {/* ── Sub-agents ── */}
      {subAgents.length > 0 && (
        <div>
          <SectionLabel>Sub-agents · {subAgents.length} active</SectionLabel>
          <div className="flex flex-col gap-2">
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

      {/* ── Per-tool latency ── */}
      {toolNames.length > 0 && (
        <div>
          <SectionLabel>Per-tool latency</SectionLabel>
          <div className="flex flex-col gap-2">
            {toolNames
              .sort((a, b) => (perTool[b].avgMs || 0) - (perTool[a].avgMs || 0))
              .slice(0, 6)
              .map((name) => (
                <div key={name} className="flex items-center gap-2.5">
                  <span className="w-[74px] shrink-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground">
                    {name}
                  </span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-gradient-to-r from-primary/70 to-primary"
                      style={{ width: `${Math.max(6, ((perTool[name].avgMs || 0) / maxAvg) * 100)}%` }}
                    />
                  </span>
                  <span className="w-14 shrink-0 text-right font-mono text-[11px] tabular-nums text-faint">
                    {perTool[name].avgMs || 0}ms
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* ── Action feed ── */}
      <div>
        <SectionLabel>Action feed</SectionLabel>
        {feed.length === 0 ? (
          <div className="text-xs italic text-faint">Waiting for tool activity…</div>
        ) : (
          <div className="flex flex-col">
            {feed.map((item, i) => (
              <div key={i} className="flex gap-2.5 border-b border-border-soft py-2 last:border-b-0">
                <Check size={14} className="mt-px shrink-0 text-success" strokeWidth={2.4} />
                <div className="min-w-0">
                  <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[12.5px]">
                    {item.toolName}
                    {item.resultSnippet && <span className="text-faint"> · {item.resultSnippet.slice(0, 40)}</span>}
                  </div>
                  <div className="font-mono text-[11px] tabular-nums text-faint">
                    completed in {item.latencyMs ?? 0}ms
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Approvals ── */}
      {approvalsHistory?.length > 0 && (
        <div>
          <SectionLabel>Approvals</SectionLabel>
          <div className="flex max-h-[160px] flex-col gap-1.5 overflow-y-auto">
            {approvalsHistory.slice(0, 10).map((app, i) => (
              <div
                key={i}
                className={`rounded-lg border px-2.5 py-1.5 text-[11.5px] ${
                  app.status === 'pending'
                    ? 'border-warning/40 bg-warning/8'
                    : app.status === 'approved'
                      ? 'border-success/30 bg-success/8'
                      : 'border-destructive/30 bg-destructive/8'
                }`}
              >
                <div className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px]">{app.command}</div>
                <div className="mt-0.5 text-faint">{app.status} · {app.time}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-agent card ────────────────────────────────────────────

const STATUS_META = {
  spawning: { cls: 'text-faint', bg: 'bg-muted', label: 'SPAWNING', icon: Loader2, active: true },
  reasoning: { cls: 'text-info', bg: 'bg-info/12', label: 'THINKING', icon: Loader2, active: true },
  working: { cls: 'text-warning', bg: 'bg-warning/12', label: 'WORKING', icon: Loader2, active: true },
  blocked: { cls: 'text-destructive', bg: 'bg-destructive/12', label: 'BLOCKED', icon: AlertTriangle, active: false },
  completed: { cls: 'text-success', bg: 'bg-success/12', label: 'DONE', icon: CheckCircle2, active: false },
  failed: { cls: 'text-destructive', bg: 'bg-destructive/12', label: 'FAILED', icon: XCircle, active: false },
};

function SubAgentCard({ subagent, isExpanded, onToggle }) {
  const cfg = STATUS_META[subagent.status] || STATUS_META.spawning;
  const Icon = cfg.icon;

  return (
    <div className="overflow-hidden rounded-[11px] border border-border bg-card shadow-card">
      <div
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        className="flex cursor-pointer select-none items-center gap-2.5 px-3 py-2.5"
      >
        <span className={`size-[7px] shrink-0 rounded-full ${cfg.cls.replace('text-', 'bg-')} ${cfg.active ? 'shadow-[0_0_8px_currentColor]' : ''}`} />
        <div className="min-w-0 flex-1">
          <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[12.5px] font-semibold">
            {subagent.name || 'Sub-agent'}
          </div>
          {subagent.currentAction && (
            <div className={`overflow-hidden text-ellipsis whitespace-nowrap text-[11px] ${cfg.cls}`}>
              {subagent.currentAction}…
            </div>
          )}
        </div>
        <span className={`shrink-0 rounded-full px-[7px] py-[2px] text-[9.5px] font-bold tracking-wide ${cfg.bg} ${cfg.cls}`}>
          {cfg.label}
        </span>
        {isExpanded ? <ChevronDown size={12} className="shrink-0 text-faint" /> : <ChevronRight size={12} className="shrink-0 text-faint" />}
      </div>

      {isExpanded && (
        <div className="flex flex-col gap-[7px] border-t border-border-soft px-3 py-2.5 text-xs">
          {subagent.inheritedMode && (
            <div className="flex justify-between">
              <span className="text-faint">Permissions</span>
              <span className="font-semibold text-primary">{subagent.inheritedMode.toUpperCase()}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-faint">Tool calls</span>
            <span className="font-mono font-medium tabular-nums">{subagent.toolCalls || 0}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-faint">Tokens</span>
            <span className="font-mono font-medium tabular-nums">{(subagent.tokens || 0).toLocaleString()}</span>
          </div>
          {subagent.time && (
            <div className="flex justify-between">
              <span className="text-faint">Started</span>
              <span className="font-medium">{subagent.time}</span>
            </div>
          )}
          {subagent.reasoning && (
            <div className="rounded-lg border border-info/15 bg-info/6 p-2">
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-info">Reasoning</div>
              <div className="whitespace-pre-wrap font-mono text-[11px] leading-normal text-muted-foreground">
                {subagent.reasoning.length > 280 ? subagent.reasoning.slice(0, 280) + '…' : subagent.reasoning}
              </div>
            </div>
          )}
          {(subagent.recentToolCalls || []).length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-faint">Recent tools</div>
              {(subagent.recentToolCalls || []).slice(0, 5).map((tc, i) => (
                <div key={i} className="flex justify-between py-0.5 text-[11.5px]">
                  <span>{tc.name}</span>
                  <span className={`font-mono text-[11px] tabular-nums ${tc.status === 'done' ? 'text-success' : 'text-warning'}`}>
                    {tc.status}{tc.latencyMs ? ` · ${tc.latencyMs}ms` : ''}
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
