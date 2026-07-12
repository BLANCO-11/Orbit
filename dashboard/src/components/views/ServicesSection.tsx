'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Plug, Check, ExternalLink, X } from 'lucide-react';

interface Provider {
  id: string;
  name: string;
  kind: 'oauth' | 'token';
  scopes: string[];
  hasMcp: boolean;
  configured: boolean;
  connected: boolean;
  setupUrl: string | null;
  tokenLabel: string | null;
  help: string | null;
}

/**
 * ServicesSection — "Connect a service." OAuth providers login-and-approve;
 * token providers (e.g. Telegram) take a pasted token. Connecting stores an
 * encrypted token server-side and, where a provider has an MCP mapping, wires
 * it so the agent can act on the service. Separate from triggers (channels).
 */
export default function ServicesSection() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [tokenFor, setTokenFor] = useState<string | null>(null);
  const [tokenVal, setTokenVal] = useState('');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const refresh = useCallback(() => {
    fetch('/api/connections').then((r) => r.json()).then((d) => d.success && setProviders(d.providers)).catch(() => {});
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  // Surface the OAuth return (?connected / ?connect_error) then clean the URL.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('connected')) { setNotice({ kind: 'ok', text: `Connected ${q.get('connected')}.` }); refresh(); }
    else if (q.get('connect_error')) { setNotice({ kind: 'err', text: `Connect failed: ${q.get('connect_error')}` }); }
    if (q.get('connected') || q.get('connect_error')) {
      window.history.replaceState({}, '', window.location.pathname);
      const t = setTimeout(() => setNotice(null), 6000);
      return () => clearTimeout(t);
    }
  }, [refresh]);

  const connectOauth = (id: string) => { window.location.href = `/api/oauth/${id}/start`; };
  const submitToken = (id: string) => {
    if (!tokenVal.trim()) return;
    fetch(`/api/connections/${id}/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: tokenVal.trim() }) })
      .then((r) => r.json()).then((d) => { if (d.success) { setTokenFor(null); setTokenVal(''); refresh(); } });
  };
  const disconnect = (id: string) => fetch(`/api/connections/${id}`, { method: 'DELETE' }).then((r) => r.json()).then(() => refresh());

  return (
    <div className="mb-6">
      <div className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.08em] text-faint">Services — connect by login</div>
      {notice && (
        <div className={`mb-2.5 rounded-lg px-3 py-2 text-[12px] ${notice.kind === 'ok' ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}>{notice.text}</div>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {providers.map((p) => (
          <div key={p.id} className="flex items-center gap-3 rounded-xl border border-border-soft bg-card px-4 py-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-[10px] border border-border bg-muted text-muted-foreground"><Plug size={16} /></div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[13px] font-semibold">
                {p.name}
                {p.connected && <span className="inline-flex items-center gap-1 text-[11px] font-medium text-success"><Check size={11} /> connected</span>}
              </div>
              <div className="mt-0.5 font-mono text-[11px] text-faint">
                {p.kind === 'oauth' ? 'OAuth' : 'token'}{p.hasMcp ? ' · wires a tool' : ''}
                {p.kind === 'oauth' && !p.configured && !p.connected ? ' · needs app setup' : ''}
              </div>
            </div>

            {p.connected ? (
              <button onClick={() => disconnect(p.id)} className="shrink-0 rounded-md px-2.5 py-1 text-[11.5px] text-faint hover:bg-muted hover:text-destructive">Disconnect</button>
            ) : p.kind === 'token' ? (
              tokenFor === p.id ? (
                <div className="flex shrink-0 items-center gap-1.5">
                  <input autoFocus value={tokenVal} onChange={(e) => setTokenVal(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submitToken(p.id)}
                    placeholder={p.tokenLabel || 'token'} className="w-40 rounded-lg border border-border bg-background px-2 py-1 font-mono text-[11.5px] outline-none focus:border-ring" />
                  <button onClick={() => submitToken(p.id)} className="rounded-lg bg-primary px-2.5 py-1 text-[11.5px] font-semibold text-primary-foreground">Save</button>
                  <button onClick={() => { setTokenFor(null); setTokenVal(''); }} className="rounded-md p-1 text-faint hover:text-foreground"><X size={13} /></button>
                </div>
              ) : (
                <button onClick={() => setTokenFor(p.id)} className="shrink-0 rounded-lg bg-primary px-3 py-1 text-[12px] font-semibold text-primary-foreground hover:opacity-90">Connect</button>
              )
            ) : p.configured ? (
              <button onClick={() => connectOauth(p.id)} className="shrink-0 rounded-lg bg-primary px-3 py-1 text-[12px] font-semibold text-primary-foreground hover:opacity-90">Connect</button>
            ) : (
              <a href={p.setupUrl || '#'} target="_blank" rel="noreferrer" title="Register an OAuth app, then set its client id/secret in Orbit's env" className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground hover:bg-muted">
                Set up <ExternalLink size={11} />
              </a>
            )}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-faint">
        OAuth providers need a one-time app registration (their client id/secret in Orbit&apos;s env) unless the server supports dynamic registration; token providers just take a pasted token. Tokens are encrypted at rest. Connecting lets the agent <span className="font-semibold">use</span> the service — add a channel to also <span className="font-semibold">trigger</span> on it.
      </p>
    </div>
  );
}
