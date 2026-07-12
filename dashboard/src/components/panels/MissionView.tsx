'use client';

import React, { useMemo } from 'react';
import { GitBranch, ListTree, Circle, CheckCircle2, Loader2 } from 'lucide-react';

const LANE = ['var(--lane-1)', 'var(--lane-2)', 'var(--lane-3)'];

type TaskStatus = 'pending' | 'active' | 'done';

interface Task {
  text: string;
  status: TaskStatus;
}

interface Phase {
  title: string;
  tasks: Task[];
}

// Map pi's bracketed state tag (e.g. "[DONE]", "[IN PROGRESS]", "[TODO]") to a
// checklist status. Returns null for tags we don't recognise so plain prose or
// unknown tags fall back to "pending" (honest: unknown ≠ done).
function classifyTag(tag: string): TaskStatus | null {
  const t = tag.toLowerCase().trim();
  // Markdown checkboxes: "[x]" = done, "[ ]" = unchecked (falls through to pending).
  if (/\b(done|complete|completed|finished|success|resolved|closed)\b|^[✓✔x]$/.test(t)) return 'done';
  if (/\b(in ?progress|progress|active|current|running|doing|wip|working|now|ongoing)\b/.test(t)) return 'active';
  if (/\b(todo|to ?do|pending|queued|planned|next|blocked|waiting|open)\b/.test(t)) return 'pending';
  return null;
}

/**
 * Parse a free-form execution plan into phases + tasks. The hybrid planner and
 * pi's reasoning emit markdown-ish plans: markdown headings and "Phase N" /
 * "Step N" lines start a phase; bullet/numbered lines are tasks. pi prefixes
 * task lines with a state tag like "[TODO]" / "[IN PROGRESS]" / "[DONE]" — we
 * capture that as the task's live status so the board reads as a real checklist,
 * not a static outline. This is a best-effort projection — honest about the
 * source, not a fabricated board.
 */
function parsePlan(plan: string): Phase[] {
  if (!plan || !plan.trim()) return [];
  // Strip code fences and TUI box-drawing that pi sometimes wraps plans in.
  const lines = plan
    .replace(/```/g, '')
    .split('\n')
    .map((l) => l.replace(/[│├┤┌┐└┘║╠╣┬┴┼─═╔╗╚╝]/g, '').trim())
    .filter(Boolean);
  const phases: Phase[] = [];
  let current: Phase | null = null;

  const isHeading = (l: string) =>
    /^#{1,4}\s+/.test(l) || /^(phase|step|stage|part)\s*\d*\s*[:.\-)]/i.test(l);
  // A line that is ONLY a bracketed status/meta tag, e.g. "[STATUS: INITIALIZING]".
  const isMetaOnly = (l: string) => /^\[[^\]]*\]$/.test(l);
  const tagRe = /^\[([a-z0-9 _✓✔/\-]+)\]\s*/i;
  const stripTag = (l: string) => l.replace(tagRe, '').trim();

  for (const raw of lines) {
    if (isMetaOnly(raw)) continue;
    if (isHeading(raw)) {
      current = { title: stripTag(raw).replace(/^#{1,4}\s+/, '').replace(/[:*_`]+$/, '').trim(), tasks: [] };
      phases.push(current);
    } else {
      // Any non-heading line under a phase is a task (bullet, [TODO]-tagged, or
      // plain prose). This matches pi's real plan format, which uses STEP N:
      // headings with tag-prefixed task lines rather than markdown bullets.
      // Strip the bullet marker first, then peel the leading state tag so a
      // "- [DONE] thing" or "1. [x] thing" line yields status + clean text.
      const noBullet = raw.replace(/^([-*•]|\d+[.)])\s+/, '');
      const tagMatch = noBullet.match(tagRe);
      let status: TaskStatus = 'pending';
      if (tagMatch) status = classifyTag(tagMatch[1]) || 'pending';
      const text = (tagMatch ? noBullet.slice(tagMatch[0].length) : noBullet).trim();
      if (!text || text.length > 240) continue;
      if (!current) { current = { title: 'Plan', tasks: [] }; phases.push(current); }
      current.tasks.push({ text, status });
    }
  }
  return phases.filter((p) => p.tasks.length > 0);
}

function TaskIcon({ status }: { status: TaskStatus }) {
  if (status === 'done') return <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-success" />;
  if (status === 'active') return <Loader2 size={13} className="mt-0.5 shrink-0 animate-spin text-warning" />;
  return <Circle size={13} className="mt-0.5 shrink-0 text-faint" />;
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
 * MissionView — the session zoomed out: the agent's own plan projected as a
 * phase board, overlaid with the live sub-agent tree (owners + status +
 * metrics). Derived entirely from real session data, updates live.
 */
export default function MissionView({ executionPlan, subAgents = [], status }: {
  executionPlan?: string;
  subAgents?: any[];
  status?: string;
}) {
  const phases = useMemo(() => parsePlan(executionPlan || ''), [executionPlan]);
  const running = status === 'thinking' || status === 'executing';

  if (phases.length === 0 && subAgents.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <ListTree size={22} className="text-faint" />
        <p className="text-[13px] font-medium text-muted-foreground">No mission yet</p>
        <p className="max-w-[320px] text-xs leading-relaxed text-faint">
          Run a task in Plan or Edit mode (or Deep effort) — the agent&apos;s plan and its
          sub-agents are projected here as a phase board. Switch back to Timeline to send.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[960px] px-6 py-6">
        <p className="mb-4 text-[11.5px] text-faint">
          The same session, zoomed out — the agent&apos;s plan projected into phases, overlaid with the
          live sub-agent tree. {running && <span className="text-warning">Updating live…</span>}
        </p>

        {phases.length > 0 && (
          <div className="grid gap-3 md:grid-cols-2">
            {phases.map((phase, i) => {
              const doneCount = phase.tasks.filter((t) => t.status === 'done').length;
              const hasActive = phase.tasks.some((t) => t.status === 'active');
              return (
                <div key={i} className="overflow-hidden rounded-xl border border-border-soft bg-card">
                  <div className="flex items-center gap-2 border-b border-border-soft px-3.5 py-2.5">
                    <span className="font-mono text-[10.5px] font-bold text-faint">P{i + 1}</span>
                    <span className="text-[13px] font-semibold">{phase.title}</span>
                    <span className={`ml-auto shrink-0 font-mono text-[10.5px] ${
                      doneCount === phase.tasks.length ? 'text-success' : hasActive ? 'text-warning' : 'text-faint'
                    }`}>
                      {doneCount}/{phase.tasks.length}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1.5 px-3.5 py-2.5">
                    {phase.tasks.map((t, j) => (
                      <div key={j} className="flex items-start gap-2 text-[12.5px]">
                        <TaskIcon status={t.status} />
                        <span className={
                          t.status === 'done' ? 'text-faint line-through' :
                          t.status === 'active' ? 'font-medium text-foreground' :
                          'text-muted-foreground'
                        }>{t.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {subAgents.length > 0 && (
          <div className="mt-5">
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
