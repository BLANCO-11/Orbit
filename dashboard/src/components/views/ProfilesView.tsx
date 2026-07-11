'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Pencil, Bot, ChevronDown, ChevronRight } from 'lucide-react';

interface Profile {
  id: string;
  name: string;
  description?: string;
  harnessType: string;
  mode: string;
  effort: string;
  promptId: string;
  skills: string[];
  toolPolicy: { excluded: string[] };
  sandbox: string;
}

const MODES = ['chat', 'plan', 'edit', 'yolo'];
const EFFORTS = ['fast', 'balanced', 'deep'];
const SANDBOXES = [
  { id: 'host', label: 'Host' },
  { id: 'container', label: 'Container' },
  { id: 'remote', label: 'Remote' },
];

const EMPTY: Profile = {
  id: '', name: '', description: '', harnessType: 'picode',
  mode: 'chat', effort: 'balanced', promptId: 'standard',
  skills: [], toolPolicy: { excluded: [] }, sandbox: 'host',
};

/**
 * ProfilesView ("Agents" tab) — named, reusable session setups. Each profile
 * bundles harness · mode · effort · prompt · skills · tool policy · sandbox.
 * Picked in one click from the composer; the chips override it per session.
 */
export default function ProfilesView({ embedded = false }: { embedded?: boolean }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [prompts, setPrompts] = useState<{ id: string; label: string }[]>([]);
  const [skills, setSkills] = useState<{ id: string }[]>([]);
  const [tools, setTools] = useState<{ name: string; source: string; description?: string }[]>([]);
  const [toolsOpen, setToolsOpen] = useState(false);

  const refresh = useCallback(() => {
    fetch('/api/profiles').then((r) => r.json()).then((d) => { if (d.success) setProfiles(d.profiles); }).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    fetch('/api/prompts').then((r) => r.json()).then((d) => d.success && setPrompts(d.prompts)).catch(() => {});
    fetch('/api/skills').then((r) => r.json()).then((d) => d.success && setSkills(d.skills)).catch(() => {});
  }, [refresh]);

  // Load the tool list for the editor's harness type.
  useEffect(() => {
    if (!editing) return;
    fetch('/api/harnesses/local/tools').then((r) => r.json()).then((d) => d.success && setTools(d.tools)).catch(() => {});
  }, [editing]);

  const save = () => {
    if (!editing) return;
    fetch('/api/profiles', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editing),
    }).then((r) => r.json()).then((d) => { if (d.success) { setProfiles(d.profiles); setEditing(null); } });
  };

  const remove = (id: string) => {
    fetch(`/api/profiles/${id}`, { method: 'DELETE' }).then((r) => r.json()).then((d) => d.success && setProfiles(d.profiles));
  };

  const toggleSkill = (id: string) => setEditing((e) => e && ({ ...e, skills: e.skills.includes(id) ? e.skills.filter((s) => s !== id) : [...e.skills, id] }));
  const toggleTool = (name: string) => setEditing((e) => {
    if (!e) return e;
    const excl = e.toolPolicy.excluded;
    return { ...e, toolPolicy: { excluded: excl.includes(name) ? excl.filter((t) => t !== name) : [...excl, name] } };
  });

  // Group tools by source for the editor.
  const toolGroups = tools.reduce<Record<string, typeof tools>>((acc, t) => {
    (acc[t.source] ||= []).push(t); return acc;
  }, {});

  const inner = (
    <>
      {editing ? (
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-[12px] font-medium text-muted-foreground">Name
                <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-[13px] outline-none focus:border-ring" placeholder="e.g. Code review" />
              </label>
              <label className="text-[12px] font-medium text-muted-foreground">Description
                <input value={editing.description || ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-[13px] outline-none focus:border-ring" placeholder="short summary" />
              </label>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Segment label="Mode" value={editing.mode} options={MODES} onChange={(v) => setEditing({ ...editing, mode: v })} />
              <Segment label="Effort" value={editing.effort} options={EFFORTS} onChange={(v) => setEditing({ ...editing, effort: v })} />
              <div>
                <div className="mb-1 text-[12px] font-medium text-muted-foreground">Prompt</div>
                <select value={editing.promptId} onChange={(e) => setEditing({ ...editing, promptId: e.target.value })}
                  className="w-full rounded-lg border border-border bg-background px-2.5 py-[7px] text-[12.5px] outline-none focus:border-ring">
                  {prompts.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </div>
            </div>

            <div className="mt-4">
              <div className="mb-1.5 text-[12px] font-medium text-muted-foreground">Skills</div>
              <div className="flex flex-wrap gap-1.5">
                {skills.map((s) => (
                  <button key={s.id} onClick={() => toggleSkill(s.id)}
                    className={`rounded-full border px-2.5 py-1 font-mono text-[11.5px] ${editing.skills.includes(s.id) ? 'border-primary bg-accent text-accent-foreground' : 'border-border text-muted-foreground hover:bg-muted'}`}>
                    {s.id}
                  </button>
                ))}
                {skills.length === 0 && <span className="text-[11px] text-faint">No skills found.</span>}
              </div>
            </div>

            <div className="mt-4">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="text-[12px] font-medium text-muted-foreground">Sandbox</span>
                <Segment inline value={editing.sandbox} options={SANDBOXES.map((s) => s.id)} onChange={(v) => setEditing({ ...editing, sandbox: v })} />
                {editing.sandbox !== 'host' && <span className="text-[11px] text-faint">{editing.sandbox === 'remote' ? 'runs on a paired remote harness' : 'ephemeral container (ships in a later phase)'}</span>}
              </div>
            </div>

            <div className="mt-4">
              <button onClick={() => setToolsOpen((o) => !o)} className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground">
                {toolsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                Tools {editing.toolPolicy.excluded.length > 0 && <span className="text-faint">· {editing.toolPolicy.excluded.length} disabled</span>}
              </button>
              {toolsOpen && (
                <div className="mt-2 flex flex-col gap-3 rounded-xl border border-border-soft bg-muted/40 p-3">
                  {Object.entries(toolGroups).map(([source, ts]) => (
                    <div key={source}>
                      <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-faint">{source}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {ts.map((t) => {
                          const off = editing.toolPolicy.excluded.includes(t.name);
                          return (
                            <button key={t.name} onClick={() => toggleTool(t.name)} title={t.description}
                              className={`rounded-md border px-2 py-1 font-mono text-[11px] ${off ? 'border-border bg-background text-faint line-through' : 'border-success/40 bg-success/10 text-success'}`}>
                              {t.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  <span className="text-[11px] text-faint">Green = enabled, struck-through = disabled for this profile. (pi-web-access is pi&apos;s native browser — leave it off to use only Lightpanda.)</span>
                </div>
              )}
            </div>

            <div className="mt-5 flex gap-2">
              <button onClick={save} className="rounded-[9px] bg-primary px-4 py-1.5 text-[13px] font-semibold text-primary-foreground hover:opacity-90">Save profile</button>
              <button onClick={() => setEditing(null)} className="rounded-[9px] px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-muted">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {profiles.map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-xl border border-border-soft bg-card px-4 py-3">
                <div className="grid size-9 shrink-0 place-items-center rounded-[10px] border border-border bg-muted text-muted-foreground"><Bot size={16} /></div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold">{p.name}</div>
                  <div className="mt-0.5 font-mono text-[11px] text-faint">
                    {p.mode} · {p.effort} · {p.promptId}{p.skills.length ? ` · ${p.skills.length} skill${p.skills.length > 1 ? 's' : ''}` : ''}{p.toolPolicy?.excluded?.length ? ` · ${p.toolPolicy.excluded.length} tool${p.toolPolicy.excluded.length > 1 ? 's' : ''} off` : ''}{p.sandbox !== 'host' ? ` · ${p.sandbox}` : ''}
                  </div>
                </div>
                <button onClick={() => { setToolsOpen(false); setEditing({ ...EMPTY, ...p, toolPolicy: { excluded: p.toolPolicy?.excluded || [] } }); }} aria-label="Edit" className="shrink-0 rounded-md p-1.5 text-faint hover:bg-muted hover:text-foreground"><Pencil size={14} /></button>
                <button onClick={() => remove(p.id)} aria-label="Delete" className="shrink-0 rounded-md p-1.5 text-faint hover:bg-muted hover:text-destructive"><Trash2 size={14} /></button>
              </div>
            ))}
            <button onClick={() => { setToolsOpen(false); setEditing({ ...EMPTY }); }}
              className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 py-3.5 text-xs text-faint hover:border-primary hover:text-accent-foreground">
              <Plus size={14} /> New agent profile
            </button>
          </div>
        )}
    </>
  );

  if (embedded) return inner;
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[860px] px-7 py-7">
        <h2 className="text-lg font-semibold">Agents</h2>
        <p className="mb-5 mt-0.5 text-[13px] text-muted-foreground">
          Reusable session setups — harness, mode, effort, prompt, skills, and which tools are on.
          Pick one from the composer in a click; the chips still override it per session.
        </p>
        {inner}
      </div>
    </div>
  );
}

function Segment({ label, value, options, onChange, inline }: { label?: string; value: string; options: string[]; onChange: (v: string) => void; inline?: boolean }) {
  return (
    <div>
      {label && <div className="mb-1 text-[12px] font-medium text-muted-foreground">{label}</div>}
      <div className={`inline-flex rounded-lg border border-border-soft bg-background p-0.5 ${inline ? '' : 'w-full'}`}>
        {options.map((o) => (
          <button key={o} onClick={() => onChange(o)}
            className={`flex-1 rounded-md px-2.5 py-1 text-[11.5px] font-semibold capitalize transition-colors ${value === o ? 'bg-card text-foreground shadow-card' : 'text-faint hover:text-foreground'}`}>
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}
