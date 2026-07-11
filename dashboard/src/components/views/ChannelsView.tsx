'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Pencil, Webhook, Clock, Play, Copy, Check } from 'lucide-react';

interface Channel {
  id: string;
  name: string;
  type: 'webhook' | 'schedule';
  profileId: string | null;
  promptTemplate: string;
  enabled: boolean;
  verify: string;
  hasSecret: boolean;
  secret?: string;
  intervalMinutes: number | null;
  dailyAt: string | null;
  webhookUrl: string | null;
  lastTriggered: number | null;
}

const EMPTY: Channel = {
  id: '', name: '', type: 'schedule', profileId: null, promptTemplate: '',
  enabled: true, verify: 'none', hasSecret: false, secret: '',
  intervalMinutes: 60, dailyAt: null, webhookUrl: null, lastTriggered: null,
};

/**
 * ChannelsView — inbound triggers that run a profile headlessly. Schedule
 * channels fire locally (no exposure); webhook channels receive verified
 * external events. Runs land in the session list like any other session.
 */
export default function ChannelsView() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [profiles, setProfiles] = useState<{ id: string; name: string }[]>([]);
  const [editing, setEditing] = useState<Channel | null>(null);
  const [copied, setCopied] = useState('');

  const refresh = useCallback(() => {
    fetch('/api/channels').then((r) => r.json()).then((d) => d.success && setChannels(d.channels)).catch(() => {});
  }, []);
  useEffect(() => {
    refresh();
    fetch('/api/profiles').then((r) => r.json()).then((d) => d.success && setProfiles(d.profiles)).catch(() => {});
  }, [refresh]);

  const save = () => {
    if (!editing) return;
    fetch('/api/channels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editing) })
      .then((r) => r.json()).then((d) => { if (d.success) { setChannels(d.channels); setEditing(null); } });
  };
  const remove = (id: string) => fetch(`/api/channels/${id}`, { method: 'DELETE' }).then((r) => r.json()).then((d) => d.success && setChannels(d.channels));
  const testFire = (id: string) => fetch(`/api/channels/${id}/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then((r) => r.json()).then(() => refresh());
  const copy = (text: string, id: string) => { navigator.clipboard.writeText(text); setCopied(id); setTimeout(() => setCopied(''), 1500); };

  const profileName = (pid: string | null) => profiles.find((p) => p.id === pid)?.name || '(none)';

  if (editing) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-[12px] font-medium text-muted-foreground">Name
            <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-[13px] outline-none focus:border-ring" placeholder="e.g. GitHub issue triage" />
          </label>
          <div>
            <div className="mb-1 text-[12px] font-medium text-muted-foreground">Runs profile</div>
            <select value={editing.profileId || ''} onChange={(e) => setEditing({ ...editing, profileId: e.target.value || null })}
              className="w-full rounded-lg border border-border bg-background px-2.5 py-[7px] text-[12.5px] outline-none focus:border-ring">
              <option value="">(pick a profile)</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>

        <div className="mt-3">
          <div className="mb-1 text-[12px] font-medium text-muted-foreground">Trigger</div>
          <div className="inline-flex rounded-lg border border-border-soft bg-background p-0.5">
            {(['schedule', 'webhook'] as const).map((t) => (
              <button key={t} onClick={() => setEditing({ ...editing, type: t })}
                className={`rounded-md px-3 py-1 text-[11.5px] font-semibold capitalize transition-colors ${editing.type === t ? 'bg-card text-foreground shadow-card' : 'text-faint hover:text-foreground'}`}>
                {t}
              </button>
            ))}
          </div>
        </div>

        {editing.type === 'schedule' ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-[12px] font-medium text-muted-foreground">Every N minutes
              <input type="number" min={1} value={editing.intervalMinutes ?? ''} onChange={(e) => setEditing({ ...editing, intervalMinutes: e.target.value ? Number(e.target.value) : null })}
                className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 font-mono text-[13px] outline-none focus:border-ring" placeholder="60" />
            </label>
            <label className="text-[12px] font-medium text-muted-foreground">…or daily at (HH:MM)
              <input value={editing.dailyAt || ''} onChange={(e) => setEditing({ ...editing, dailyAt: e.target.value || null })}
                className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 font-mono text-[13px] outline-none focus:border-ring" placeholder="09:00" />
            </label>
          </div>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <div className="mb-1 text-[12px] font-medium text-muted-foreground">Verify</div>
              <select value={editing.verify} onChange={(e) => setEditing({ ...editing, verify: e.target.value })}
                className="w-full rounded-lg border border-border bg-background px-2.5 py-[7px] text-[12.5px] outline-none focus:border-ring">
                <option value="none">None (dev only)</option>
                <option value="bearer">Bearer token</option>
                <option value="github">GitHub HMAC</option>
                <option value="slack">Slack signing</option>
              </select>
            </div>
            <label className="text-[12px] font-medium text-muted-foreground">Secret
              <input value={editing.secret || ''} onChange={(e) => setEditing({ ...editing, secret: e.target.value })}
                className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 font-mono text-[13px] outline-none focus:border-ring" placeholder={editing.hasSecret ? '•••••• (set)' : 'signing secret'} />
            </label>
          </div>
        )}

        <label className="mt-3 block text-[12px] font-medium text-muted-foreground">Prompt template
          <textarea value={editing.promptTemplate} onChange={(e) => setEditing({ ...editing, promptTemplate: e.target.value })} rows={3}
            className="mt-1 w-full resize-y rounded-lg border border-border bg-background px-2.5 py-1.5 text-[12.5px] outline-none focus:border-ring"
            placeholder={editing.type === 'webhook' ? 'Triage issue: {{issue.title}} by {{issue.user.login}}' : 'Summarize what changed in the repo today.'} />
          {editing.type === 'webhook' && <span className="mt-1 block text-[11px] text-faint">Use <span className="font-mono">&#123;&#123;path.to.field&#125;&#125;</span> to pull values from the event payload.</span>}
        </label>

        <label className="mt-3 flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <input type="checkbox" checked={editing.enabled} onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })} /> Enabled
        </label>

        <div className="mt-5 flex gap-2">
          <button onClick={save} className="rounded-[9px] bg-primary px-4 py-1.5 text-[13px] font-semibold text-primary-foreground hover:opacity-90">Save channel</button>
          <button onClick={() => setEditing(null)} className="rounded-[9px] px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-muted">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {channels.map((c) => (
        <div key={c.id} className="rounded-xl border border-border-soft bg-card px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-[10px] border border-border bg-muted text-muted-foreground">
              {c.type === 'webhook' ? <Webhook size={16} /> : <Clock size={16} />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[13px] font-semibold">
                {c.name}
                {!c.enabled && <span className="rounded-full border border-border px-2 py-px text-[10px] font-medium text-faint">disabled</span>}
              </div>
              <div className="mt-0.5 font-mono text-[11px] text-faint">
                {c.type === 'schedule' ? (c.dailyAt ? `daily ${c.dailyAt}` : `every ${c.intervalMinutes}m`) : `webhook · verify ${c.verify}`}
                {' · '}runs {profileName(c.profileId)}
                {c.lastTriggered ? ` · last ${new Date(c.lastTriggered).toLocaleString()}` : ''}
              </div>
            </div>
            <button onClick={() => testFire(c.id)} title="Run now" className="shrink-0 rounded-md p-1.5 text-faint hover:bg-muted hover:text-accent-foreground"><Play size={14} /></button>
            <button onClick={() => setEditing({ ...EMPTY, ...c, secret: '' })} aria-label="Edit" className="shrink-0 rounded-md p-1.5 text-faint hover:bg-muted hover:text-foreground"><Pencil size={14} /></button>
            <button onClick={() => remove(c.id)} aria-label="Delete" className="shrink-0 rounded-md p-1.5 text-faint hover:bg-muted hover:text-destructive"><Trash2 size={14} /></button>
          </div>
          {c.type === 'webhook' && c.webhookUrl && (
            <button onClick={() => copy(c.webhookUrl!, c.id)} className="mt-2 flex w-full items-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 px-3 py-1.5 text-left font-mono text-[11px] text-muted-foreground hover:border-primary">
              {copied === c.id ? <Check size={12} className="text-success" /> : <Copy size={12} className="text-faint" />}
              <span className="truncate">{c.webhookUrl}</span>
            </button>
          )}
        </div>
      ))}
      <button onClick={() => setEditing({ ...EMPTY })}
        className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 py-3.5 text-xs text-faint hover:border-primary hover:text-accent-foreground">
        <Plus size={14} /> New channel — run a profile on a schedule or from a webhook
      </button>
      <p className="mt-1 text-[11px] leading-relaxed text-faint">
        Schedule channels run locally with no exposure. Webhook channels need this console reachable from the sender;
        every run appears in the session list with its full timeline.
      </p>
    </div>
  );
}
