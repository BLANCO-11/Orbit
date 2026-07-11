'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Check, ChevronDown, Gauge } from 'lucide-react';

const EFFORTS = [
  { id: 'fast', label: 'Fast', desc: 'chat, QA, quick research' },
  { id: 'balanced', label: 'Balanced', desc: 'the default' },
  { id: 'deep', label: 'Deep', desc: 'dense planner, reasoning model' },
];

interface EffortSelectorProps {
  effort: string;
  onSetEffort: (id: string) => void;
}

/**
 * EffortSelector — how hard the agent thinks (model routing + planning depth),
 * orthogonal to the permission mode. Sent per session on start_task.
 */
export default function EffortSelector({ effort, onSetEffort }: EffortSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const active = EFFORTS.find((e) => e.id === (effort || 'balanced')) || EFFORTS[1];

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((prev) => !prev)}
        title="Effort — model + reasoning budget"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-[5px] text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted"
      >
        <Gauge size={12} className="text-faint" />
        {active.label.toUpperCase()}
        <ChevronDown size={12} className="text-faint" />
      </button>

      {open && (
        <div role="menu" className="absolute bottom-[calc(100%+8px)] left-0 z-40 w-60 overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-float">
          <div className="px-2.5 pb-1 pt-1.5 text-[9.5px] font-bold uppercase tracking-[0.07em] text-faint">
            Effort profile
          </div>
          {EFFORTS.map((e) => {
            const isActive = (effort || 'balanced') === e.id;
            return (
              <button
                key={e.id}
                role="menuitemradio"
                aria-checked={isActive}
                onClick={() => { onSetEffort(e.id); setOpen(false); }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                  isActive ? 'bg-accent' : 'hover:bg-muted'
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold">{e.label}</span>
                  <span className="block text-[11px] text-faint">{e.desc}</span>
                </span>
                {isActive && <Check size={14} className="shrink-0 text-primary" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
