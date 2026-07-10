// @ts-nocheck
'use client';

import React from 'react';
import { Shield, Edit3, Zap, GitBranch } from 'lucide-react';

const MODE_META = {
  plan: {
    label: 'Plan',
    tagline: 'All actions require approval',
    desc: 'The agent plans its approach, explains what it will do, and asks before every action.',
    icon: Shield,
    cls: 'text-info',
  },
  edit: {
    label: 'Edit',
    tagline: 'Reads auto-approved, writes need approval',
    desc: 'Reads files freely, but asks before writing or editing anything.',
    icon: Edit3,
    cls: 'text-warning',
  },
  yolo: {
    label: 'YOLO',
    tagline: 'Full autonomous execution',
    desc: 'No approval prompts for any action. Full autonomy.',
    icon: Zap,
    cls: 'text-destructive',
  },
};

/**
 * ModePrompt — full mode picker shown when no mode is set.
 */
export function ModePrompt({ onSetMode }) {
  return (
    <div className="rounded-2xl border border-primary/25 bg-accent p-5 text-center shadow-card">
      <h3 className="mb-1 text-[16px] font-semibold tracking-tight">Choose agent mode</h3>
      <p className="mb-4 text-[13px] text-muted-foreground">
        How autonomous should the agent be? This applies for the whole session.
      </p>
      <div className="flex flex-wrap justify-center gap-2.5">
        {Object.entries(MODE_META).map(([id, m]) => (
          <button
            key={id}
            onClick={() => onSetMode(id)}
            className="min-w-[150px] flex-1 rounded-xl border border-border bg-card p-4 text-left shadow-card transition-colors hover:border-ring/40"
          >
            <m.icon size={18} className={`mb-2 ${m.cls}`} />
            <div className="mb-1 text-[14px] font-bold tracking-tight">{m.label}</div>
            <div className="text-xs leading-normal text-muted-foreground">{m.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * ModeBadge — compact pill above the conversation.
 */
export function ModeBadge({ sessionMode }) {
  const m = MODE_META[sessionMode];
  if (!m) return null;

  return (
    <div className={`mx-auto flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-xs shadow-card ${m.cls}`}>
      <GitBranch size={12} className="shrink-0" />
      <span className="font-bold tracking-wide">{sessionMode.toUpperCase()}</span>
      <span className="text-faint">·</span>
      <span className="text-muted-foreground">{m.tagline}</span>
    </div>
  );
}
