'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2, KeyRound, Users, Activity, ShieldCheck, Plus, Trash2, Copy, Check,
  RefreshCw, AlertTriangle, CircleCheck, CircleSlash,
} from 'lucide-react';
import type { AuthIdentity } from '@/hooks/useAuth';

// ── shared helpers ───────────────────────────────────────────────────
const ROLES = ['admin', 'member', 'viewer'] as const;
const SCOPES = ['full', 'chat_voice', 'read_only'] as const;

async function api(path: string, opts?: RequestInit) {
  const r = await fetch(`/api/admin${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.success === false) throw new Error(d.message || `Request failed (${r.status})`);
  return d;
}

function fmtDate(ts?: number | null) {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleString(); } catch { return '—'; }
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
      }}
      className="shrink-0 rounded-md border border-border px-1.5 py-1 text-muted-foreground hover:bg-muted hover:text-accent-foreground"
      title="Copy"
    >
      {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
    </button>
  );
}

function RoleBadge({ role }: { role: string }) {
  const tone =
    role === 'superadmin' ? 'bg-primary/10 text-primary'
    : role === 'admin' ? 'bg-accent text-accent-foreground'
    : role === 'viewer' ? 'bg-muted text-muted-foreground'
    : 'bg-muted/60 text-foreground';
  return <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${tone}`}>{role}</span>;
}

function ErrorBar({ error, onDismiss }: { error: string | null; onDismiss: () => void }) {
  if (!error) return null;
  return (
    <div className="mb-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <span className="flex-1">{error}</span>
      <button onClick={onDismiss} className="text-destructive/70 hover:text-destructive">✕</button>
    </div>
  );
}

