// @ts-nocheck
'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, ChevronRight, FileText, Cpu } from 'lucide-react';

const PROMPT_TYPES = [
  { id: 'standard', label: 'Standard', desc: 'Standard PA Prompt', color: 'text-chart-3', icon: FileText },
  { id: 'fable-5', label: 'Fable 5', desc: 'Claude Fable 5 Leak Prompt', color: 'text-primary', icon: Cpu },
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
        title="Switch system prompt type"
        className="flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-transparent px-2.5 text-[0.72rem] font-semibold hover:bg-muted"
      >
        <span className={active.color}>PROMPT: {active.label.toUpperCase()}</span>
        <ChevronDown size={12} className="opacity-50" />
      </button>

      {open && (
        <div className="absolute bottom-[38px] left-0 z-40 min-w-[220px] animate-in zoom-in-95 overflow-hidden rounded-md border border-border bg-popover p-1 shadow-lg">
          {PROMPT_TYPES.map((p) => {
            const isActive = (systemPromptType || 'standard') === p.id;
            const Icon = p.icon;
            return (
              <button
                key={p.id}
                onClick={() => { onSetSystemPromptType(p.id); setOpen(false); }}
                className={`flex w-full items-center justify-between gap-2 rounded px-3 py-2 text-left text-[0.78rem] ${
                  isActive ? `bg-accent ${p.color}` : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Icon size={14} className={isActive ? p.color : 'text-muted-foreground'} />
                  <div className="flex flex-col gap-0.5">
                    <span className="font-semibold">{p.label}</span>
                    <span className="text-[0.65rem] text-muted-foreground">{p.desc}</span>
                  </div>
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
