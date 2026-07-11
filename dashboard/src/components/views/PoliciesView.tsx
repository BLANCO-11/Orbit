'use client';

import React, { useEffect, useState } from 'react';

type PolicyValue = 'allow' | 'ask' | 'block';

const CAPABILITIES: { key: string; label: string }[] = [
  { key: 'read_workspace', label: 'Read files in workspace' },
  { key: 'write_workspace', label: 'Write inside workspace' },
  { key: 'write_outside', label: 'Write outside workspace' },
  { key: 'shell', label: 'Run shell commands' },
  { key: 'network', label: 'Network / browser (MCP)' },
  { key: 'spawn_subagent', label: 'Spawn sub-agents' },
];
const MODES = ['chat', 'plan', 'edit', 'yolo'] as const;
const CYCLE: PolicyValue[] = ['allow', 'ask', 'block'];

const DEFAULT_MATRIX: Record<string, Record<string, PolicyValue>> = {
  read_workspace: { chat: 'block', plan: 'allow', edit: 'allow', yolo: 'allow' },
  write_workspace: { chat: 'block', plan: 'block', edit: 'allow', yolo: 'allow' },
  write_outside: { chat: 'block', plan: 'block', edit: 'ask', yolo: 'allow' },
  shell: { chat: 'block', plan: 'block', edit: 'allow', yolo: 'allow' },
  network: { chat: 'block', plan: 'allow', edit: 'allow', yolo: 'allow' },
  spawn_subagent: { chat: 'block', plan: 'allow', edit: 'allow', yolo: 'allow' },
};

function PvButton({ v, onClick }: { v: PolicyValue; onClick: () => void }) {
  const cls =
    v === 'allow'
      ? 'bg-success/10 text-success hover:bg-success/20'
      : v === 'ask'
        ? 'bg-warning/10 text-warning hover:bg-warning/20'
        : 'bg-destructive/10 text-destructive hover:bg-destructive/20';
  return (
    <button
      onClick={onClick}
      className={`inline-flex min-w-[54px] justify-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-colors ${cls}`}
      title="Click to cycle allow → ask → block"
    >
      {v}
    </button>
  );
}

/**
 * PoliciesView — editable capability × mode matrix (the source of truth the
 * backend policy engine enforces), plus enforced budgets and per-device
 * scope/overrides. Click any cell to cycle allow → ask → block.
 */
export default function PoliciesView() {
  const [config, setConfig] = useState<any>(null);
  const [matrix, setMatrix] = useState<Record<string, Record<string, PolicyValue>>>(DEFAULT_MATRIX);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [budgets, setBudgets] = useState({ maxCostPerSession: 0, maxTokensPerSession: 0, maxSubagentDepth: 2 });
  const [budgetSaved, setBudgetSaved] = useState(false);

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((c) => {
        setConfig(c);
        if (c.policyMatrix) {
          const merged: any = {};
          for (const cap of CAPABILITIES) {
            merged[cap.key] = { ...DEFAULT_MATRIX[cap.key], ...(c.policyMatrix[cap.key] || {}) };
          }
          setMatrix(merged);
        }
        if (c.budgets) setBudgets({ maxSubagentDepth: 2, maxCostPerSession: 0, maxTokensPerSession: 0, ...c.budgets });
      })
      .catch(() => {});
  }, []);

  const cycle = (cap: string, mode: string) => {
    setMatrix((m) => {
      const cur = m[cap][mode];
      const next = CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length];
      return { ...m, [cap]: { ...m[cap], [mode]: next } };
    });
    setDirty(true);
    setSaved(false);
  };

  const saveMatrix = () => {
    if (!config) return;
    setSaving(true);
    fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...config, policyMatrix: matrix }),
    })
      .then((r) => r.json())
      .then(() => { setSaved(true); setDirty(false); setConfig((c: any) => ({ ...c, policyMatrix: matrix })); setTimeout(() => setSaved(false), 2500); })
      .finally(() => setSaving(false));
  };

  const saveBudgets = () => {
    if (!config) return;
    fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...config, budgets }),
    })
      .then((r) => r.json())
      .then(() => { setBudgetSaved(true); setConfig((c: any) => ({ ...c, budgets })); setTimeout(() => setBudgetSaved(false), 2500); });
  };

  const budgetField = (label: string, key: keyof typeof budgets, hint: string, step = 1) => (
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
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[860px] px-7 py-7">
        <h2 className="text-lg font-semibold">Policies</h2>
        <p className="mb-5 mt-0.5 text-[13px] text-muted-foreground">
          What each mode may do, before the agent ever runs — enforced by the backend policy engine.
          Click any cell to cycle allow → ask → block. Approvals surface in the conversation where the
          action happens.
        </p>

        <div className="mb-2 flex items-center justify-between">
          <div className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-faint">Capability × mode</div>
          <div className="flex items-center gap-3">
            {saved && <span className="text-xs text-success">Saved — applies on the next action.</span>}
            <button
              onClick={saveMatrix}
              disabled={!dirty || saving}
              className="rounded-[9px] bg-primary px-4 py-1.5 text-[12.5px] font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save matrix'}
            </button>
          </div>
        </div>
        <div className="overflow-x-auto rounded-xl border border-border-soft">
          <table className="w-full border-collapse bg-card text-[12.5px]">
            <thead>
              <tr className="bg-muted text-left text-[10.5px] uppercase tracking-[0.07em] text-faint">
                <th className="px-3.5 py-2.5 font-semibold">Capability</th>
                {MODES.map((m) => (
                  <th key={m} className="px-3.5 py-2.5 font-semibold capitalize">{m}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CAPABILITIES.map((cap) => (
                <tr key={cap.key} className="border-t border-border-soft">
                  <td className="px-3.5 py-2.5 font-medium">{cap.label}</td>
                  {MODES.map((m) => (
                    <td key={m} className="px-3.5 py-2">
                      <PvButton v={matrix[cap.key][m]} onClick={() => cycle(cap.key, m)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-faint">
          Paired devices can be given a <span className="font-semibold">stricter</span> matrix than this
          default (tighten-only) — set per device in Fleet. Read-only and chat+voice scopes apply on top.
        </p>

        <div className="mt-6 flex items-center justify-between">
          <div className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-faint">Budgets &amp; limits — enforced</div>
          <div className="flex items-center gap-3">
            {budgetSaved && <span className="text-xs text-success">Saved.</span>}
            <button onClick={saveBudgets} disabled={!config} className="rounded-[9px] bg-primary px-4 py-1.5 text-[12.5px] font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40">
              Save budgets
            </button>
          </div>
        </div>
        <div className="grid gap-2.5 sm:grid-cols-3">
          {budgetField('Max cost per session ($)', 'maxCostPerSession', 'halts the turn at this cost', 0.01)}
          {budgetField('Max tokens per session', 'maxTokensPerSession', 'halts the turn at this many tokens', 1000)}
          {budgetField('Max sub-agent depth', 'maxSubagentDepth', 'deeper spawns are blocked')}
        </div>
        <p className="mt-2 text-xs text-faint">0 = unlimited (cost &amp; tokens). Budget/policy changes hot-reload — no restart.</p>
      </div>
    </div>
  );
}
