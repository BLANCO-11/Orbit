'use client';

import React from 'react';

type PolicyValue = 'allow' | 'ask' | 'block' | 'n/a';

const MATRIX: { capability: string; chat: PolicyValue; plan: PolicyValue; edit: PolicyValue; yolo: PolicyValue }[] = [
  { capability: 'Read files in workspace', chat: 'block', plan: 'allow', edit: 'allow', yolo: 'allow' },
  { capability: 'Write inside workspace', chat: 'block', plan: 'block', edit: 'allow', yolo: 'allow' },
  { capability: 'Write outside workspace', chat: 'block', plan: 'block', edit: 'ask', yolo: 'allow' },
  { capability: 'Run shell commands', chat: 'block', plan: 'block', edit: 'allow', yolo: 'allow' },
  { capability: 'Browser (lightpanda MCP)', chat: 'block', plan: 'allow', edit: 'allow', yolo: 'allow' },
  { capability: 'Spawn sub-agents', chat: 'n/a', plan: 'allow', edit: 'allow', yolo: 'allow' },
];

function Pv({ v }: { v: PolicyValue }) {
  const cls =
    v === 'allow'
      ? 'bg-success/10 text-success'
      : v === 'ask'
        ? 'bg-warning/10 text-warning'
        : v === 'block'
          ? 'bg-destructive/10 text-destructive'
          : 'text-faint';
  return (
    <span className={`inline-flex rounded-full px-2.5 py-px text-[11px] font-semibold ${cls}`}>{v}</span>
  );
}

/**
 * PoliciesView — what each mode may do, before the agent ever runs. This
 * reflects the enforcement wired in the backend today (mode gates in
 * server.js + security-guard path/command validation). Editable matrix,
 * budgets, and per-device overrides land in Phase 4.
 */
export default function PoliciesView() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[860px] px-7 py-7">
        <h2 className="text-lg font-semibold">Policies</h2>
        <p className="mb-5 mt-0.5 text-[13px] text-muted-foreground">
          What each mode may do, before the agent ever runs. Approvals surface in the conversation
          where the action happens; everything else is decided here.
        </p>

        <div className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.08em] text-faint">
          Capability × mode — enforced by the backend today
        </div>
        <div className="overflow-x-auto rounded-xl border border-border-soft">
          <table className="w-full border-collapse bg-card text-[12.5px]">
            <thead>
              <tr className="bg-muted text-left text-[10.5px] uppercase tracking-[0.07em] text-faint">
                <th className="px-3.5 py-2.5 font-semibold">Capability</th>
                <th className="px-3.5 py-2.5 font-semibold">Chat</th>
                <th className="px-3.5 py-2.5 font-semibold">Plan</th>
                <th className="px-3.5 py-2.5 font-semibold">Edit</th>
                <th className="px-3.5 py-2.5 font-semibold">Yolo</th>
              </tr>
            </thead>
            <tbody>
              {MATRIX.map((row) => (
                <tr key={row.capability} className="border-t border-border-soft">
                  <td className="px-3.5 py-2.5 font-medium">{row.capability}</td>
                  <td className="px-3.5 py-2.5"><Pv v={row.chat} /></td>
                  <td className="px-3.5 py-2.5"><Pv v={row.plan} /></td>
                  <td className="px-3.5 py-2.5"><Pv v={row.edit} /></td>
                  <td className="px-3.5 py-2.5"><Pv v={row.yolo} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-xs leading-relaxed text-faint">
          Edit mode additionally gates writes outside the workspace behind an in-conversation
          approval (allow once / allow for session / deny). Editable per-cell policy, enforced
          budget caps, and per-device overrides ship in Phase 4 of{' '}
          <span className="font-mono">plan/IMPLEMENTATION-PLAN.md</span>.
        </p>
      </div>
    </div>
  );
}
