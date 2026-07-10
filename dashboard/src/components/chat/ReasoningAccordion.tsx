'use client';

import React, { useState } from 'react';
import { ChevronRight, Brain } from 'lucide-react';

interface ReasoningGroup {
  query: string;
  queryTimestamp?: string;
  entries: { content: string; timestamp?: string }[];
}

/**
 * ReasoningAccordion — per-turn reasoning, collapsed by default, rendered
 * inline in the conversation stream (mock: "Reasoning · turn N · not spoken").
 * Reasoning is never sent to TTS; this is its only surface.
 */
export default function ReasoningAccordion({ group, turnIndex }: { group: ReasoningGroup; turnIndex: number }) {
  const [open, setOpen] = useState(false);
  const latest = group.entries[group.entries.length - 1];
  if (!latest?.content?.trim()) return null;

  return (
    <div className="overflow-hidden rounded-[10px] border border-border-soft bg-card">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted/60"
      >
        <ChevronRight size={12} className={`shrink-0 text-faint transition-transform ${open ? 'rotate-90' : ''}`} />
        <Brain size={12} className="shrink-0 text-faint" />
        <span className="font-medium">Reasoning</span>
        <span className="font-mono text-[10.5px] text-faint">turn {turnIndex}</span>
        <span className="ml-auto font-mono text-[10.5px] text-faint">not spoken</span>
      </button>
      {open && (
        <div className="border-t border-border-soft px-3 py-2.5">
          <p className="whitespace-pre-wrap text-[12px] italic leading-relaxed text-muted-foreground">
            {latest.content}
          </p>
        </div>
      )}
    </div>
  );
}
