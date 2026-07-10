// @ts-nocheck
'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Check, ChevronDown, FileText, Cpu } from 'lucide-react';

const PROMPT_TYPES = [
  { id: 'standard', label: 'Standard', desc: 'Standard PA prompt', icon: FileText },
  { id: 'fable-5', label: 'Fable 5', desc: 'Claude Fable 5 leak prompt', icon: Cpu },
];

export default function PromptTypeSelector({ systemPromptType, onSetSystemPromptType }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const active = PROMPT_TYPES.find((p) => p.id === (systemPromptType || 'standard')) || PROMPT_TYPES[0];

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((prev) => !prev)}
        title="System prompt"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-[5px] text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted"
      >
        PROMPT: {active.label.toUpperCase()}
        <ChevronDown size={12} className="text-faint" />
      </button>

      {open && (
        <div className="absolute bottom-[calc(100%+8px)] left-0 z-40 w-60 overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-float">
          {PROMPT_TYPES.map((p) => {
            const isActive = (systemPromptType || 'standard') === p.id;
            const Icon = p.icon;
            return (
              <button
                key={p.id}
                onClick={() => { onSetSystemPromptType(p.id); setOpen(false); }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                  isActive ? 'bg-accent' : 'hover:bg-muted'
                }`}
              >
                <Icon size={14} className={`shrink-0 ${isActive ? 'text-primary' : 'text-faint'}`} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold">{p.label}</span>
                  <span className="block text-[11px] text-faint">{p.desc}</span>
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
