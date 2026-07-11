'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Check, ChevronDown, Bot } from 'lucide-react';

interface Profile {
  id: string;
  name: string;
  description?: string;
  mode: string;
  effort: string;
  promptId: string;
  skills: string[];
  toolPolicy: { excluded: string[] };
  harnessType?: string;
}

interface ProfileSelectorProps {
  activeProfileId: string | null;
  onApplyProfile: (p: Profile | null) => void;
}

/**
 * ProfileSelector — pick a saved agent profile; applying it sets the other
 * composer chips (mode/effort/prompt/skills/tools) to the profile's values.
 * The chips remain editable afterward as per-session overrides.
 */
export default function ProfileSelector({ activeProfileId, onApplyProfile }: ProfileSelectorProps) {
  const [open, setOpen] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    fetch('/api/profiles').then((r) => r.json()).then((d) => { if (d.success) setProfiles(d.profiles); }).catch(() => {});
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    if (open) { refresh(); document.addEventListener('mousedown', h); }
    return () => document.removeEventListener('mousedown', h);
  }, [open, refresh]);

  const active = profiles.find((p) => p.id === activeProfileId);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Agent profile — a saved session setup"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-[5px] text-xs font-semibold transition-colors ${
          active ? 'border-primary/50 bg-accent text-accent-foreground' : 'border-border text-muted-foreground hover:bg-muted'
        }`}
      >
        <Bot size={12} className={active ? 'text-accent-foreground' : 'text-faint'} />
        {active ? active.name.toUpperCase() : 'PROFILE'}
        <ChevronDown size={12} className="text-faint" />
      </button>

      {open && (
        <div role="menu" className="absolute bottom-[calc(100%+8px)] left-0 z-40 w-64 overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-float">
          <div className="px-2.5 pb-1 pt-1.5 text-[9.5px] font-bold uppercase tracking-[0.07em] text-faint">Agent profiles</div>
          <button
            onClick={() => { onApplyProfile(null); setOpen(false); }}
            className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left ${!activeProfileId ? 'bg-accent' : 'hover:bg-muted'}`}
          >
            <span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold">None</span><span className="block text-[11px] text-faint">use the chips directly</span></span>
            {!activeProfileId && <Check size={14} className="shrink-0 text-primary" />}
          </button>
          {profiles.map((p) => {
            const on = activeProfileId === p.id;
            return (
              <button key={p.id} onClick={() => { onApplyProfile(p); setOpen(false); }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left ${on ? 'bg-accent' : 'hover:bg-muted'}`}>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold">{p.name}</span>
                  <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-faint">
                    {p.description || `${p.mode} · ${p.effort} · ${p.promptId}`}
                  </span>
                </span>
                {on && <Check size={14} className="shrink-0 text-primary" />}
              </button>
            );
          })}
          {profiles.length === 0 && <div className="px-2.5 py-2 text-[11px] text-faint">No profiles — create them in the Agents tab.</div>}
        </div>
      )}
    </div>
  );
}
