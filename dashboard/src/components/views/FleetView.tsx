'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Terminal, Globe, Laptop, Smartphone, Tablet, RefreshCw } from 'lucide-react';
import { useDevices } from '@/hooks/useDevices';
import { getDeviceToken } from '@/lib/device-auth';

function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 mt-5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-faint first:mt-0">
      {children}
    </div>
  );
}

function DeviceIcon({ label }: { label: string }) {
  const l = (label || '').toLowerCase();
  const Icon = /phone|pixel|iphone|android/.test(l) ? Smartphone : /pad|tab/.test(l) ? Tablet : Laptop;
  return <Icon size={16} />;
}

/**
 * FleetView — everything that can talk to this console: harnesses that do the
 * work, devices you drive it from, one OTP pairing flow for both.
 */
const SCOPES: { id: string; label: string; hint: string }[] = [
  { id: 'full', label: 'Full control', hint: 'run tasks in any mode' },
  { id: 'chat_voice', label: 'Chat + voice', hint: 'converse only, no tools' },
  { id: 'read_only', label: 'Read-only', hint: 'watch, cannot start tasks' },
];

export default function FleetView() {
  const { devices, pairing, startPairing, clearPairing, revokeDevice, refreshDevices } = useDevices();
  const [harnesses, setHarnesses] = useState<any[]>([]);
  const [now, setNow] = useState(Date.now());
  const [scope, setScope] = useState('full');
  const isThisDevice = Boolean(getDeviceToken());

  const refreshHarnesses = useCallback(() => {
    fetch('/api/harnesses').then((r) => r.json()).then((d) => { if (d.success) setHarnesses(d.harnesses); }).catch(() => {});
  }, []);
  useEffect(() => {
    refreshHarnesses();
    const t = setInterval(refreshHarnesses, 5000); // remote adapters connect/leave live
    return () => clearInterval(t);
  }, [refreshHarnesses]);

  // Countdown tick while a pairing code is showing
  useEffect(() => {
    if (!pairing) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [pairing]);

  const secondsLeft = pairing ? Math.max(0, Math.floor((new Date(pairing.expiresAt).getTime() - now) / 1000)) : 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[860px] px-7 py-7">
        <h2 className="text-lg font-semibold">Fleet</h2>
        <p className="mb-5 mt-0.5 text-[13px] text-muted-foreground">
          Everything that can talk to this console — devices you drive it from, and harnesses that
          do the work. Both pair the same way: one code, one minute.
        </p>

        <div className="grid gap-4 lg:grid-cols-[minmax(300px,380px)_1fr]">
          {/* ── Pairing card ── */}
          <div className="flex flex-col items-center rounded-2xl border border-border bg-card p-6 text-center shadow-card">
            <h3 className="text-sm font-semibold">Pair a device</h3>
            <p className="mb-4 mt-0.5 text-xs text-muted-foreground">
              Open <span className="font-mono">/pair</span> on the other device and enter this code.
            </p>

            {pairing && secondsLeft > 0 ? (
              <>
                <div className="rounded-xl border border-border bg-background px-6 py-3.5 font-mono text-[28px] font-bold tracking-[0.18em] text-accent-foreground">
                  {pairing.code}
                </div>
                <div className="mt-2 text-[11px] text-faint">
                  grants <span className="font-semibold text-muted-foreground">{SCOPES.find((s) => s.id === (pairing.scope || 'full'))?.label}</span>
                </div>
                <div className="mt-2 flex items-center gap-2 text-xs text-faint">
                  expires in{' '}
                  <span className="font-mono tabular-nums text-warning">
                    {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
                  </span>
                  <button onClick={() => startPairing('New device', scope)} className="text-accent-foreground hover:underline">
                    regenerate
                  </button>
                  <button onClick={clearPairing} className="text-faint hover:text-muted-foreground">
                    done
                  </button>
                </div>
                {pairing.pairingUrl && (
                  <div className="mt-3 rounded-lg border border-dashed border-border bg-muted px-3 py-1.5 font-mono text-[11.5px] text-muted-foreground">
                    {pairing.pairingUrl}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="mb-3 w-full">
                  <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-faint">Scope granted at pairing</div>
                  <div className="flex gap-1.5">
                    {SCOPES.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => setScope(s.id)}
                        title={s.hint}
                        className={`flex-1 rounded-lg border px-2 py-1.5 text-[11px] font-semibold ${
                          scope === s.id ? 'border-primary text-accent-foreground' : 'border-border text-muted-foreground hover:bg-muted'
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => startPairing('New device', scope)}
                  className="rounded-[9px] bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground hover:opacity-90"
                >
                  Generate pairing code
                </button>
              </>
            )}
          </div>

          {/* ── Harnesses + devices ── */}
          <div>
            <SectionHead>
              Harnesses · {harnesses.length}
              <button onClick={refreshHarnesses} aria-label="Refresh harnesses" className="ml-2 align-middle text-faint hover:text-muted-foreground">
                <RefreshCw size={11} />
              </button>
            </SectionHead>
            <div className="flex flex-col gap-2">
              {harnesses.map((h) => (
                <div key={h.id} className="flex items-center gap-3 rounded-xl border border-border-soft bg-card px-4 py-3">
                  <div className="grid size-9 shrink-0 place-items-center rounded-[10px] border border-border bg-muted text-muted-foreground">
                    {h.transport === 'remote' ? <Globe size={16} /> : <Terminal size={16} />}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[13px] font-semibold">
                      {h.name}
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-success">
                        <i className="size-[7px] rounded-full bg-success" /> {h.transport}
                      </span>
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-faint">
                      {h.transport === 'remote' ? `${h.machine} · via adapter` : 'child process'}
                      {typeof h.activeSessions === 'number' ? ` · ${h.activeSessions} active session${h.activeSessions === 1 ? '' : 's'}` : ''}
                    </div>
                  </div>
                </div>
              ))}
              <div className="rounded-xl border border-dashed border-border px-4 py-3 text-center text-xs text-faint">
                Connect a remote harness: run <span className="font-mono">orbit-adapter --code &lt;pairing code&gt;</span> on any machine with pi installed.
              </div>
            </div>

            <SectionHead>
              Devices · {devices.filter((d: any) => !d.revoked).length}
              <button onClick={refreshDevices} aria-label="Refresh devices" className="ml-2 align-middle text-faint hover:text-muted-foreground">
                <RefreshCw size={11} />
              </button>
            </SectionHead>
            <div className="flex flex-col gap-2">
              {devices.filter((d: any) => !d.revoked).length === 0 && (
                <div className="rounded-xl border border-dashed border-border px-4 py-4 text-center text-xs text-faint">
                  No paired devices yet{isThisDevice ? '' : ' — this browser is using the local dev connection'}.
                </div>
              )}
              {devices.filter((d: any) => !d.revoked).map((d: any) => (
                <div key={d.id} className="flex items-center gap-3 rounded-xl border border-border-soft bg-card px-4 py-3">
                  <div className="grid size-9 shrink-0 place-items-center rounded-[10px] border border-border bg-muted text-muted-foreground">
                    <DeviceIcon label={d.label} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[13px] font-semibold">
                      {d.label || 'Unnamed device'}
                      <span className="rounded-full border border-border px-2 py-px text-[10px] font-medium text-muted-foreground">
                        {SCOPES.find((s) => s.id === (d.scope || 'full'))?.label || d.scope}
                      </span>
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-faint">
                      paired {d.createdAt ? new Date(d.createdAt).toLocaleDateString() : '—'}
                      {d.lastSeen ? ` · last seen ${new Date(d.lastSeen).toLocaleString()}` : ''}
                    </div>
                  </div>
                  <button
                    onClick={() => revokeDevice(d.id)}
                    className="shrink-0 rounded-md px-2 py-1 text-[11.5px] text-faint hover:bg-muted hover:text-destructive"
                  >
                    revoke
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
