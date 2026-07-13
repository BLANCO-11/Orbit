'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Save, FileText, Sparkles, Loader2, Hash } from 'lucide-react';

// Rough token estimate for the live indicator (~4 chars/token). A precise,
// per-model count + an LLM-scored quality rating are the planned next step.
const estTokens = (s: string) => Math.max(0, Math.ceil((s || '').length / 4));
const fmt = (n: number) => n.toLocaleString();

type Tab = 'prompts' | 'skills';
interface Item { id: string; label?: string; description?: string; isDefault?: boolean }

export default function LibraryView() {
  const [tab, setTab] = useState<Tab>('prompts');
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [draft, setDraft] = useState<{ id: string; content: string; description: string; protected?: boolean }>({ id: '', content: '', description: '' });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const base = tab === 'prompts' ? '/api/prompts' : '/api/skills';

  const loadList = useCallback(async () => {
    setErr(null);
    try {
      const r = await fetch(base);
      const d = await r.json();
      setItems(tab === 'prompts' ? (d.prompts || []) : (d.skills || []));
    } catch { setItems([]); }
  }, [base, tab]);

  useEffect(() => { setSelected(null); setIsNew(false); setDraft({ id: '', content: '', description: '' }); loadList(); }, [tab, loadList]);

  const open = useCallback(async (id: string) => {
    setSelected(id); setIsNew(false); setErr(null); setLoading(true);
    try {
      const d = await (await fetch(`${base}/${id}`)).json();
      if (tab === 'prompts') setDraft({ id, content: d.content || '', description: '', protected: d.protected });
      else setDraft({ id, content: d.body || '', description: d.description || '' });
    } catch { setErr('Could not open.'); }
    setLoading(false);
  }, [base, tab]);

  const startNew = () => { setSelected(null); setIsNew(true); setErr(null); setDraft({ id: '', content: '', description: '' }); };

  const save = async () => {
    setErr(null);
    const id = draft.id.trim();
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) { setErr('id must be lowercase letters/numbers/hyphens (max 64).'); return; }
    if (!draft.content.trim()) { setErr('Content is required.'); return; }
    setSaving(true);
    try {
      const body = tab === 'prompts'
        ? { id, content: draft.content }
        : { id, description: draft.description, body: draft.content };
      const r = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!d.success) { setErr(d.error || 'Save failed.'); setSaving(false); return; }
      setItems(tab === 'prompts' ? (d.prompts || []) : (d.skills || []));
      setIsNew(false); setSelected(id);
    } catch { setErr('Save failed.'); }
    setSaving(false);
  };

  const del = async () => {
    if (!selected) return;
    if (!confirm(`Delete "${selected}"? This can't be undone.`)) return;
    setErr(null);
    try {
      const d = await (await fetch(`${base}/${selected}`, { method: 'DELETE' })).json();
      if (!d.success) { setErr(d.error || 'Delete failed.'); return; }
      setItems(tab === 'prompts' ? (d.prompts || []) : (d.skills || []));
      setSelected(null); setDraft({ id: '', content: '', description: '' });
    } catch { setErr('Delete failed.'); }
  };

  const editing = isNew || selected !== null;
  const tokens = estTokens(draft.content) + (tab === 'skills' ? estTokens(draft.description) : 0);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border-soft px-7 py-5">
        <h2 className="text-lg font-semibold">Library</h2>
        <div className="inline-flex rounded-lg border border-border-soft bg-background p-0.5">
          {(['prompts', 'skills'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-[12px] font-semibold capitalize transition-colors ${tab === t ? 'bg-card text-foreground shadow-card' : 'text-faint hover:text-foreground'}`}>
              {t === 'prompts' ? <FileText size={13} /> : <Sparkles size={13} />}{t}
            </button>
          ))}
        </div>
        <p className="ml-1 hidden text-[11.5px] text-faint md:block">
          {tab === 'prompts' ? 'System prompts you can pick per session.' : 'Reusable instruction packs attached per session (inherited by sub-agents).'}
        </p>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* List */}
        <div className="flex w-[260px] shrink-0 flex-col border-r border-border-soft">
          <div className="p-3">
            <button onClick={startNew}
              className="flex w-full items-center justify-center gap-1.5 rounded-[9px] border border-border bg-card px-3 py-[9px] text-[13px] font-semibold shadow-card transition-colors hover:border-ring/40">
              <Plus size={15} className="text-primary" strokeWidth={2.4} /> New {tab === 'prompts' ? 'prompt' : 'skill'}
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-3">
            {items.length === 0 && <p className="px-2 py-4 text-center text-xs text-faint">Nothing yet.</p>}
            {items.map((it) => (
              <button key={it.id} onClick={() => open(it.id)}
                className={`mb-1 flex w-full flex-col items-start rounded-lg px-2.5 py-2 text-left transition-colors ${selected === it.id ? 'bg-accent' : 'hover:bg-muted'}`}>
                <span className="flex w-full items-center gap-1.5 text-[13px] font-medium">
                  <span className="truncate">{it.label || it.id}</span>
                  {it.isDefault && <span className="ml-auto shrink-0 rounded border border-border px-1 text-[9px] text-faint">default</span>}
                </span>
                <span className="truncate text-[11px] text-faint">{it.description || it.id}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Editor */}
        <div className="flex min-w-0 flex-1 flex-col">
          {!editing ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
              {tab === 'prompts' ? <FileText size={22} className="text-faint" /> : <Sparkles size={22} className="text-faint" />}
              <p className="text-[13px] font-medium text-muted-foreground">Select {tab === 'prompts' ? 'a prompt' : 'a skill'} to edit</p>
              <p className="max-w-[320px] text-xs leading-relaxed text-faint">…or create a new one. Paste in content and watch the token count; save writes it to the library and it becomes selectable in the composer.</p>
            </div>
          ) : loading ? (
            <div className="flex h-full items-center justify-center text-faint"><Loader2 size={18} className="animate-spin" /></div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-soft px-5 py-3">
                <input
                  value={draft.id}
                  onChange={(e) => setDraft((d) => ({ ...d, id: e.target.value }))}
                  disabled={!isNew}
                  placeholder={tab === 'prompts' ? 'my-prompt' : 'my-skill'}
                  className="w-[200px] rounded-lg border border-border bg-background px-2.5 py-1.5 font-mono text-[13px] outline-none focus:border-ring disabled:opacity-70"
                />
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-[11px] font-semibold text-muted-foreground tabular-nums" title="Estimated tokens (~4 chars/token)">
                  <Hash size={11} /> ~{fmt(tokens)} tokens
                </span>
                <div className="ml-auto flex items-center gap-2">
                  {selected && !draft.protected && (
                    <button onClick={del} className="flex items-center gap-1.5 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-[12.5px] font-semibold text-destructive hover:bg-destructive/20">
                      <Trash2 size={13} /> Delete
                    </button>
                  )}
                  <button onClick={save} disabled={saving}
                    className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-[12.5px] font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
                    {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save
                  </button>
                </div>
              </div>

              {tab === 'skills' && (
                <input
                  value={draft.description}
                  onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                  placeholder="Short description — when should the agent use this skill?"
                  className="mx-5 mt-3 rounded-lg border border-border bg-background px-2.5 py-1.5 text-[12.5px] outline-none focus:border-ring"
                />
              )}

              {err && <p className="mx-5 mt-2 text-[12px] text-destructive">{err}</p>}
              {draft.protected && <p className="mx-5 mt-2 text-[11px] text-faint">This is a protected default — editable, but can't be deleted.</p>}

              <textarea
                value={draft.content}
                onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
                placeholder={tab === 'prompts'
                  ? 'Paste or write the system prompt (markdown)…'
                  : 'Write the skill instructions (markdown) — the agent appends this to its system prompt when attached…'}
                spellCheck={false}
                className="m-5 min-h-0 flex-1 resize-none rounded-xl border border-border-soft bg-background p-4 font-mono text-[12.5px] leading-relaxed outline-none focus:border-ring"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