// ── Tenants tab ──────────────────────────────────────────────────────
function TenantsTab() {
  const [tenants, setTenants] = useState<any[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api('/tenants').then((d) => setTenants(d.tenants || [])).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const create = () => {
    if (!name.trim()) return;
    setBusy(true); setError(null);
    api('/tenants', { method: 'POST', body: JSON.stringify({ name: name.trim() }) })
      .then(() => { setName(''); refresh(); })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };
  const remove = (id: string) => {
    if (!confirm('Delete this tenant? Its API keys are revoked and its users removed.')) return;
    api(`/tenants/${id}`, { method: 'DELETE' }).then(refresh).catch((e) => setError(e.message));
  };

  return (
    <div>
      <ErrorBar error={error} onDismiss={() => setError(null)} />
      <div className="mb-4 flex items-end gap-2">
        <div className="flex-1">
          <label className="mb-1 block text-[11px] font-medium text-muted-foreground">New tenant name</label>
          <input
            value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
            placeholder="e.g. Acme Corp"
            className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-ring"
          />
        </div>
        <button onClick={create} disabled={busy || !name.trim()}
          className="flex h-[34px] items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-50">
          <Plus size={15} /> Create
        </button>
      </div>
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr><th className="px-3 py-2 text-left">Name</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">Created</th><th className="px-3 py-2" /></tr>
          </thead>
          <tbody>
            {tenants.map((t) => (
              <tr key={t.id} className="border-t border-border">
                <td className="px-3 py-2 font-medium">{t.name}</td>
                <td className="px-3 py-2 text-muted-foreground">{t.status}</td>
                <td className="px-3 py-2 text-muted-foreground">{fmtDate(t.createdAt)}</td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => remove(t.id)} className="text-destructive/70 hover:text-destructive" title="Delete tenant"><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
            {tenants.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-[13px] text-muted-foreground">No tenants yet. A single-user deploy doesn't need any — create one to isolate keys per customer/team.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── API keys tab ─────────────────────────────────────────────────────
function KeysTab({ auth }: { auth: AuthIdentity }) {
  const [keys, setKeys] = useState<any[]>([]);
  const [tenants, setTenants] = useState<any[]>([]);
  const [form, setForm] = useState({ label: '', role: 'member', scope: 'full', tenantId: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api('/keys').then((d) => setKeys(d.keys || [])).catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    refresh();
    if (auth.isSuperadmin) api('/tenants').then((d) => setTenants(d.tenants || [])).catch(() => {});
  }, [refresh, auth.isSuperadmin]);

  const tenantName = (id: string | null) => id ? (tenants.find((t) => t.id === id)?.name || id.slice(0, 8)) : '—';

  const create = () => {
    if (!form.label.trim()) { setError('A label is required.'); return; }
    setBusy(true); setError(null);
    const body: any = { label: form.label.trim(), role: form.role, scope: form.scope };
    if (auth.isSuperadmin && form.tenantId) body.tenantId = form.tenantId;
    api('/keys', { method: 'POST', body: JSON.stringify(body) })
      .then((d) => { setNewKey(d.key.key); setForm({ label: '', role: 'member', scope: 'full', tenantId: '' }); refresh(); })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };
  const revoke = (id: string) => {
    if (!confirm('Revoke this key? Any caller using it will immediately lose access.')) return;
    api(`/keys/${id}`, { method: 'DELETE' }).then(refresh).catch((e) => setError(e.message));
  };

  return (
    <div>
      <ErrorBar error={error} onDismiss={() => setError(null)} />

      {newKey && (
        <div className="mb-4 rounded-xl border border-success/40 bg-success/10 p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-success">
            <CircleCheck size={15} /> Key created — copy it now. It won't be shown again.
          </div>
          <div className="flex items-stretch gap-1.5">
            <code className="min-w-0 flex-1 select-all overflow-x-auto rounded-lg border border-border bg-background px-2 py-1.5 font-mono text-[12px]">{newKey}</code>
            <CopyButton value={newKey} />
          </div>
          <button onClick={() => setNewKey(null)} className="mt-2 text-[12px] text-muted-foreground hover:text-foreground">Dismiss</button>
        </div>
      )}

      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Label</label>
          <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. CI pipeline"
            className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-ring" />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Role</label>
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
            className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-ring">
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Scope</label>
          <select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}
            className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-ring">
            {SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <button onClick={create} disabled={busy}
          className="flex h-[34px] items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-50">
          <Plus size={15} /> Create key
        </button>
      </div>
      {auth.isSuperadmin && (
        <div className="mb-4 -mt-2">
          <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Tenant (optional)</label>
          <select value={form.tenantId} onChange={(e) => setForm({ ...form, tenantId: e.target.value })}
            className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-ring">
            <option value="">— no tenant (global) —</option>
            {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Label</th>
              <th className="px-3 py-2 text-left">Key</th>
              <th className="px-3 py-2 text-left">Role</th>
              {auth.isSuperadmin && <th className="px-3 py-2 text-left">Tenant</th>}
              <th className="px-3 py-2 text-left">Last used</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} className={`border-t border-border ${k.revoked ? 'opacity-50' : ''}`}>
                <td className="px-3 py-2 font-medium">{k.label}</td>
                <td className="px-3 py-2 font-mono text-[12px] text-muted-foreground">{k.keyPrefix}</td>
                <td className="px-3 py-2"><RoleBadge role={k.role} /></td>
                {auth.isSuperadmin && <td className="px-3 py-2 text-muted-foreground">{tenantName(k.tenantId)}</td>}
                <td className="px-3 py-2 text-muted-foreground">{k.revoked ? <span className="text-destructive">revoked</span> : fmtDate(k.lastUsed)}</td>
                <td className="px-3 py-2 text-right">
                  {!k.revoked && <button onClick={() => revoke(k.id)} className="text-destructive/70 hover:text-destructive" title="Revoke key"><Trash2 size={14} /></button>}
                </td>
              </tr>
            ))}
            {keys.length === 0 && (
              <tr><td colSpan={auth.isSuperadmin ? 6 : 5} className="px-3 py-6 text-center text-[13px] text-muted-foreground">No API keys yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Members tab ──────────────────────────────────────────────────────
function MembersTab({ auth }: { auth: AuthIdentity }) {
  const [users, setUsers] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    api('/users').then((d) => setUsers(d.users || [])).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const setRole = (id: string, role: string) => {
    api(`/users/${id}`, { method: 'PATCH', body: JSON.stringify({ role }) }).then(refresh).catch((e) => setError(e.message));
  };

  return (
    <div>
      <ErrorBar error={error} onDismiss={() => setError(null)} />
      <p className="mb-3 text-[12.5px] text-muted-foreground">Users are provisioned automatically on their first SSO sign-in. Adjust their role here.</p>
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr><th className="px-3 py-2 text-left">Email</th><th className="px-3 py-2 text-left">Role</th><th className="px-3 py-2 text-left">Last login</th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-border">
                <td className="px-3 py-2 font-medium">{u.email}</td>
                <td className="px-3 py-2">
                  <select value={u.role} onChange={(e) => setRole(u.id, e.target.value)}
                    className="rounded-md border border-border bg-background px-1.5 py-1 text-[12.5px] outline-none focus:border-ring">
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{fmtDate(u.lastLogin)}</td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={3} className="px-3 py-6 text-center text-[13px] text-muted-foreground">No SSO users yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Observability tab ────────────────────────────────────────────────
function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
function ObservabilityTab() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    api('/observability').then(setData).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const t = data?.totals || { sessions: 0, toolCalls: 0, tokens: 0, cost: 0 };
  return (
    <div>
      <ErrorBar error={error} onDismiss={() => setError(null)} />
      <div className="mb-4 flex items-center justify-between">
        <p className="text-[12.5px] text-muted-foreground">Usage aggregated from session metrics{data?.scope === 'all' ? ' across all tenants' : ''}.</p>
        <button onClick={refresh} className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[12px] text-muted-foreground hover:bg-muted"><RefreshCw size={12} /> Refresh</button>
      </div>
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Sessions" value={t.sessions} />
        <Stat label="Tool calls" value={t.toolCalls} />
        <Stat label="Tokens" value={(t.tokens || 0).toLocaleString()} />
        <Stat label="Cost" value={`$${(t.cost || 0).toFixed(4)}`} />
      </div>
      {data?.counts && (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Tenants" value={data.counts.tenants} />
          <Stat label="Active keys" value={data.counts.apiKeys} />
          <Stat label="Revoked keys" value={data.counts.apiKeysRevoked} />
          <Stat label="Devices" value={data.counts.devices} />
        </div>
      )}
      <h3 className="mb-2 text-sm font-semibold">Usage by tenant</h3>
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr><th className="px-3 py-2 text-left">Tenant</th><th className="px-3 py-2 text-right">Sessions</th><th className="px-3 py-2 text-right">Tool calls</th><th className="px-3 py-2 text-right">Tokens</th><th className="px-3 py-2 text-right">Cost</th></tr>
          </thead>
          <tbody>
            {(data?.byTenant || []).map((b: any, i: number) => (
              <tr key={i} className="border-t border-border">
                <td className="px-3 py-2">{b.tenantId || <span className="text-muted-foreground">untagged</span>}</td>
                <td className="px-3 py-2 text-right tabular-nums">{b.sessions}</td>
                <td className="px-3 py-2 text-right tabular-nums">{b.toolCalls}</td>
                <td className="px-3 py-2 text-right tabular-nums">{(b.tokens || 0).toLocaleString()}</td>
                <td className="px-3 py-2 text-right tabular-nums">${(b.cost || 0).toFixed(4)}</td>
              </tr>
            ))}
            {(!data?.byTenant || data.byTenant.length === 0) && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-[13px] text-muted-foreground">No usage recorded yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── SSO tab ──────────────────────────────────────────────────────────
function SsoTab() {
  const [sso, setSso] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => {
    api('/sso').then((d) => setSso(d.sso)).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const toggle = (enabled: boolean) => {
    setBusy(true); setError(null);
    api('/sso', { method: 'PUT', body: JSON.stringify({ enabled }) })
      .then(refresh).catch((e) => setError(e.message)).finally(() => setBusy(false));
  };

  if (!sso) return <ErrorBar error={error} onDismiss={() => setError(null)} />;
  const envRows: [string, boolean | string][] = Object.entries(sso.env || {}) as any;

  return (
    <div>
      <ErrorBar error={error} onDismiss={() => setError(null)} />
      <div className="mb-4 flex items-center justify-between rounded-xl border border-border bg-card p-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            Enterprise SSO (OIDC)
            {sso.enabled
              ? <span className="flex items-center gap-1 text-[12px] font-medium text-success"><CircleCheck size={13} /> enabled</span>
              : <span className="flex items-center gap-1 text-[12px] font-medium text-muted-foreground"><CircleSlash size={13} /> disabled</span>}
          </div>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            {sso.configured ? 'OIDC credentials detected in the environment.' : 'Set the OIDC_* environment variables to enable.'}
          </p>
        </div>
        <button
          onClick={() => toggle(!sso.enabled)}
          disabled={busy || (!sso.configured && !sso.enabled)}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${sso.enabled ? 'border border-border hover:bg-muted' : 'bg-primary text-primary-foreground hover:bg-primary/80'}`}
        >
          {sso.enabled ? 'Disable' : 'Enable'}
        </button>
      </div>

      <div className="mb-4 rounded-xl border border-border p-4">
        <div className="mb-1.5 text-[12px] font-semibold">Redirect URI — register this with your IdP</div>
        <div className="flex items-stretch gap-1.5">
          <code className="min-w-0 flex-1 select-all overflow-x-auto rounded-lg border border-border bg-muted/50 px-2 py-1.5 font-mono text-[12px]">{sso.redirectUri}</code>
          <CopyButton value={sso.redirectUri} />
        </div>
        {sso.issuer && <div className="mt-2 text-[12px] text-muted-foreground">Issuer: <span className="font-mono">{sso.issuer}</span></div>}
      </div>

      <h3 className="mb-2 text-sm font-semibold">Environment</h3>
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <tbody>
            {envRows.map(([k, v]) => (
              <tr key={k} className="border-t border-border first:border-t-0">
                <td className="px-3 py-2 font-mono text-[12.5px]">{k}</td>
                <td className="px-3 py-2 text-right">
                  {typeof v === 'boolean'
                    ? (v ? <span className="flex items-center justify-end gap-1 text-[12px] text-success"><CircleCheck size={13} /> set</span>
                         : <span className="flex items-center justify-end gap-1 text-[12px] text-muted-foreground"><CircleSlash size={13} /> not set</span>)
                    : <span className="font-mono text-[12px] text-muted-foreground">{v}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── AdminView shell ──────────────────────────────────────────────────
type TabId = 'tenants' | 'keys' | 'members' | 'observability' | 'sso';

/**
 * AdminView — the Admin console (rail destination). Multi-tenant API keys, RBAC,
 * per-tenant observability, and the enterprise SSO toggle. Tabs are gated by the
 * caller's role: superadmin sees Tenants + SSO; every admin sees Keys / Members /
 * Observability.
 */
export default function AdminView({ auth }: { auth: AuthIdentity }) {
  const tabs = useMemo(() => {
    const t: { id: TabId; label: string; icon: React.ComponentType<{ size?: number }> }[] = [];
    if (auth.isSuperadmin) t.push({ id: 'tenants', label: 'Tenants', icon: Building2 });
    t.push({ id: 'keys', label: 'API Keys', icon: KeyRound });
    t.push({ id: 'members', label: 'Members', icon: Users });
    t.push({ id: 'observability', label: 'Observability', icon: Activity });
    if (auth.isSuperadmin) t.push({ id: 'sso', label: 'SSO', icon: ShieldCheck });
    return t;
  }, [auth.isSuperadmin]);

  const [tab, setTab] = useState<TabId>(tabs[0].id);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[960px] px-7 py-7">
        <h2 className="text-lg font-semibold">Admin</h2>
        <p className="mb-5 mt-0.5 text-[13px] text-muted-foreground">
          Multi-tenant access control, API keys, usage and enterprise sign-in.
          {auth.devMode && ' Running in local dev-mode — set ORBIT_SUPERADMIN_KEY to lock this down.'}
        </p>

        <div className="mb-5 flex flex-wrap gap-1 border-b border-border">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-[13px] font-medium transition-colors ${
                tab === id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>

        {tab === 'tenants' && <TenantsTab />}
        {tab === 'keys' && <KeysTab auth={auth} />}
        {tab === 'members' && <MembersTab auth={auth} />}
        {tab === 'observability' && <ObservabilityTab />}
        {tab === 'sso' && <SsoTab />}
      </div>
    </div>
  );
}
