// @ts-nocheck
"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Settings, KeyRound, ShieldAlert, Smartphone, Plus, Trash2, Edit3, Zap, Copy, X, Sun, Moon, Check } from "lucide-react";
import { useDevices } from "@/hooks/useDevices";
import { useTheme } from "@/hooks/useTheme";

const AGENT_MODES = [
  { id: "plan", label: "Plan", desc: "Plan then approve", icon: ShieldAlert, color: "text-chart-3" },
  { id: "edit", label: "Edit", desc: "Read free, write needs ok", icon: Edit3, color: "text-warning" },
  { id: "yolo", label: "YOLO", desc: "Full autonomy", icon: Zap, color: "text-destructive" },
];

function FieldLabel({ children }) {
  return <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{children}</label>;
}

/** SectionCard — one settled topic per raised card; keeps the page scannable
    and stops fields from stretching across the full console width. */
function SectionCard({ title, desc, children }) {
  return (
    <section className="raised rounded-2xl border border-border-soft bg-card p-5">
      {title && (
        <div className="mb-4">
          <h3 className="text-[13px] font-bold text-foreground">{title}</h3>
          {desc && <p className="mt-0.5 text-[11px] leading-relaxed text-faint">{desc}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

function ToggleRow({ label, checked, onCheckedChange }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-border bg-muted/20 p-3">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function TagList({ items, onRemove, tone = "default" }) {
  const toneClass = tone === "success" ? "border-success/30 bg-success/10 text-success" : "border-primary/30 bg-primary/10 text-primary";
  return (
    <div className="my-2 flex flex-wrap gap-1.5">
      {items.map((p, i) => (
        <span key={i} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${toneClass}`}>
          {p}
          <button onClick={() => onRemove(i)} className="text-destructive font-bold hover:scale-110 transition-transform">×</button>
        </span>
      ))}
    </div>
  );
}

function PathList({ items, onRemove, danger }) {
  return (
    <div className="my-2 flex flex-col gap-1">
      {items.map((p, i) => (
        <div
          key={i}
          className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs ${
            danger ? "border border-destructive/15 bg-destructive/5 text-destructive" : "border border-border bg-muted/20"
          }`}
        >
          <span className="max-w-[85%] overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px]">{p}</span>
          <Trash2 size={13} onClick={() => onRemove(i)} className="shrink-0 cursor-pointer text-destructive hover:scale-105 transition-transform" />
        </div>
      ))}
    </div>
  );
}

function AddRow({ value, onChange, placeholder, onAdd }) {
  return (
    <div className="flex gap-1.5">
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-8 flex-1 text-xs" />
      <Button onClick={onAdd} variant="outline" size="sm" className="h-8 px-2.5">
        <Plus size={13} />
      </Button>
    </div>
  );
}

function AppearanceSection() {
  const { theme, mounted, setTheme, setPalette, palettes } = useTheme();
  if (!mounted) return null;

  const MODES = [
    { id: "light", label: "Light", icon: Sun },
    { id: "dark", label: "Dark", icon: Moon },
  ];

  return (
    <div>
      <div className="mb-3 inline-flex rounded-xl border border-border bg-muted/20 p-1 gap-1">
        {MODES.map((m) => {
          const Icon = m.icon;
          const isActive = theme.mode === m.id;
          return (
            <button
              key={m.id}
              onClick={() => setTheme(m.id)}
              className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all duration-150 ${
                isActive ? "bg-card text-foreground shadow-sm" : "text-faint hover:text-foreground"
              }`}
            >
              <Icon size={13} />
              {m.label}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
        {palettes.map((p) => {
          const isActive = theme.palette === p.id;
          return (
            <button
              key={p.id}
              onClick={() => setPalette(p.id)}
              className={`group relative rounded-xl border p-2.5 text-left transition-all duration-150 ${
                isActive
                  ? "border-primary/60 bg-accent shadow-sm"
                  : "border-border bg-muted/10 hover:bg-muted/30 hover:border-border"
              }`}
            >
              {isActive && (
                <span className="absolute right-2 top-2 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check size={11} strokeWidth={3} />
                </span>
              )}
              <div className="flex h-10 w-full overflow-hidden rounded-lg border border-border-soft">
                <div className="flex flex-1 items-center justify-center" style={{ background: p.light.bg }}>
                  <span className="h-4 w-4 rounded-full border border-black/10" style={{ background: p.light.accent }} />
                </div>
                <div className="flex flex-1 items-center justify-center" style={{ background: p.dark.bg }}>
                  <span className="h-4 w-4 rounded-full border border-white/15" style={{ background: p.dark.accent }} />
                </div>
              </div>
              <div className="mt-2 text-[12px] font-bold text-foreground">{p.label}</div>
              <div className="mt-0.5 text-[10px] leading-snug text-faint">{p.tagline}</div>
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
        Each palette has a matched light and dark half — the mode toggle switches between them. Saved on this device.
      </p>
    </div>
  );
}

export default function SettingsPanel({
  settings,
  onSettingsChange,
  securityConfig,
  setSecurityConfig,
  systemPromptType,
  setSystemPromptType,
  voiceResponse,
  setVoiceResponse,
  ttsAvailable,
  models,
  voices,
  onSave,
  saveState,
  onManualCompact,
  onAddConfigItem,
  onRemoveConfigItem,
  sessionMode,
  onSetSessionMode,
  uiConfig,
  onUiConfigChange,
}) {
  const { devices, pairing, startPairing, clearPairing, revokeDevice } = useDevices();
  const [newDeviceLabel, setNewDeviceLabel] = useState("");
  const [activeTab, setActiveTab] = useState("general");

  const SECTIONS = [
    { id: "general", label: "General", icon: Settings },
    { id: "keys", label: "Keys & Providers", icon: KeyRound },
    { id: "security", label: "Security Policies", icon: ShieldAlert },
    { id: "devices", label: "Paired Devices", icon: Smartphone },
  ];

  const handleKeyChange = (keyName: string, value: string) => {
    const updated = { ...(securityConfig || {}) };
    if (!updated.keys) updated.keys = {};
    updated.keys[keyName] = value;
    setSecurityConfig(updated);
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background md:flex-row">
      {/* ── Desktop section rail ── */}
      <aside className="hidden w-[230px] shrink-0 flex-col gap-1 border-r border-border-soft bg-sidebar p-4 md:flex">
        <div className="mb-2 px-3 py-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Settings</h2>
        </div>
        {SECTIONS.map((sec) => {
          const Icon = sec.icon;
          const isActive = activeTab === sec.id;
          return (
            <button
              key={sec.id}
              onClick={() => setActiveTab(sec.id)}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-xs font-bold transition-all duration-150 ${
                isActive
                  ? "bg-accent text-accent-foreground shadow-sm"
                  : "text-faint hover:text-foreground hover:bg-muted/40"
              }`}
            >
              <Icon size={14} className="shrink-0" />
              {sec.label}
            </button>
          );
        })}
      </aside>

      {/* ── Mobile section tabs ── */}
      <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-border-soft bg-sidebar px-3 py-2.5 md:hidden">
        {SECTIONS.map((sec) => {
          const Icon = sec.icon;
          const isActive = activeTab === sec.id;
          return (
            <button
              key={sec.id}
              onClick={() => setActiveTab(sec.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-bold transition-colors ${
                isActive
                  ? "border-primary/40 bg-accent text-accent-foreground"
                  : "border-border bg-muted/10 text-faint"
              }`}
            >
              <Icon size={13} />
              {sec.label}
            </button>
          );
        })}
      </div>

      {/* ── Content: centered column of section cards ── */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-4 py-6 md:px-8">
          {/* ── GENERAL ── */}
          {activeTab === "general" && (
            <div className="flex flex-col gap-4 animate-fade-in">
              <SectionCard title="Appearance" desc="Pick a palette and mode. Every theme is tuned for both halves.">
                <AppearanceSection />
              </SectionCard>

              <SectionCard title="Dashboard" desc="How much of the console is visible.">
                <ToggleRow
                  label="SIMPLE VIEW MODE"
                  checked={uiConfig?.viewMode === "simple"}
                  onCheckedChange={(checked) => {
                    if (onUiConfigChange) {
                      onUiConfigChange({
                        ...uiConfig,
                        viewMode: checked ? "simple" : "advanced"
                      });
                    }
                  }}
                />
                <p className="mt-1 text-[11px] leading-relaxed text-faint">
                  Simple mode displays a clean chat-focused view with only the Preview pane visible in the inspector.
                </p>
              </SectionCard>

              <SectionCard title="Models" desc="Two models power every turn. The composer's Effort chip picks which one runs per message.">
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <FieldLabel>Response Model</FieldLabel>
                      <Select value={settings.selectedNormalModel} onValueChange={(v) => onSettingsChange({ selectedNormalModel: v })}>
                        <SelectTrigger className="h-9 w-full text-sm"><SelectValue placeholder="Select model" /></SelectTrigger>
                        <SelectContent>
                          {models.length > 0 ? (
                            models.map((m) => <SelectItem key={m.id} value={m.id}>{m.id}</SelectItem>)
                          ) : (
                            <SelectItem value="loading" disabled>No models loaded</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                      <p className="mt-1 text-[11px] leading-relaxed text-faint">
                        Fast output — chat, Q&amp;A, quick lookups.
                      </p>
                    </div>
                    <div>
                      <FieldLabel>Reasoning Model</FieldLabel>
                      <Select value={settings.selectedReasoningModel} onValueChange={(v) => onSettingsChange({ selectedReasoningModel: v })}>
                        <SelectTrigger className="h-9 w-full text-sm"><SelectValue placeholder="Select model" /></SelectTrigger>
                        <SelectContent>
                          {models.length > 0 ? (
                            models.map((m) => <SelectItem key={m.id} value={m.id}>{m.id}</SelectItem>)
                          ) : (
                            <SelectItem value="loading" disabled>No models loaded</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                      <p className="mt-1 text-[11px] leading-relaxed text-faint">
                        Reasoned output — used when Effort is set to Reasoned.
                      </p>
                    </div>
                  </div>

                  <div className="md:w-1/2 md:pr-2">
                    <FieldLabel>System Prompt Directives</FieldLabel>
                    <Select value={systemPromptType} onValueChange={setSystemPromptType}>
                      <SelectTrigger className="h-9 w-full text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="standard">Standard PA Prompt</SelectItem>
                        <SelectItem value="fable-5">Claude Fable 5 Leak Prompt</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="Voice" desc="Text-to-speech output for agent replies.">
                {ttsAvailable ? (
                  <div className="grid grid-cols-1 items-center gap-4 md:grid-cols-2">
                    <div>
                      <FieldLabel>Local TTS Voice</FieldLabel>
                      <Select value={settings.selectedVoice} onValueChange={(v) => onSettingsChange({ selectedVoice: v })}>
                        <SelectTrigger className="h-9 w-full text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {voices.length > 0 ? (
                            voices.map((v) => <SelectItem key={v.id} value={v.id}>{v.display_name || v.id}</SelectItem>)
                          ) : (
                            <SelectItem value="alba">alba (Default)</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="pt-5">
                      <ToggleRow label="Voice Responses (TTS)" checked={voiceResponse} onCheckedChange={setVoiceResponse} />
                    </div>
                  </div>
                ) : (
                  <p className="rounded-lg border border-border-soft bg-muted/20 px-3 py-2 text-[11px] leading-relaxed text-faint">
                    Voice output is off — no TTS backend configured. Set <code>LOCAL_TTS_URL</code> + <code>LOCAL_TTS_KEY</code> in `.env` to enable.
                  </p>
                )}
              </SectionCard>

              <SectionCard title="Memory & Compaction" desc="When the session context is condensed to stay within limits.">
                <div className="flex flex-col gap-2.5">
                  <ToggleRow
                    label="AUTO COMPACTION"
                    checked={settings.autoCompactEnabled}
                    onCheckedChange={(v) => onSettingsChange({ autoCompactEnabled: v })}
                  />
                  <div className="flex items-center justify-between gap-4 px-1 py-2">
                    <span className="whitespace-nowrap text-[11px] font-semibold text-muted-foreground">COMPACTION THRESHOLD:</span>
                    <input
                      type="range"
                      min="30"
                      max="90"
                      step="5"
                      value={settings.autoCompactThreshold}
                      onChange={(e) => onSettingsChange({ autoCompactThreshold: parseInt(e.target.value) })}
                      disabled={!settings.autoCompactEnabled}
                      className="h-1 flex-1 cursor-pointer rounded-lg accent-primary"
                    />
                    <span className="w-[40px] text-right text-xs font-bold text-foreground">{settings.autoCompactThreshold}%</span>
                  </div>
                  <Button variant="outline" onClick={onManualCompact} className="w-full">
                    Compact Memory Now
                  </Button>
                </div>
              </SectionCard>

              <SectionCard title="Security Mode" desc="How much autonomy the agent gets this session.">
                <div className="flex gap-2.5">
                  {AGENT_MODES.map((mode) => {
                    const isActive = sessionMode === mode.id;
                    return (
                      <button
                        key={mode.id}
                        onClick={() => onSetSessionMode(mode.id)}
                        className={`flex-1 rounded-xl border p-3 text-center transition-all duration-150 ${
                          isActive ? `border-current bg-accent shadow-sm ${mode.color}` : "border-border bg-muted/10 text-muted-foreground hover:bg-muted/40"
                        }`}
                      >
                        <mode.icon size={16} className="mx-auto mb-1" />
                        <div className={`text-[12px] ${isActive ? "font-bold" : "font-medium"}`}>{mode.label}</div>
                        <div className="mt-0.5 text-[9px] leading-relaxed opacity-70">{mode.desc}</div>
                      </button>
                    );
                  })}
                </div>
              </SectionCard>
            </div>
          )}

          {/* ── KEYS & PROVIDERS ── */}
          {activeTab === "keys" && (
            <div className="flex flex-col gap-4 animate-fade-in">
              <SectionCard title="LLM Provider" desc="OpenAI-compatible endpoint the agent runs against (LiteLLM works).">
                <div className="flex flex-col gap-4">
                  <div>
                    <FieldLabel>LLM Base Endpoint</FieldLabel>
                    <Input value={settings.baseURL} onChange={(e) => onSettingsChange({ baseURL: e.target.value })} className="h-9 text-sm font-mono" placeholder="http://localhost:4000/v1" />
                  </div>
                  <div>
                    <FieldLabel>LLM API Key</FieldLabel>
                    <Input type="password" value={settings.apiKey} onChange={(e) => onSettingsChange({ apiKey: e.target.value })} className="h-9 text-sm font-mono" placeholder="sk-..." />
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="Local TTS" desc="Optional speech backend for voice replies.">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <FieldLabel>Local TTS URL</FieldLabel>
                    <Input value={settings.ttsURL} onChange={(e) => onSettingsChange({ ttsURL: e.target.value })} className="h-9 text-sm font-mono" placeholder="http://127.0.0.1:6767" />
                  </div>
                  <div>
                    <FieldLabel>Local TTS Key</FieldLabel>
                    <Input type="password" value={settings.ttsKey} onChange={(e) => onSettingsChange({ ttsKey: e.target.value })} className="h-9 text-sm font-mono" placeholder="tts-key..." />
                  </div>
                </div>
              </SectionCard>
            </div>
          )}

          {/* ── SECURITY POLICIES ── */}
          {activeTab === "security" && (
            <div className="flex flex-col gap-4 animate-fade-in">
              <SectionCard title="Approvals & Web Access" desc="Human-in-the-loop gates and browser fallbacks.">
                <div className="flex flex-col gap-3">
                  <ToggleRow
                    label="REQUIRE APPROVAL (HITL)"
                    checked={securityConfig?.shellCommands?.requireApproval ?? true}
                    onCheckedChange={(checked) => {
                      const updated = { ...securityConfig };
                      if (!updated.shellCommands) updated.shellCommands = {};
                      updated.shellCommands.requireApproval = checked;
                      setSecurityConfig(updated);
                    }}
                  />
                  <div>
                    <ToggleRow
                      label="WEB ACCESS EXTENSION (FALLBACK)"
                      checked={securityConfig?.webAccess?.enabled ?? false}
                      onCheckedChange={(checked) => {
                        const updated = { ...(securityConfig || {}) };
                        updated.webAccess = { ...(updated.webAccess || {}), enabled: checked };
                        setSecurityConfig(updated);
                      }}
                    />
                    <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
                      Lightpanda browser is the default. Enabling this grants native web tools as fallbacks.
                    </p>
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="Shell Commands" desc="What the agent may run, and what runs without asking.">
                <div className="flex flex-col gap-3">
                  <div>
                    <span className="block text-[11px] font-bold text-muted-foreground">Allowed Utilities List:</span>
                    <TagList items={securityConfig?.shellCommands?.allowedPrefixes || []} onRemove={(i) => onRemoveConfigItem("shellCommands", "allowedPrefixes", i)} />
                    <AddRow
                      value={settings.newAllowedPrefix}
                      onChange={(v) => onSettingsChange({ newAllowedPrefix: v })}
                      placeholder="e.g. git"
                      onAdd={() => onAddConfigItem("shellCommands", "allowedPrefixes", settings.newAllowedPrefix, "newAllowedPrefix")}
                    />
                  </div>
                  <div>
                    <span className="block text-[11px] font-bold text-muted-foreground">Auto-Approve Commands:</span>
                    <TagList items={securityConfig?.shellCommands?.autoApprove || []} onRemove={(i) => onRemoveConfigItem("shellCommands", "autoApprove", i)} tone="success" />
                    <AddRow
                      value={settings.newAutoApprove}
                      onChange={(v) => onSettingsChange({ newAutoApprove: v })}
                      placeholder="e.g. ls"
                      onAdd={() => onAddConfigItem("shellCommands", "autoApprove", settings.newAutoApprove, "newAutoApprove")}
                    />
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="File System" desc="Where the agent may read and write. Blocks win over grants.">
                <div className="flex flex-col gap-3">
                  <div>
                    <span className="block text-[11px] font-bold text-muted-foreground">Allowed Read Directories:</span>
                    <PathList items={securityConfig?.fileSystem?.allowedReadPaths || []} onRemove={(i) => onRemoveConfigItem("fileSystem", "allowedReadPaths", i)} />
                    <AddRow
                      value={settings.newReadPath}
                      onChange={(v) => onSettingsChange({ newReadPath: v })}
                      placeholder="/absolute/path"
                      onAdd={() => onAddConfigItem("fileSystem", "allowedReadPaths", settings.newReadPath, "newReadPath")}
                    />
                  </div>
                  <div>
                    <span className="block text-[11px] font-bold text-muted-foreground">Extra Write Directories:</span>
                    <PathList items={securityConfig?.fileSystem?.allowedWritePaths || []} onRemove={(i) => onRemoveConfigItem("fileSystem", "allowedWritePaths", i)} />
                    <AddRow
                      value={settings.newWritePath}
                      onChange={(v) => onSettingsChange({ newWritePath: v })}
                      placeholder="/absolute/path"
                      onAdd={() => onAddConfigItem("fileSystem", "allowedWritePaths", settings.newWritePath, "newWritePath")}
                    />
                  </div>
                  <div>
                    <span className="block text-[11px] font-bold text-muted-foreground">Write-Protected Directories (Hard Block):</span>
                    <PathList items={securityConfig?.fileSystem?.writeBlockedPaths || []} onRemove={(i) => onRemoveConfigItem("fileSystem", "writeBlockedPaths", i)} danger />
                    <AddRow
                      value={settings.newWriteBlockedPath}
                      onChange={(v) => onSettingsChange({ newWriteBlockedPath: v })}
                      placeholder="/absolute/path"
                      onAdd={() => onAddConfigItem("fileSystem", "writeBlockedPaths", settings.newWriteBlockedPath, "newWriteBlockedPath")}
                    />
                  </div>
                </div>
              </SectionCard>
            </div>
          )}

          {/* ── PAIRED DEVICES ── */}
          {activeTab === "devices" && (
            <div className="flex flex-col gap-4 animate-fade-in">
              <SectionCard title="Paired Devices" desc="Phones and consoles authorized to drive this Orbit.">
                <div className="flex flex-col gap-2">
                  {devices.filter(d => !d.revoked).length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border bg-muted/5 p-3 text-center text-xs italic text-muted-foreground">No paired devices found.</div>
                  ) : (
                    devices.filter(d => !d.revoked).map((d) => (
                      <div key={d.id} className="flex items-center justify-between rounded-xl border border-border bg-muted/20 p-3">
                        <div className="flex flex-col gap-0.5 overflow-hidden">
                          <span className="text-[12px] font-semibold">
                            {d.label}
                          </span>
                          <span className="text-[10px] text-faint">
                            {d.lastSeen ? `Last seen ${new Date(d.lastSeen).toLocaleString()}` : "Never connected"}
                          </span>
                        </div>
                        <Trash2 size={13} onClick={() => revokeDevice(d.id)} className="shrink-0 cursor-pointer text-destructive hover:scale-105 transition-transform" />
                      </div>
                    ))
                  )}
                </div>
              </SectionCard>

              <SectionCard title="Pair a New Device" desc="Generates a one-time code to scan or paste on the other device.">
                {pairing ? (
                  <div className="flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-primary">Device Pairing Code</span>
                      <X size={13} onClick={clearPairing} className="cursor-pointer text-muted-foreground hover:scale-105" />
                    </div>
                    <div className="rounded-lg border border-primary/10 bg-background py-2 text-center font-mono text-[22px] font-bold tracking-[0.2em] text-primary">{pairing.code}</div>
                    <div className="flex gap-1.5">
                      <Input readOnly value={pairing.pairingUrl} className="h-8 flex-1 text-xs font-mono" />
                      <Button variant="outline" size="sm" className="h-8 px-2.5" onClick={() => navigator.clipboard?.writeText(pairing.pairingUrl)}>
                        <Copy size={13} />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <AddRow value={newDeviceLabel} onChange={setNewDeviceLabel} placeholder="Device name, e.g. Phone" onAdd={() => startPairing(newDeviceLabel)} />
                )}
              </SectionCard>
            </div>
          )}

          {/* ── Save bar — frosted, floats over the cards while scrolling ── */}
          {activeTab !== "devices" && (
            <div className="glass sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-xl border border-border p-3">
              <span
                className={`text-[11px] ${
                  saveState?.status === "saved"
                    ? "text-emerald-500"
                    : saveState?.status === "error"
                      ? "text-red-500"
                      : "text-faint"
                }`}
              >
                {saveState?.status === "saving"
                  ? "Saving…"
                  : saveState?.status === "saved"
                    ? saveState.message || "Settings saved."
                    : saveState?.status === "error"
                      ? saveState.message || "Save failed."
                      : "Changes apply after saving."}
              </span>
              <Button
                onClick={onSave}
                disabled={saveState?.status === "saving"}
                className="h-9 w-full px-6 font-bold sm:w-auto"
              >
                {saveState?.status === "saving" ? (
                  "Saving…"
                ) : saveState?.status === "saved" ? (
                  <span className="flex items-center gap-1.5">
                    <Check size={15} /> Saved
                  </span>
                ) : (
                  "Save Settings & Policies"
                )}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
