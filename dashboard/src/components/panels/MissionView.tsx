'use client';

import React from 'react';
import { GitBranch, ListTree, Circle, CheckCircle2, Loader2, Ban } from 'lucide-react';

const LANE = ['var(--lane-1)', 'var(--lane-2)', 'var(--lane-3)'];

type StepStatus = 'pending' | 'active' | 'done' | 'blocked';
interface PlanStep { id: string; text: string; status: StepStatus; deps?: string[] }

function StepIcon({ status }: { status: StepStatus }) {
  if (status === 'done') return <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-success" />;
  if (status === 'active') return <Loader2 size={14} className="mt-0.5 shrink-0 animate-spin text-warning" />;
  if (status === 'blocked') return <Ban size={14} className="mt-0.5 shrink-0 text-destructive" />;
  return <Circle size={14} className="mt-0.5 shrink-0 text-faint" />;
}

function AgentBadge({ status }: { status: string }) {
  const active = status === 'working' || status === 'spawning' || status === 'reasoning';
  const failed = status === 'failed';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-px text-[10px] font-semibold uppercase tracking-wide ${
      failed ? 'bg-destructive/10 text-destructive' : active ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'
    }`}>
      {active && <span className="size-[5px] animate-pulse rounded-full bg-warning" />}
      {failed ? 'failed' : active ? status : 'done'}
    </span>
  );
}

/**
 * MissionView — the session's PLAN, as a structured checklist the agent drives
 * via the orbit-plan tool (plan_write / plan_update), overlaid with the live
 * sub-agent tree. This is deliberately NOT the agent's free-form reasoning —
 * reasoning lives in the Trace/chat accordions. If the agent hasn't declared a
 * plan, this is honestly empty rather than showing parsed thinking-text.
 */
export default function MissionView({ planSteps = [], subAgents = [], status }: {
  planSteps?: PlanStep[];
  subAgents?: any[];
  status?: string;
}) {
  const steps = Array.isArray(planSteps) ? planSteps : [];
  const hasPlan = steps.length > 0;
  const running = status === 'thinking' || status === 'executing';
  const done = steps.filter((s) => s.status === 'done').length;

  if (!hasPlan && subAgents.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <ListTree size={22} className="text-faint" />
        <p className="text-[13px] font-medium text-muted-foreground">No plan yet</p>
        <p className="max-w-[340px] text-xs leading-relaxed text-faint">
          This is the agent&apos;s structured plan — a checklist it builds and ticks off as it works.
          On a multi-step task (build, migrate, research) it appears here and updates live. It is not
          the agent&apos;s reasoning (that&apos;s in the Trace tab).
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[860px] px-6 py-6">
        {hasPlan && (
          <div className="mb-5 overflow-hidden rounded-xl border border-border-soft bg-card">
            <div className="flex items-center gap-2 border-b border-border-soft px-4 py-3">
              <ListTree size={15} className="text-muted-foreground" />
              <span className="text-[13.5px] font-semibold">Plan</span>
              {running && <span className="text-[11px] text-warning">updating live…</span>}
              <span className={`ml-auto shrink-0 font-mono text-[11px] ${
                done === steps.length ? 'text-success' : steps.some((s) => s.status === 'active') ? 'text-warning' : 'text-faint'
              }`}>
                {done}/{steps.length} done
              </span>
            </div>
            <ol className="flex flex-col">
              {steps.map((s, i) => (
                <li
                  key={s.id || i}
                  className={`flex items-start gap-2.5 border-b border-border-soft/60 px-4 py-2.5 text-[13px] last:border-b-0 ${
                    s.status === 'active' ? 'bg-warning/5' : ''
                  }`}
                >
                  <span className="mt-0.5 w-4 shrink-0 text-right font-mono text-[10.5px] text-faint">{i + 1}</span>
                  <StepIcon status={s.status} />
                  <span className="min-w-0 flex-1">
                    <span className={
                      s.status === 'done' ? 'text-faint line-through'
                        : s.status === 'active' ? 'font-medium text-foreground'
                        : s.status === 'blocked' ? 'text-destructive'
                        : 'text-muted-foreground'
                    }>{s.text}</span>
                    {s.deps && s.deps.length > 0 && (
                      <span className="ml-1.5 font-mono text-[10px] text-faint">after {s.deps.join(', ')}</span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {subAgents.length > 0 && (
          <div>
            <div className="mb-2 flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-[0.08em] text-faint">
              <GitBranch size={12} /> Sub-agents · {subAgents.length}
            </div>
            <div className="flex flex-col gap-2">
              {subAgents.map((a, i) => (
                <div
                  key={a.id || i}
                  className="flex items-center gap-3 rounded-xl border border-border-soft bg-card px-4 py-2.5"
                  style={{ borderLeft: `3px solid ${LANE[i % LANE.length]}` }}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-[12.5px] font-semibold">{a.name}</span>
                    {a.task && <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-faint">{a.task}</span>}
                  </span>
                  <span className="shrink-0 font-mono text-[10.5px] text-faint">
                    {(a.tokens || 0).toLocaleString()} tok · {a.toolCalls || 0} tools
                  </span>
                  <AgentBadge status={a.status} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
