// @ts-nocheck
'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Check } from 'lucide-react';

const MODES = [
  { id: 'plan', label: 'Plan', desc: 'All actions require approval', dot: 'bg-info' },
  { id: 'edit', label: 'Edit', desc: 'Reads free, writes need approval', dot: 'bg-warning' },
  { id: 'yolo', label: 'YOLO', desc: 'Full autonomous execution', dot: 'bg-destructive' },
];

/**
 * ModeSelector — chip + popover for Plan / Edit / YOLO.
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

  const active = MODES.find((m) => m.id === sessionMode);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((prev) => !prev)}
        title="Agent mode"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-[5px] text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted"
      >
        <span className={`size-1.5 rounded-full ${active ? active.dot : 'bg-faint'}`} />
        {active ? active.label.toUpperCase() : 'CHAT'}
      </button>

      {open && (
        <div className="absolute bottom-[calc(100%+8px)] left-0 z-40 w-56 overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-float">
          {MODES.map((m) => {
            const isActive = (sessionMode || '') === m.id;
            return (
              <button
                key={m.id}
                onClick={() => { onSetSessionMode(isActive ? '' : m.id); setOpen(false); }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                  isActive ? 'bg-accent' : 'hover:bg-muted'
                }`}
              >
                <span className={`size-1.5 shrink-0 rounded-full ${m.dot}`} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold">{m.label}</span>
                  <span className="block text-[11px] text-faint">{m.desc}</span>
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
