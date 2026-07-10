'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Check, ChevronDown, Sparkles } from 'lucide-react';

interface Skill {
  id: string;
  description?: string;
}

interface SkillSelectorProps {
  attachedSkills: string[];
  onSetAttachedSkills: (ids: string[]) => void;
}

/**
 * SkillSelector — attach/detach reusable instruction packs (GET /api/skills)
 * per session. Attached ids ride on start_task; the harness appends the skill
 * bodies to the system prompt, so sub-agents inherit them too.
 */
export default function SkillSelector({ attachedSkills, onSetAttachedSkills }: SkillSelectorProps) {
  const [open, setOpen] = useState(false);
  const [skills, setSkills] = useState<Skill[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/skills')
      .then((r) => r.json())
      .then((data) => { if (data.success && Array.isArray(data.skills)) setSkills(data.skills); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const toggle = (id: string) => {
    onSetAttachedSkills(
      attachedSkills.includes(id) ? attachedSkills.filter((s) => s !== id) : [...attachedSkills, id]
    );
  };

  const count = attachedSkills.length;

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((prev) => !prev)}
        title="Skills — reusable instruction packs"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-[5px] text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted"
      >
        <Sparkles size={12} className="text-faint" />
        SKILLS{count > 0 ? `: ${count}` : ''}
        <ChevronDown size={12} className="text-faint" />
      </button>

      {open && (
        <div role="menu" className="absolute bottom-[calc(100%+8px)] left-0 z-40 w-64 overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-float">
          <div className="px-2.5 pb-1 pt-1.5 text-[9.5px] font-bold uppercase tracking-[0.07em] text-faint">
            Attach to this session
          </div>
          {skills.length === 0 && (
            <div className="px-2.5 py-2 text-[11px] text-faint">No skills found in skills/.</div>
          )}
          {skills.map((s) => {
            const on = attachedSkills.includes(s.id);
            return (
              <button
                key={s.id}
                role="menuitemcheckbox"
                aria-checked={on}
                onClick={() => toggle(s.id)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                  on ? 'bg-accent' : 'hover:bg-muted'
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-[12.5px] font-semibold">{s.id}</span>
                  {s.description && (
                    <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-faint">
                      {s.description}
                    </span>
                  )}
                </span>
                {on && <Check size={14} className="shrink-0 text-primary" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
