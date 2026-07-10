// @ts-nocheck
'use client';

import React from 'react';
import { Shield, Edit3, Zap, GitBranch } from 'lucide-react';

const MODE_META = {
  plan: { label: 'Plan Mode', desc: 'Agent plans the approach, explains what it will do, then asks for approval before any action.', icon: Shield, color: 'text-chart-3' },
  edit: { label: 'Edit Mode', desc: 'Agent can read files freely but asks for approval before writing or editing anything.', icon: Edit3, color: 'text-warning' },
  yolo: { label: 'YOLO Mode', desc: 'Full autonomous execution. No approval prompts for any action.', icon: Zap, color: 'text-destructive' },
};

/**
 * ModePrompt — Full mode selection screen shown when no mode is set
 */
export function ModePrompt({ onSetMode }) {
  return (
    <div className="mx-auto mb-5 max-w-2xl animate-in fade-in rounded-xl border border-primary/30 bg-accent p-5 text-center">
      <h3 className="mb-3 text-lg font-semibold">Choose Agent Mode</h3>
      <p className="mb-4 text-sm text-muted-foreground">
        Select how autonomous you want the agent to be. This applies for the entire session.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        {Object.entries(MODE_META).map(([id, m]) => (
          <button
            key={id}
            onClick={() => onSetMode(id)}
            className="min-w-[140px] flex-1 rounded-lg border border-border bg-card p-4 text-left hover:bg-muted"
          >
            <m.icon size={20} className={`mb-1.5 ${m.color}`} />
            <div className="mb-1 text-[0.95rem] font-bold">{m.label}</div>
            <div className="text-xs leading-normal text-muted-foreground">{m.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * ModeBadge — Compact mode indicator bar shown above the chat
 */
export function ModeBadge({ sessionMode }) {
  if (!sessionMode) return null;
  const m = MODE_META[sessionMode];
  if (!m) return null;

  return (
    <div className={`mx-auto mb-3 flex max-w-xl animate-in fade-in items-center justify-center gap-2 rounded-full border border-border bg-accent px-4 py-1.5 text-xs ${m.color}`}>
      <GitBranch size={12} className="shrink-0" />
      <span className="font-semibold">{sessionMode.toUpperCase()}</span>
      <span className="opacity-60">&bull;</span>
      <span className="opacity-80">{m.desc.split('.')[0]}</span>
    </div>
  );
}
