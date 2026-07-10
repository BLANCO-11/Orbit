'use client';

import React, { useState } from 'react';
import { GitBranch, ChevronRight } from 'lucide-react';

const LANE_COLORS = ['var(--lane-1)', 'var(--lane-2)', 'var(--lane-3)'];

interface TraceAgent {
  id: string;
  name: string;
  status: string;
  mode?: string;
  parentId?: string | null;
  toolCalls: number;
  tokens: number;
  reasoning?: string;
  task?: string;
  time?: string;
  timeEnd?: string;
  recentToolCalls?: { name: string; status: string; latencyMs?: number }[];
}

function StatusBadge({ status }: { status: string }) {
  const active = status === 'working' || status === 'spawning' || status === 'reasoning';
  const failed = status === 'failed';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-px text-[10px] font-semibold uppercase tracking-wide ${
        failed
          ? 'bg-destructive/10 text-destructive'
          : active
            ? 'bg-warning/10 text-warning'
            : 'bg-success/10 text-success'
      }`}
    >
      {active && <span className="size-[5px] animate-pulse rounded-full bg-warning" />}
      {failed ? 'failed' : active ? status : 'done'}
    </span>
  );
}

/**
 * TraceTab — end-to-end sub-agent observability. Every agent this session
 * spawned (running or finished), each expandable to its task, its own
 * reasoning, its tool calls, and its own token counters.
 */
export default function TraceTab({ agents = [] }: { agents?: TraceAgent[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (agents.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <GitBranch size={20} className="text-faint" />
        <p className="text-[13px] font-medium text-muted-foreground">No sub-agents yet</p>
        <p className="max-w-[240px] text-xs leading-relaxed text-faint">
          When the agent spawns sub-agents, each one&apos;s full trace — task, reasoning,
          tool calls, tokens — appears here and persists with the session.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto p-4">
      {agents.map((agent, i) => {
        const lane = LANE_COLORS[i % LANE_COLORS.length];
        const open = openId === agent.id;
        const depth = agent.parentId ? 1 : 0;
        return (
          <div
            key={agent.id}
            className="overflow-hidden rounded-[10px] border border-border-soft bg-card"
            style={{ borderLeft: `3px solid ${lane}`, marginLeft: depth * 14 }}
          >
            <button
              onClick={() => setOpenId(open ? null : agent.id)}
              aria-expanded={open}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/60"
            >
              <ChevronRight
                size={13}
                className={`shrink-0 text-faint transition-transform ${open ? 'rotate-90' : ''}`}
              />
              <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-xs font-semibold">
                {agent.name}
              </span>
              <span className="shrink-0 font-mono text-[10.5px] text-faint num">
                {(agent.tokens || 0).toLocaleString()} tok · {agent.toolCalls || 0} tools
              </span>
              <StatusBadge status={agent.status} />
            </button>

            {open && (
              <div className="border-t border-border-soft px-3 py-2.5 text-xs">
                {agent.task && (
                  <p className="mb-2 leading-relaxed text-muted-foreground">
                    <span className="font-semibold text-foreground">Task</span> — {agent.task}
                  </p>
                )}
                <p className="mb-2 font-mono text-[10.5px] text-faint">
                  {agent.parentId ? `spawned by ${agent.parentId}` : 'root agent'} ·{' '}
                  {agent.time || '—'} → {agent.timeEnd || 'running'} · mode {agent.mode || 'inherit'}
                </p>

                {(agent.recentToolCalls?.length ?? 0) > 0 && (
                  <div className="mb-2 flex flex-col gap-1 rounded-lg bg-muted/60 p-2">
                    {agent.recentToolCalls!.map((tc, j) => (
                      <div key={j} className="flex items-center gap-2 font-mono text-[11px]">
                        <span className="font-semibold text-accent-foreground">{tc.name}</span>
                        <span className="flex-1" />
                        <span className={tc.status === 'running' ? 'text-warning' : 'text-faint'}>
                          {tc.status === 'running' ? 'running…' : `${tc.latencyMs ?? 0}ms`}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {agent.reasoning && (
                  <details className="group">
                    <summary className="cursor-pointer select-none text-[11px] font-semibold text-faint hover:text-muted-foreground">
                      Reasoning
                    </summary>
                    <p className="mt-1 whitespace-pre-wrap rounded-lg bg-muted/60 p-2 text-[11px] italic leading-relaxed text-muted-foreground">
                      {agent.reasoning}
                    </p>
                  </details>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
