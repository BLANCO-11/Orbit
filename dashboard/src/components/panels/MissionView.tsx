'use client';

import React, { useMemo, useState } from 'react';
import { GitBranch, ListTree, Circle, CheckCircle2, Loader2, Ban, Network, List } from 'lucide-react';

const LANE = ['var(--lane-1)', 'var(--lane-2)', 'var(--lane-3)'];

type StepStatus = 'pending' | 'active' | 'done' | 'blocked';
interface PlanStep { id: string; text: string; status: StepStatus; deps?: string[]; ready?: boolean }
interface Plan { planId: string; title: string; type?: string; steps: PlanStep[] }

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

// ── Status → colors (CSS vars so it tracks the theme) ───────────────
const STATUS_COLOR: Record<StepStatus, { stroke: string; fill: string; text: string }> = {
  done:    { stroke: 'var(--success)',     fill: 'color-mix(in oklab, var(--success) 12%, var(--card))',     text: 'var(--success)' },
  active:  { stroke: 'var(--warning)',     fill: 'color-mix(in oklab, var(--warning) 14%, var(--card))',     text: 'var(--warning)' },
  blocked: { stroke: 'var(--destructive)', fill: 'color-mix(in oklab, var(--destructive) 12%, var(--card))', text: 'var(--destructive)' },
  pending: { stroke: 'var(--border)',      fill: 'var(--card)',                                              text: 'var(--muted-foreground)' },
};

/**
 * PlanGraph — a beautiful, dependency-light DAG of the plan. Nodes are steps,
 * edges are `deps`. Layout is a custom topological layering: each node's column
 * is the longest dependency path to it, nodes stack within a column, and columns
 * are vertically centered. Colors track status; the active node pulses. No
 * external graph lib (keeps us clear of the "not the Next.js you know" friction).
 */
