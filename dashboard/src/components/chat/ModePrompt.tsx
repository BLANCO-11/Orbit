// @ts-nocheck
'use client';

import React from 'react';
import { GitBranch } from 'lucide-react';
import { getMode } from '@/lib/modes';

// NOTE: the full-screen `ModePrompt` mode-picker card was removed in Workstream
// D2 — `showModePrompt` was initialized false and never set true, so the "Choose
// agent mode" card was unreachable dead code. Mode is chosen via ModeSelector in
// the composer. Only the compact ModeBadge remains.

/**
 * ModeBadge — compact pill above the conversation showing the active mode.
 */
export function ModeBadge({ sessionMode }) {
  const m = getMode(sessionMode);
  if (!m) return null;

  return (
    <div className={`mx-auto flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-xs shadow-card ${m.color}`}>
      <GitBranch size={12} className="shrink-0" />
      <span className="font-bold tracking-wide">{sessionMode.toUpperCase()}</span>
      <span className="text-faint">·</span>
      <span className="text-muted-foreground">{m.tagline}</span>
    </div>
  );
}
