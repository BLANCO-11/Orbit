'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Check, ChevronDown, Terminal, Globe } from 'lucide-react';

interface Harness {
  id: string;
  name: string;
  transport: 'local' | 'remote';
  machine?: string;
  model?: string;
  provider?: string;
  status?: string;
}

interface HarnessSelectorProps {
  harnessId: string;
  onSetHarnessId: (id: string) => void;
}

/**
 * HarnessSelector — pick which harness runs this session: the local pi child
 * process, or any connected remote tether-adapter. Sent as harnessId on
 * start_task. Polls so remote adapters appear/disappear live.
 */
export default function HarnessSelector({ harnessId, onSetHarnessId }: HarnessSelectorProps) {
  const [open, setOpen] = useState(false);
  const [harnesses, setHarnesses] = useState<Harness[]>([{ id: 'local', name: 'pi-code', transport: 'local' }]);
  // Whether the harness list has been fetched from the server at least once. The
  // "fall back to local" guard below MUST NOT act before this is true — on mount
  // the list holds only `local`, and acting early would wrongly reset a selected
  // remote harness (and then persist `local` over it). Bug fix.
  const [loaded, setLoaded] = useState(false);
  const missesRef = useRef(0);
  const ref = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    fetch('/api/harnesses')
      .then((r) => r.json())
      .then((d) => {
        if (d.success && Array.isArray(d.harnesses) && d.harnesses.length) {
          setHarnesses(d.harnesses);
          setLoaded(true);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // If the selected remote harness genuinely disappears, fall back to local.
  // Only after the list has loaded (never on the mount-time local-only list) and
  // only after it's been absent across a couple of polls — so a momentary poll
  // blip can't clobber a valid selection (which would then persist `local`).
  useEffect(() => {
    if (!loaded || harnessId === 'local' || harnesses.some((h) => h.id === harnessId)) {
      missesRef.current = 0;
      return;
    }
    missesRef.current += 1;
    if (missesRef.current >= 2) {
      missesRef.current = 0;
      onSetHarnessId('local');
    }
  }, [harnesses, harnessId, onSetHarnessId, loaded]);

  const isSelectedMissing = Boolean(loaded && harnessId && harnessId !== 'local' && !harnesses.some((h) => h.id === harnessId));
  const active = harnesses.find((h) => h.id === (harnessId || 'local')) || (harnessId ? { id: harnessId, name: harnessId, status: 'offline' } : harnesses[0]);
  const isOffline = isSelectedMissing || (active && active.status === 'offline');

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((prev) => !prev)}
        title={isOffline ? `Harness ${harnessId} is unreachable` : "Harness — which agent runtime runs this session"}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-[5px] text-xs font-semibold transition-colors ${
          isOffline ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-border text-muted-foreground hover:bg-muted'
        }`}
      >
        <span className={`size-[6px] rounded-full ${isOffline ? 'bg-destructive animate-pulse' : 'bg-success'}`} />
        {active?.name?.toUpperCase() || 'PI-CODE'}
        {isOffline && <span className="text-[10px] font-normal uppercase text-destructive">(OFFLINE)</span>}
        <ChevronDown size={12} className="text-faint" />
      </button>

      {open && (
        <div role="menu" className="absolute bottom-[calc(100%+8px)] left-0 z-40 w-60 overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-float">
          <div className="px-2.5 pb-1 pt-1.5 text-[9.5px] font-bold uppercase tracking-[0.07em] text-faint">
            Run this session on
          </div>
          {harnesses.map((h) => {
            const isActive = (harnessId || 'local') === h.id;
            return (
              <button
                key={h.id}
                role="menuitemradio"
                aria-checked={isActive}
                onClick={() => { onSetHarnessId(h.id); setOpen(false); }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                  isActive ? 'bg-accent' : 'hover:bg-muted'
                }`}
              >
                {h.transport === 'remote' ? <Globe size={14} className="shrink-0 text-faint" /> : <Terminal size={14} className="shrink-0 text-faint" />}
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold">{h.name}</span>
                  <span className="block truncate text-[11px] text-faint">
                    {h.model
                      ? `${h.model}${h.provider ? ` · ${h.provider}` : ''}`
                      : (h.transport === 'remote' ? `${h.machine || 'remote'} · via adapter` : 'local child process')}
                  </span>
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
