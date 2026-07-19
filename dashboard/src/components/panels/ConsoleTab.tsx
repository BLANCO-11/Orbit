'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { TerminalSquare, CornerDownLeft } from 'lucide-react';
import { useOrbitState } from '@/providers/OrbitProvider';

interface Entry { command: string; stdout: string; stderr: string; code: number; timedOut: boolean }

/**
 * ConsoleTab — an operator console into the agent runtime. Runs a command in the
 * project root (the same cwd the agent's shell uses) via /api/console/exec and
 * shows the output. Non-streaming for v1; each command returns when it finishes
 * (20s cap). This is the operator's shell, not the agent's — not policy-gated.
 */
export default function ConsoleTab({ harnessId }: { harnessId?: string }) {
  const { currentSessionId } = useOrbitState();
  const [cmd, setCmd] = useState('');
  const [history, setHistory] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [cwd, setCwd] = useState('');
  const [machine, setMachine] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const inputHist = useRef<string[]>([]);
  const histIdx = useRef(-1);

  // Console runs in the CURRENT session's workspace on the SELECTED agent's
  // runtime — the Orbit host for a local agent, the remote machine for a remote
  // one (backend routes over the connector). Re-fetch cwd on session/agent change.
  const remoteQ = harnessId && harnessId !== 'local' ? `harnessId=${encodeURIComponent(harnessId)}` : '';
  const scopeQ = [currentSessionId ? `session=${encodeURIComponent(currentSessionId)}` : '', remoteQ].filter(Boolean).join('&');
  const queryStr = scopeQ ? `?${scopeQ}` : '';
  useEffect(() => {
    fetch(`/api/console/cwd${queryStr}`).then((r) => r.json()).then((d) => { if (d.success) { setCwd(d.cwd); setMachine(d.remote ? (d.machine || 'remote') : ''); } }).catch(() => {});
  }, [queryStr]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [history, busy]);

  const run = useCallback(async () => {
    const command = cmd.trim();
    if (!command || busy) return;
    inputHist.current.push(command); histIdx.current = inputHist.current.length;
    setCmd(''); setBusy(true);
    try {
      const res = await fetch('/api/console/exec', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, session: currentSessionId || undefined, harnessId: harnessId && harnessId !== 'local' ? harnessId : undefined }),
      });
      const d = await res.json();
      if (d.remote && d.machine) setMachine(d.machine);
      setHistory((h) => [...h, {
        command,
        stdout: d.stdout || '', stderr: d.stderr || '',
        code: d.code ?? (d.success ? 0 : 1),
        timedOut: Boolean(d.timedOut),
      }]);
    } catch {
      setHistory((h) => [...h, { command, stdout: '', stderr: 'Request failed.', code: 1, timedOut: false }]);
    }
    setBusy(false);
  }, [cmd, busy, currentSessionId, harnessId]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); run(); return; }
    // Up/down through command history.
    if (e.key === 'ArrowUp') { e.preventDefault(); if (histIdx.current > 0) { histIdx.current--; setCmd(inputHist.current[histIdx.current] || ''); } }
    if (e.key === 'ArrowDown') { e.preventDefault(); if (histIdx.current < inputHist.current.length - 1) { histIdx.current++; setCmd(inputHist.current[histIdx.current] || ''); } else { histIdx.current = inputHist.current.length; setCmd(''); } }
  };

  return (
    <div className="flex h-full flex-col bg-[var(--card)]">
      <div className="flex shrink-0 items-center gap-2 border-b border-border-soft px-3 py-2 text-[11px] text-faint">
        <TerminalSquare size={13} />
        {machine && (
          <span className="shrink-0 rounded border border-primary/40 bg-primary/10 px-1.5 py-px text-[10px] font-semibold text-primary" title={`Running on remote agent: ${machine}`}>
            {machine}
          </span>
        )}
        <span className="truncate font-mono">{cwd || 'agent runtime'}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[11.5px] leading-relaxed">
        {history.length === 0 && (
          <div className="text-faint">Run a command in the agent runtime. Output appears here. ↑/↓ for history.</div>
        )}
        {history.map((e, i) => (
          <div key={i} className="mb-2">
            <div className="flex items-center gap-1.5 text-accent-foreground">
              <span className="text-faint">$</span>
              <span className="break-all">{e.command}</span>
            </div>
            {e.stdout && <pre className="whitespace-pre-wrap break-all text-muted-foreground">{e.stdout}</pre>}
            {e.stderr && <pre className="whitespace-pre-wrap break-all text-destructive">{e.stderr}</pre>}
            {(e.code !== 0 || e.timedOut) && (
              <div className="text-[10.5px] text-faint">exit {e.code}{e.timedOut ? ' · timed out (20s)' : ''}</div>
            )}
          </div>
        ))}
        {busy && <div className="animate-pulse text-faint">running…</div>}
        <div ref={endRef} />
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-border-soft p-2.5">
        <span className="pl-1 font-mono text-[12px] text-faint">$</span>
        <input
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={onKey}
          disabled={busy}
          placeholder="ls -la"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className="min-w-0 flex-1 bg-transparent font-mono text-[12px] outline-none placeholder:text-faint disabled:opacity-50"
        />
        <button onClick={run} disabled={busy || !cmd.trim()} aria-label="Run" className="grid size-7 shrink-0 place-items-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40">
          <CornerDownLeft size={13} />
        </button>
      </div>
    </div>
  );
}
