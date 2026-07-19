'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Terminal, Globe, Laptop, Smartphone, Tablet, RefreshCw, Copy, Check, Unplug } from 'lucide-react';
import { useDevices } from '@/hooks/useDevices';
import { getDeviceToken } from '@/lib/device-auth';

function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 mt-5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-faint first:mt-0">
      {children}
    </div>
  );
}

/** A monospace command/link box with a copy button. Falls back to select-all
 *  when the clipboard API is unavailable (e.g. non-secure origin). */
function CopyBox({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else throw new Error('no clipboard');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback: select the text so the user can Ctrl+C.
      const el = document.getElementById(`copybox-${label}`) as HTMLInputElement | null;
      el?.focus();
      el?.select();
    }
  }, [value, label]);
  return (
    <div className="flex items-stretch gap-1.5">
      <input
        id={`copybox-${label}`}
        readOnly
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        className="min-w-0 flex-1 select-all rounded-lg border border-border bg-muted/60 px-2 py-1.5 font-mono text-[11.5px] text-accent-foreground"
      />
      <button
        onClick={copy}
        aria-label="Copy"
        className="shrink-0 rounded-lg border border-border px-2 text-muted-foreground hover:bg-muted hover:text-accent-foreground"
      >
        {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
      </button>
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

  // A paired DEVICE is the durable identity; the live AGENTS on it are connected
  // harnesses (a laptop can run pi + claude at once — same device token, so same
  // deviceId). Group connected remote agents under their paired device, and keep
  // the local host's agent(s) separate.
  const agentsByDevice = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const h of harnesses) {
      if (h.transport !== 'remote') continue;
      const key = h.deviceId || h.machine || h.id;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(h);
    }
    return m;
  }, [harnesses]);
  const localHarnesses = useMemo(() => harnesses.filter((h) => h.transport !== 'remote'), [harnesses]);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const disconnectHarness = useCallback((h: any) => {
    if (!confirm(`Disconnect "${h.name}"? Any sessions running on it will be cancelled.`)) return;
    setDisconnecting(h.id);
    fetch(`/api/harnesses/${encodeURIComponent(h.id)}`, { method: 'DELETE' })
      .then((r) => r.json())
      .then(() => refreshHarnesses())
      .catch(() => {})
      .finally(() => setDisconnecting(null));
  }, [refreshHarnesses]);
  useEffect(() => {
    refreshHarnesses();
    const t = setInterval(refreshHarnesses, 5000); // remote adapters connect/leave live
    return () => clearInterval(t);
  }, [refreshHarnesses]);

  // Live pairing status: snapshot which harnesses exist the moment a code is
  // minted, then a harness that shows up afterward (while the code is live) is
  // the one that just paired → flip "waiting" to "connected" with no refresh.
  // Drives off the existing /api/harnesses poll, so no extra WS plumbing.
  const pairBaseline = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (pairing) pairBaseline.current = new Set(harnesses.map((h) => h.id));
    else pairBaseline.current = null;
    // Intentionally only re-snapshot when the code itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairing?.code]);
  const connectedHarness = pairing && pairBaseline.current
    ? harnesses.find((h) => !pairBaseline.current!.has(h.id))
    : null;

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
          <div className="flex flex-col rounded-2xl border border-border bg-card p-6 shadow-card">
            <h3 className="text-center text-sm font-semibold">Pair a harness</h3>
            <p className="mb-4 mt-0.5 text-center text-xs text-muted-foreground">
              Mint a code, then hand the harness machine <span className="font-medium">one command</span>. It
              connects, persists its token, and reconnects on its own after that.
            </p>

            {pairing && secondsLeft > 0 ? (
              <>
                <div className="flex flex-col items-center">
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
                </div>

                {/* Live status — flips without a refresh once the harness registers. */}
                <div className="mt-4 rounded-lg border border-border bg-background px-3 py-2 text-center text-xs">
                  {connectedHarness ? (
                    <span className="inline-flex items-center gap-1.5 font-medium text-success">
                      <Check size={13} /> Connected — {connectedHarness.name}
                      <span className="text-faint">({SCOPES.find((s) => s.id === (pairing.scope || 'full'))?.label})</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                      <span className="size-[7px] animate-pulse rounded-full bg-warning" /> Waiting for harness…
                    </span>
                  )}
                </div>

                {/* Primary action: the exact command to paste on the harness machine. */}
                {pairing.bootstrapCommand && (
                  <div className="mt-4">
                    <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.08em] text-faint">
                      Orbit adapter — paste this command
                    </div>
                    <CopyBox value={pairing.bootstrapCommand} label="bootstrap" />
                  </div>
                )}

                {/* Secondary: the raw descriptor link for custom/third-party harnesses. */}
                {pairing.connectUrl && (
                  <div className="mt-3">
                    <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.08em] text-faint">
                      Custom harness — fetch this connect link
                    </div>
                    <CopyBox value={pairing.connectUrl} label="connect" />
                  </div>
                )}

                {pairing.pairingUrl && (
                  <p className="mt-3 text-center text-[11px] text-faint">
                    Pairing from another browser? Open <span className="font-mono">/pair</span> there and enter the code.
                  </p>
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
                  className="self-center rounded-[9px] bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground hover:opacity-90"
                >
                  Generate pairing code
                </button>
              </>
            )}
          </div>

          {/* ── Devices: paired identities + the live agents on each ── */}
          <div>
            <SectionHead>
              Devices · {devices.filter((d: any) => !d.revoked).length}
              <button onClick={() => { refreshHarnesses(); refreshDevices(); }} aria-label="Refresh" className="ml-2 align-middle text-faint hover:text-muted-foreground">
                <RefreshCw size={11} />
              </button>
            </SectionHead>
            <div className="flex flex-col gap-2">
              {/* This host — the local agent runtime (no pairing/revoke). */}
              {localHarnesses.map((h) => (
                <div key={h.id} className="rounded-xl border border-border-soft bg-card px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="grid size-9 shrink-0 place-items-center rounded-[10px] border border-border bg-muted text-muted-foreground">
                      <Terminal size={16} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[13px] font-semibold">
                        This host
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-success"><i className="size-[7px] rounded-full bg-success" /> local</span>
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[11px] text-faint">
                        {h.name}{h.model ? ` · ${h.model}` : ''}{h.provider ? ` · ${h.provider}` : ''}
                        {typeof h.activeSessions === 'number' && h.activeSessions > 0 ? ` · ${h.activeSessions} active` : ''}
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {devices.filter((d: any) => !d.revoked).length === 0 && (
                <div className="rounded-xl border border-dashed border-border px-4 py-4 text-center text-xs text-faint">
                  No paired devices yet — {pairing && secondsLeft > 0 ? 'run the connect command on the device.' : 'generate a pairing code to add one.'}
                </div>
              )}

              {devices.filter((d: any) => !d.revoked).map((d: any) => {
                const agents = agentsByDevice.get(d.id) || [];
                const online = agents.length > 0;
                const osName = agents.find((a) => a.osName)?.osName || '';
                const totalSessions = agents.reduce((n, a) => n + (typeof a.activeSessions === 'number' ? a.activeSessions : 0), 0);
                return (
                  <div key={d.id} className="rounded-xl border border-border-soft bg-card px-4 py-3">
                    {/* Paired device header */}
                    <div className="flex items-center gap-3">
                      <div className="grid size-9 shrink-0 place-items-center rounded-[10px] border border-border bg-muted text-muted-foreground">
                        <DeviceIcon label={d.label} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-[13px] font-semibold">
                          {d.label || 'Unnamed device'}
                          <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${online ? 'text-success' : 'text-faint'}`}>
                            <i className={`size-[7px] rounded-full ${online ? 'bg-success' : 'bg-border'}`} /> {online ? `online · ${agents.length} agent${agents.length === 1 ? '' : 's'}` : 'offline'}
                          </span>
                          {osName && <span className="rounded-full border border-border px-2 py-px text-[10px] font-medium text-muted-foreground">{osName}</span>}
                          <span className="rounded-full border border-border px-2 py-px text-[10px] font-medium text-muted-foreground">
                            {SCOPES.find((s) => s.id === (d.scope || 'full'))?.label || d.scope}
                          </span>
                        </div>
                        <div className="mt-0.5 font-mono text-[11px] text-faint">
                          {agents[0]?.machine ? `${agents[0].machine} · ` : ''}paired {d.createdAt ? new Date(d.createdAt).toLocaleDateString() : '—'}
                          {d.lastSeen ? ` · last seen ${new Date(d.lastSeen).toLocaleString()}` : ''}
                          {totalSessions > 0 ? ` · ${totalSessions} active session${totalSessions === 1 ? '' : 's'}` : ''}
                        </div>
                      </div>
                      <button
                        onClick={() => revokeDevice(d.id)}
                        className="shrink-0 rounded-md px-2 py-1 text-[11.5px] text-faint hover:bg-muted hover:text-destructive"
                        title="Revoke this device (kills its token; it must re-pair)"
                      >
                        revoke
                      </button>
                    </div>

                    {/* Live agents on this device (a laptop can run pi + claude + …). */}
                    {online && (
                      <div className="mt-2 flex flex-col gap-1.5 border-t border-border-soft pt-2">
                        {agents.map((h) => (
                          <div key={h.id} className="flex items-center gap-2.5">
                            <Globe size={13} className="shrink-0 text-faint" />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[12px] font-medium">{h.agent || h.name}</div>
                              <div className="truncate font-mono text-[10.5px] text-faint">
                                {h.model ? `${h.model}${h.provider ? ` · ${h.provider}` : ''}` : (h.provider || 'via adapter')}
                                {typeof h.activeSessions === 'number' && h.activeSessions > 0 ? ` · ${h.activeSessions} active` : ''}
                              </div>
                            </div>
                            <button
                              onClick={() => disconnectHarness(h)}
                              disabled={disconnecting === h.id}
                              title="Disconnect this agent"
                              className="flex shrink-0 items-center gap-1 rounded-lg border border-border px-2 py-1 text-[10.5px] font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 disabled:opacity-50"
                            >
                              <Unplug size={11} /> {disconnecting === h.id ? '…' : 'Disconnect'}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
