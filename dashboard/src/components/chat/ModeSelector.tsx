// @ts-nocheck
'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

const MODES = [
  { id: 'plan', label: 'Plan', desc: 'All actions require approval', color: 'text-chart-3' },
  { id: 'edit', label: 'Edit', desc: 'Reads free, writes need approval', color: 'text-warning' },
  { id: 'yolo', label: 'YOLO', desc: 'Full autonomous execution', color: 'text-destructive' },
];

/**
 * ModeSelector — Dropdown button for Plan / Edit / YOLO modes.
 */
export default function ModeSelector({ sessionMode, onSetSessionMode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const activeMeta = MODES.find((m) => m.id === sessionMode);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((prev) => !prev)}
        title="Switch agent mode"
        className="flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-transparent px-2.5 text-[0.72rem] font-semibold hover:bg-muted"
      >
        <span className={activeMeta ? activeMeta.color : 'text-muted-foreground'}>
          {sessionMode ? sessionMode.toUpperCase() : 'CHAT'}
        </span>
        <ChevronDown size={12} className="opacity-50" />
      </button>

      {open && (
        <div className="absolute bottom-[38px] left-0 z-40 min-w-[200px] animate-in zoom-in-95 overflow-hidden rounded-md border border-border bg-popover p-1 shadow-lg">
          {MODES.map((m) => {
            const isActive = (sessionMode || '') === m.id;
            return (
              <button
                key={m.id}
                onClick={() => { onSetSessionMode(isActive ? '' : m.id); setOpen(false); }}
                className={`flex w-full items-center justify-between gap-2 rounded px-3 py-2 text-left text-[0.78rem] ${
                  isActive ? `bg-accent ${m.color}` : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold">{m.label}</span>
                  <span className="text-[0.65rem] text-muted-foreground">{m.desc}</span>
                </div>
                {isActive && <ChevronRight size={14} className="shrink-0 opacity-50" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