function PlanGraph({ steps }: { steps: PlanStep[] }) {
  const layout = useMemo(() => {
    const NODE_W = 168, NODE_H = 54, COL_GAP = 64, ROW_GAP = 20, PAD = 20;
    const byId = new Map(steps.map((s) => [s.id, s]));
    // Longest-path level of each node (memoized DFS over deps).
    const levelCache = new Map<string, number>();
    const levelOf = (id: string, seen = new Set<string>()): number => {
      if (levelCache.has(id)) return levelCache.get(id)!;
      if (seen.has(id)) return 0; // defensive (backend already breaks cycles)
      seen.add(id);
      const s = byId.get(id);
      const deps = (s?.deps || []).filter((d) => byId.has(d));
      const lvl = deps.length ? Math.max(...deps.map((d) => levelOf(d, seen))) + 1 : 0;
      levelCache.set(id, lvl);
      return lvl;
    };
    const cols = new Map<number, PlanStep[]>();
    for (const s of steps) {
      const lvl = levelOf(s.id);
      if (!cols.has(lvl)) cols.set(lvl, []);
      cols.get(lvl)!.push(s);
    }
    const maxRows = Math.max(1, ...[...cols.values()].map((c) => c.length));
    const numCols = cols.size;
    const totalH = maxRows * NODE_H + (maxRows - 1) * ROW_GAP;
    const pos = new Map<string, { x: number; y: number }>();
    for (const [lvl, nodes] of cols) {
      const colH = nodes.length * NODE_H + (nodes.length - 1) * ROW_GAP;
      const yStart = PAD + (totalH - colH) / 2;
      nodes.forEach((n, i) => {
        pos.set(n.id, { x: PAD + lvl * (NODE_W + COL_GAP), y: yStart + i * (NODE_H + ROW_GAP) });
      });
    }
    const edges: { from: string; to: string }[] = [];
    for (const s of steps) for (const d of s.deps || []) if (byId.has(d)) edges.push({ from: d, to: s.id });
    return {
      NODE_W, NODE_H, pos, edges,
      width: PAD * 2 + numCols * NODE_W + (numCols - 1) * COL_GAP,
      height: PAD * 2 + totalH,
    };
  }, [steps]);

  const { NODE_W, NODE_H, pos, edges, width, height } = layout;

  return (
    <div className="overflow-auto rounded-xl border border-border-soft bg-card p-2">
      <svg width={width} height={height} className="max-w-none" role="img" aria-label="Plan dependency graph">
        <defs>
          <marker id="plan-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--faint)" />
          </marker>
        </defs>
        {/* Edges (drawn first, under nodes) */}
        {edges.map(({ from, to }, i) => {
          const a = pos.get(from), b = pos.get(to);
          if (!a || !b) return null;
          const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2;
          const x2 = b.x, y2 = b.y + NODE_H / 2;
          const mx = (x1 + x2) / 2;
          return (
            <path
              key={i}
              d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
              fill="none" stroke="var(--border)" strokeWidth={1.5}
              markerEnd="url(#plan-arrow)"
              style={{ transition: 'stroke 0.3s ease' }}
            />
          );
        })}
        {/* Nodes */}
        {steps.map((s) => {
          const p = pos.get(s.id);
          if (!p) return null;
          const c = STATUS_COLOR[s.status] || STATUS_COLOR.pending;
          const waiting = s.status === 'pending' && s.ready === false;
          return (
            <g key={s.id} style={{ transition: 'transform 0.3s ease' }} transform={`translate(${p.x} ${p.y})`}>
              <rect
                width={NODE_W} height={NODE_H} rx={11}
                fill={c.fill} stroke={c.stroke}
                strokeWidth={s.status === 'active' ? 2 : 1.4}
                strokeDasharray={waiting ? '4 3' : undefined}
                style={{ transition: 'fill 0.3s ease, stroke 0.3s ease' }}
              >
                {s.status === 'active' && (
                  <animate attributeName="opacity" values="1;0.72;1" dur="1.6s" repeatCount="indefinite" />
                )}
              </rect>
              <text x={11} y={19} fontSize={10.5} fontWeight={700} fill={c.text}
                style={{ fontFamily: 'var(--font-mono, monospace)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {s.id} · {s.status}{waiting ? ' · waiting' : ''}
              </text>
              <text x={11} y={37} fontSize={12} fill="var(--foreground)">
                {s.text.length > 24 ? s.text.slice(0, 23) + '…' : s.text}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/**
 * MissionView — the session's PLAN(s), as a structured checklist the agent
 * drives via the orbit-plan tool, plus a dependency GRAPH view, overlaid with
 * the live sub-agent tree. A session may hold several named plans (a selector
 * appears when it does). This is deliberately NOT the agent's free-form
 * reasoning — that lives in the Trace/chat accordions.
 */
export default function MissionView({ planSteps = [], plans = [], activePlanId = '', subAgents = [], status, onSwitchSession }: {
  planSteps?: PlanStep[];
  plans?: Plan[];
  activePlanId?: string;
  subAgents?: any[];
  status?: string;
  onSwitchSession?: (sessionId: string) => void;
}) {
  const planList: Plan[] = Array.isArray(plans) && plans.length
    ? plans
    : (Array.isArray(planSteps) && planSteps.length ? [{ planId: 'default', title: 'Plan', steps: planSteps }] : []);

  const [selectedId, setSelectedId] = useState<string>('');
  const [view, setView] = useState<'checklist' | 'graph'>('checklist');

  const selected = planList.find((p) => p.planId === (selectedId || activePlanId)) || planList[0] || null;
  const steps = selected ? selected.steps || [] : [];
  const hasPlan = steps.length > 0;
  const running = status === 'thinking' || status === 'executing';
  const done = steps.filter((s) => s.status === 'done').length;
  const hasDeps = steps.some((s) => (s.deps || []).length > 0);

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
      <div className="mx-auto max-w-[900px] px-6 py-6">
        {hasPlan && (
          <div className="mb-5 overflow-hidden rounded-xl border border-border-soft bg-card">
            <div className="flex flex-wrap items-center gap-2 border-b border-border-soft px-4 py-3">
              <ListTree size={15} className="text-muted-foreground" />
              <span className="text-[13.5px] font-semibold">{selected?.title || 'Plan'}</span>
              {selected?.type && (
                <span className="rounded-full bg-muted px-1.5 py-px font-mono text-[10px] uppercase tracking-wide text-faint">{selected.type}</span>
              )}
              {running && <span className="text-[11px] text-warning">updating live…</span>}

              {/* Plan selector (only when a session has multiple plans) */}
              {planList.length > 1 && (
                <select
                  value={selected?.planId || ''}
                  onChange={(e) => setSelectedId(e.target.value)}
                  className="ml-1 rounded-md border border-border bg-background px-2 py-0.5 text-[11.5px] text-foreground outline-none"
                >
                  {planList.map((p) => (
                    <option key={p.planId} value={p.planId}>{p.title || p.planId}</option>
                  ))}
                </select>
              )}

              <div className="ml-auto flex items-center gap-2">
                {/* Checklist | Graph toggle */}
                <div className="flex overflow-hidden rounded-md border border-border">
                  <button
                    onClick={() => setView('checklist')}
                    className={`flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium ${view === 'checklist' ? 'bg-muted text-foreground' : 'text-faint hover:text-foreground'}`}
                  >
                    <List size={12} /> List
                  </button>
                  <button
                    onClick={() => setView('graph')}
                    disabled={!hasDeps}
                    title={hasDeps ? 'Dependency graph' : 'No dependencies to graph'}
                    className={`flex items-center gap-1 border-l border-border px-2 py-0.5 text-[11px] font-medium disabled:opacity-40 ${view === 'graph' ? 'bg-muted text-foreground' : 'text-faint hover:text-foreground'}`}
                  >
                    <Network size={12} /> Graph
                  </button>
                </div>
                <span className={`shrink-0 font-mono text-[11px] ${
                  done === steps.length ? 'text-success' : steps.some((s) => s.status === 'active') ? 'text-warning' : 'text-faint'
                }`}>
                  {done}/{steps.length} done
                </span>
              </div>
            </div>

            {view === 'graph' && hasDeps ? (
              <div className="p-3">
                <PlanGraph steps={steps} />
              </div>
            ) : (
              <ol className="flex flex-col">
                {steps.map((s, i) => {
                  const waiting = s.status === 'pending' && s.ready === false;
                  return (
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
                          <span className={`ml-1.5 font-mono text-[10px] ${waiting ? 'text-warning' : 'text-faint'}`}>
                            {waiting ? 'waiting on' : 'after'} {s.deps.join(', ')}
                          </span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
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
                  onClick={() => a.childSessionId && onSwitchSession?.(a.childSessionId)}
                  className={`flex items-center gap-3 rounded-xl border border-border-soft bg-card px-4 py-2.5 transition-all duration-150 ${
                    a.childSessionId ? 'cursor-pointer hover:border-primary/30 hover:bg-accent/5 hover:shadow-sm' : ''
                  }`}
                  style={{ borderLeft: `3px solid ${LANE[i % LANE.length]}` }}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-[12.5px] font-semibold flex items-center gap-2">
                      {a.name}
                      {a.childSessionId && (
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium tracking-normal text-primary lowercase">
                          has session
                        </span>
                      )}
                    </span>
                    {a.task && <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-faint">{a.task}</span>}
                  </span>
                  <span className="shrink-0 font-mono text-[10.5px] text-faint">
                    {(a.tokens || 0).toLocaleString()} tok · {a.toolCalls || 0} tools
                  </span>
                  <div className="flex items-center gap-2">
                    <AgentBadge status={a.status} />
                    {a.childSessionId && onSwitchSession && (
                      <span className="text-[11px] text-primary font-medium hover:underline shrink-0 pl-1">
                        View ⇢
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
