'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Check, ChevronDown, FileText } from 'lucide-react';

interface LibraryPrompt {
  id: string;
  label: string;
  description?: string;
  isDefault?: boolean;
}

const FALLBACK: LibraryPrompt[] = [
  { id: 'standard', label: 'Standard', description: 'Aegis default', isDefault: true },
];

interface PromptTypeSelectorProps {
  systemPromptType: string;
  onSetSystemPromptType: (id: string) => void;
}

/**
 * PromptTypeSelector — picks from the prompt library (GET /api/prompts):
 * stored system prompts, including frontier-style ones. The agent and every
 * sub-agent it spawns inherit the pick; mode directives are appended on top.
 */
export default function PromptTypeSelector({ systemPromptType, onSetSystemPromptType }: PromptTypeSelectorProps) {
  const [open, setOpen] = useState(false);
  const [prompts, setPrompts] = useState<LibraryPrompt[]>(FALLBACK);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/prompts')
      .then((r) => r.json())
      .then((data) => {
        if (data.success && Array.isArray(data.prompts) && data.prompts.length > 0) {
          setPrompts(data.prompts);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Legacy alias so sessions saved with "fable-5" still resolve.
  const activeId = systemPromptType === 'fable-5' ? 'claude-fable-5' : systemPromptType || 'standard';
  const active = prompts.find((p) => p.id === activeId) || prompts[0];

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((prev) => !prev)}
        title="System prompt — from the prompt library"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-[5px] text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted"
      >
        PROMPT: {active.label.toUpperCase()}
        <ChevronDown size={12} className="text-faint" />
      </button>

      {open && (
        <div role="menu" className="absolute bottom-[calc(100%+8px)] left-0 z-40 w-64 overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-float">
          <div className="px-2.5 pb-1 pt-1.5 text-[9.5px] font-bold uppercase tracking-[0.07em] text-faint">
            Prompt library — agents inherit the pick
          </div>
          {prompts.map((p) => {
            const isActive = activeId === p.id;
            return (
              <button
                key={p.id}
                role="menuitem"
                onClick={() => { onSetSystemPromptType(p.id); setOpen(false); }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                  isActive ? 'bg-accent' : 'hover:bg-muted'
                }`}
              >
                <FileText size={14} className={`shrink-0 ${isActive ? 'text-primary' : 'text-faint'}`} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold">
                    {p.label}
                    {p.isDefault && <span className="ml-1.5 text-[10px] font-medium text-faint">default</span>}
                  </span>
                  {p.description && (
                    <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-faint">
                      {p.description}
                    </span>
                  )}
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
