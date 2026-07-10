'use client';

import React, { useEffect, useState } from 'react';

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
interface Budgets {
  maxCostPerSession: number;
  maxTokensPerSession: number;
  maxSubagentDepth: number;
}

function BudgetsSection() {
  const [config, setConfig] = useState<any>(null);
  const [budgets, setBudgets] = useState<Budgets>({ maxCostPerSession: 0, maxTokensPerSession: 0, maxSubagentDepth: 2 });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((c) => {
        setConfig(c);
        if (c.budgets) setBudgets({ maxSubagentDepth: 2, maxCostPerSession: 0, maxTokensPerSession: 0, ...c.budgets });
      })
      .catch(() => {});
  }, []);

  const save = () => {
    if (!config) return;
    setSaving(true);
    setSaved(false);
    fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...config, budgets }),
    })
      .then((r) => r.json())
      .then(() => { setSaved(true); setTimeout(() => setSaved(false), 2500); })
      .finally(() => setSaving(false));
  };

  const field = (label: string, key: keyof Budgets, hint: string, step = 1) => (
    <div className="rounded-xl border border-border-soft bg-card px-4 py-3">
      <label className="block text-[11px] font-medium text-muted-foreground">{label}</label>
      <div className="mt-1.5 flex items-center gap-2">
        <input
          type="number"
          min={0}
          step={step}
          value={budgets[key]}
          onChange={(e) => setBudgets((b) => ({ ...b, [key]: Number(e.target.value) }))}
          className="w-28 rounded-lg border border-border bg-background px-2.5 py-1.5 font-mono text-[13px] tabular-nums outline-none focus:border-ring"
        />
        <span className="text-[11px] text-faint">{budgets[key] === 0 && key !== 'maxSubagentDepth' ? 'unlimited' : hint}</span>
      </div>
    </div>
  );

  return (
    <div className="mt-6">
      <div className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.08em] text-faint">
        Budgets &amp; limits — enforced, not advisory
      </div>
      <div className="grid gap-2.5 sm:grid-cols-3">
        {field('Max cost per session ($)', 'maxCostPerSession', 'halts the turn at this cost', 0.01)}
        {field('Max tokens per session', 'maxTokensPerSession', 'halts the turn at this many tokens', 1000)}
        {field('Max sub-agent depth', 'maxSubagentDepth', 'deeper spawns are blocked')}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving || !config}
          className="rounded-[9px] bg-primary px-4 py-1.5 text-[13px] font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save budgets'}
        </button>
        {saved && <span className="text-xs text-success">Saved — applies on the next action.</span>}
        <span className="text-xs text-faint">0 = unlimited (cost &amp; tokens).</span>
      </div>
    </div>
  );
}

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
          approval (allow once / allow for session / deny). Editable per-cell policy and per-device
          overrides are still ahead; budgets below are live and enforced.
        </p>

        <BudgetsSection />
      </div>
    </div>
  );
}
