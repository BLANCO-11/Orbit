'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Globe, Plug, Trash2, Plus, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';

interface Connector {
  name: string;
  transport: 'stdio' | 'remote';
  target: string;
  status: string;
  tools: { name: string; description?: string }[];
  error?: string | null;
}

function StatusDot({ status }: { status: string }) {
  const ok = status === 'connected';
  const bad = status === 'error' || status === 'disconnected';
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${ok ? 'text-success' : bad ? 'text-destructive' : 'text-faint'}`}>
      <i className={`size-[7px] rounded-full ${ok ? 'bg-success' : bad ? 'bg-destructive' : 'bg-faint'}`} />
      {status}
    </span>
  );
}

/**
 * ConnectorsView — MCP tool servers registered with the backend (.pi/mcp.json).
 * Add/remove connectors and see each one's live status and available tools. A
 * new connector is picked up by the next spawned session.
 */
export default function ConnectorsView() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', kind: 'stdio', command: '', args: '', url: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    fetch('/api/connectors')
      .then((r) => r.json())
      .then((d) => { if (d.success) setConnectors(d.connectors); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const submit = () => {
    setError(null);
    if (!form.name.trim()) { setError('Name is required.'); return; }
    const body: any = { name: form.name.trim() };
    if (form.kind === 'remote') {
      if (!form.url.trim()) { setError('Remote connectors need a URL.'); return; }
      body.url = form.url.trim();
    } else {
      if (!form.command.trim()) { setError('Local connectors need a command.'); return; }
      body.command = form.command.trim();
      body.args = form.args.trim() ? form.args.trim().split(/\s+/) : [];
    }
    setBusy(true);
    fetch('/api/connectors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setConnectors(d.connectors);
          setAdding(false);
          setForm({ name: '', kind: 'stdio', command: '', args: '', url: '' });
        } else {
          setError(d.error || 'Failed to add connector.');
        }
      })
      .catch(() => setError('Request failed.'))
      .finally(() => setBusy(false));
  };

  const remove = (name: string) => {
    fetch(`/api/connectors/${encodeURIComponent(name)}`, { method: 'DELETE' })
      .then((r) => r.json())
      .then((d) => { if (d.success) setConnectors(d.connectors); })
      .catch(() => {});
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[860px] px-7 py-7">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Connectors</h2>
          <button onClick={refresh} aria-label="Refresh" className="text-faint hover:text-muted-foreground">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
        <p className="mb-5 mt-0.5 text-[13px] text-muted-foreground">
          MCP tool servers. Register once here — every harness session gets the tools, and each
          call lands in the timeline like any other tool. A new connector applies to the next session.
        </p>

        <div className="flex flex-col gap-2.5">
          {connectors.map((c) => {
            const open = expanded === c.name;
            return (
              <div key={c.name} className="overflow-hidden rounded-xl border border-border-soft bg-card">
                <div className="flex items-center gap-3 px-4 py-3.5">
                  <div className="grid size-9 shrink-0 place-items-center rounded-[10px] border border-border bg-muted text-muted-foreground">
                    <Globe size={16} />
                  </div>
                  <button
                    onClick={() => setExpanded(open ? null : c.name)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    aria-expanded={open}
                  >
                    {c.tools.length > 0 && (
                      open ? <ChevronDown size={13} className="shrink-0 text-faint" /> : <ChevronRight size={13} className="shrink-0 text-faint" />
                    )}
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-[13px] font-semibold">
                        {c.name} <StatusDot status={c.status} />
                      </span>
                      <span className="mt-0.5 block overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px] text-faint">
                        {c.transport} · {c.target}{c.tools.length ? ` · ${c.tools.length} tools` : ''}{c.error ? ` · ${c.error}` : ''}
                      </span>
                    </span>
                  </button>
                  <button
                    onClick={() => remove(c.name)}
                    aria-label={`Remove ${c.name}`}
                    className="shrink-0 rounded-md p-1.5 text-faint hover:bg-muted hover:text-destructive"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                {open && c.tools.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 border-t border-border-soft px-4 py-3">
                    {c.tools.map((t) => (
                      <span key={t.name} title={t.description} className="rounded-md border border-border bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                        {t.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {connectors.length === 0 && !loading && (
            <div className="rounded-xl border border-dashed border-border px-4 py-4 text-center text-xs text-faint">
              No connectors registered yet.
            </div>
          )}

          {adding ? (
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex gap-2">
                <button
                  onClick={() => setForm((f) => ({ ...f, kind: 'stdio' }))}
                  className={`rounded-lg border px-3 py-1 text-xs font-semibold ${form.kind === 'stdio' ? 'border-primary text-accent-foreground' : 'border-border text-muted-foreground'}`}
                >
                  Local (stdio)
                </button>
                <button
                  onClick={() => setForm((f) => ({ ...f, kind: 'remote' }))}
                  className={`rounded-lg border px-3 py-1 text-xs font-semibold ${form.kind === 'remote' ? 'border-primary text-accent-foreground' : 'border-border text-muted-foreground'}`}
                >
                  Remote (URL)
                </button>
              </div>
              <div className="flex flex-col gap-2">
                <input
                  placeholder="name (e.g. github)"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="rounded-lg border border-border bg-background px-2.5 py-1.5 font-mono text-[12.5px] outline-none focus:border-ring"
                />
                {form.kind === 'remote' ? (
                  <input
                    placeholder="https://mcp.example.com/sse"
                    value={form.url}
                    onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                    className="rounded-lg border border-border bg-background px-2.5 py-1.5 font-mono text-[12.5px] outline-none focus:border-ring"
                  />
                ) : (
                  <>
                    <input
                      placeholder="command (e.g. npx)"
                      value={form.command}
                      onChange={(e) => setForm((f) => ({ ...f, command: e.target.value }))}
                      className="rounded-lg border border-border bg-background px-2.5 py-1.5 font-mono text-[12.5px] outline-none focus:border-ring"
                    />
                    <input
                      placeholder="args (space-separated, e.g. -y @modelcontextprotocol/server-github)"
                      value={form.args}
                      onChange={(e) => setForm((f) => ({ ...f, args: e.target.value }))}
                      className="rounded-lg border border-border bg-background px-2.5 py-1.5 font-mono text-[12.5px] outline-none focus:border-ring"
                    />
                  </>
                )}
                {error && <span className="text-xs text-destructive">{error}</span>}
                <div className="flex gap-2">
                  <button
                    onClick={submit}
                    disabled={busy}
                    className="rounded-[9px] bg-primary px-4 py-1.5 text-[13px] font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  >
                    {busy ? 'Connecting…' : 'Add connector'}
                  </button>
                  <button onClick={() => { setAdding(false); setError(null); }} className="rounded-[9px] px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-muted">
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 py-3.5 text-xs text-faint hover:border-primary hover:text-accent-foreground"
            >
              <Plus size={14} /> Add connector — npx command, docker image, or remote MCP URL
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
