// @ts-nocheck
"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Settings, KeyRound, ShieldAlert, Smartphone, Plus, Trash2, Edit3, Zap, Copy, X } from "lucide-react";
import { useDevices } from "@/hooks/useDevices";

const AGENT_MODES = [
  { id: "plan", label: "Plan", desc: "Plan then approve", icon: ShieldAlert, color: "text-chart-3" },
  { id: "edit", label: "Edit", desc: "Read free, write needs ok", icon: Edit3, color: "text-warning" },
  { id: "yolo", label: "YOLO", desc: "Full autonomy", icon: Zap, color: "text-destructive" },
];

function FieldLabel({ children }) {
  return <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{children}</label>;
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
    { id: "general", label: "General Settings", icon: Settings },
    { id: "keys", label: "Key Manager", icon: KeyRound },
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
    <div className="flex h-full w-full flex-col md:flex-row overflow-hidden bg-background">
      {/* Left Column Navigation */}
      <div className="flex flex-col w-full md:w-[220px] shrink-0 gap-1 bg-muted/10 border-b md:border-b-0 md:border-r border-border p-5">
        <div className="px-3 py-2 mb-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">System Settings</h2>
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
      </div>

      {/* Right Column Content */}
      <div className="flex-grow flex flex-col justify-between overflow-hidden bg-background">
        <div className="flex-1 overflow-y-auto p-6 md:p-8 w-full flex flex-col gap-5">
          {/* ── GENERAL SETTINGS ── */}
          {activeTab === "general" && (
            <div className="flex flex-col gap-4 animate-fade-in">
              <div>
                <FieldLabel>Dashboard View Mode</FieldLabel>
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
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <FieldLabel>Normal Execution Model</FieldLabel>
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
                </div>
                <div>
                  <FieldLabel>Reasoning Planner Model</FieldLabel>
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
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <FieldLabel>Agent Thinking Mode</FieldLabel>
                  <Select value={settings.taskMode} onValueChange={(v) => onSettingsChange({ taskMode: v })}>
                    <SelectTrigger className="h-9 w-full text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="normal">Normal Model Only (Fast)</SelectItem>
                      <SelectItem value="reasoning">Reasoning Model Only (Deep)</SelectItem>
                      <SelectItem value="hybrid">Hybrid Orchestrator (Plan + Exec)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
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

              {ttsAvailable ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
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

              <div className="border-t border-border-soft pt-4 flex flex-col gap-2.5">
                <FieldLabel>Memory &amp; Compaction</FieldLabel>
                <ToggleRow
                  label="AUTO COMPACTION"
                  checked={settings.autoCompactEnabled}
                  onCheckedChange={(v) => onSettingsChange({ autoCompactEnabled: v })}
                />
                <div className="px-1 py-2 flex items-center justify-between gap-4">
                  <span className="text-[11px] font-semibold text-muted-foreground whitespace-nowrap">COMPACTION THRESHOLD:</span>
                  <input
                    type="range"
                    min="30"
                    max="90"
                    step="5"
                    value={settings.autoCompactThreshold}
                    onChange={(e) => onSettingsChange({ autoCompactThreshold: parseInt(e.target.value) })}
                    disabled={!settings.autoCompactEnabled}
                    className="flex-1 accent-primary h-1 rounded-lg cursor-pointer"
                  />
                  <span className="text-xs font-bold text-foreground w-[40px] text-right">{settings.autoCompactThreshold}%</span>
                </div>
                <Button variant="outline" onClick={onManualCompact} className="w-full">
                  Compact Memory Now
                </Button>
              </div>
            </div>
          )}

          {/* ── KEY MANAGER ── */}
          {activeTab === "keys" && (
            <div className="flex flex-col gap-4 animate-fade-in">
              <h3 className="text-sm font-bold text-foreground border-b border-border-soft pb-1.5">API &amp; Credentials Store</h3>
              
              <div>
                <FieldLabel>LiteLLM Base Endpoint</FieldLabel>
                <Input value={settings.baseURL} onChange={(e) => onSettingsChange({ baseURL: e.target.value })} className="h-9 text-sm font-mono" placeholder="http://localhost:4000/v1" />
              </div>
              
              <div>
                <FieldLabel>LiteLLM API Key</FieldLabel>
                <Input type="password" value={settings.apiKey} onChange={(e) => onSettingsChange({ apiKey: e.target.value })} className="h-9 text-sm font-mono" placeholder="sk-..." />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                <div>
                  <FieldLabel>Local TTS URL</FieldLabel>
                  <Input value={settings.ttsURL} onChange={(e) => onSettingsChange({ ttsURL: e.target.value })} className="h-9 text-sm font-mono" placeholder="http://127.0.0.1:6767" />
                </div>
                <div>
                  <FieldLabel>Local TTS Key</FieldLabel>
                  <Input type="password" value={settings.ttsKey} onChange={(e) => onSettingsChange({ ttsKey: e.target.value })} className="h-9 text-sm font-mono" placeholder="tts-key..." />
                </div>
              </div>
            </div>
          )}

          {/* ── SECURITY POLICIES ── */}
          {activeTab === "security" && (
            <div className="flex flex-col gap-4 animate-fade-in">
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

              <div className="border-t border-border-soft pt-4">
                <FieldLabel>Browser &amp; Web Access</FieldLabel>
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

              <div className="border-t border-border-soft pt-4 flex flex-col gap-3">
                <div>
                  <span className="text-[11px] font-bold text-muted-foreground block">Allowed Utilities List:</span>
                  <TagList items={securityConfig?.shellCommands?.allowedPrefixes || []} onRemove={(i) => onRemoveConfigItem("shellCommands", "allowedPrefixes", i)} />
                  <AddRow
                    value={settings.newAllowedPrefix}
                    onChange={(v) => onSettingsChange({ newAllowedPrefix: v })}
                    placeholder="e.g. git"
                    onAdd={() => onAddConfigItem("shellCommands", "allowedPrefixes", settings.newAllowedPrefix, "newAllowedPrefix")}
                  />
                </div>

                <div>
                  <span className="text-[11px] font-bold text-muted-foreground block">Auto-Approve Commands:</span>
                  <TagList items={securityConfig?.shellCommands?.autoApprove || []} onRemove={(i) => onRemoveConfigItem("shellCommands", "autoApprove", i)} tone="success" />
                  <AddRow
                    value={settings.newAutoApprove}
                    onChange={(v) => onSettingsChange({ newAutoApprove: v })}
                    placeholder="e.g. ls"
                    onAdd={() => onAddConfigItem("shellCommands", "autoApprove", settings.newAutoApprove, "newAutoApprove")}
                  />
                </div>

                <div>
                  <span className="text-[11px] font-bold text-muted-foreground block">Allowed Read Directories:</span>
                  <PathList items={securityConfig?.fileSystem?.allowedReadPaths || []} onRemove={(i) => onRemoveConfigItem("fileSystem", "allowedReadPaths", i)} />
                  <AddRow
                    value={settings.newReadPath}
                    onChange={(v) => onSettingsChange({ newReadPath: v })}
                    placeholder="/absolute/path"
                    onAdd={() => onAddConfigItem("fileSystem", "allowedReadPaths", settings.newReadPath, "newReadPath")}
                  />
                </div>

                <div>
                  <span className="text-[11px] font-bold text-muted-foreground block">Extra Write Directories:</span>
                  <PathList items={securityConfig?.fileSystem?.allowedWritePaths || []} onRemove={(i) => onRemoveConfigItem("fileSystem", "allowedWritePaths", i)} />
                  <AddRow
                    value={settings.newWritePath}
                    onChange={(v) => onSettingsChange({ newWritePath: v })}
                    placeholder="/absolute/path"
                    onAdd={() => onAddConfigItem("fileSystem", "allowedWritePaths", settings.newWritePath, "newWritePath")}
                  />
                </div>

                <div>
                  <span className="text-[11px] font-bold text-muted-foreground block">Write-Protected Directories (Hard Block):</span>
                  <PathList items={securityConfig?.fileSystem?.writeBlockedPaths || []} onRemove={(i) => onRemoveConfigItem("fileSystem", "writeBlockedPaths", i)} danger />
                  <AddRow
                    value={settings.newWriteBlockedPath}
                    onChange={(v) => onSettingsChange({ newWriteBlockedPath: v })}
                    placeholder="/absolute/path"
                    onAdd={() => onAddConfigItem("fileSystem", "writeBlockedPaths", settings.newWriteBlockedPath, "newWriteBlockedPath")}
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── PAIRED DEVICES ── */}
          {activeTab === "devices" && (
            <div className="flex flex-col gap-4 animate-fade-in">
              <h3 className="text-sm font-bold text-foreground border-b border-border-soft pb-1.5">Paired Devices List</h3>
              
              <div className="flex flex-col gap-2">
                {devices.filter(d => !d.revoked).length === 0 ? (
                  <div className="text-xs italic text-muted-foreground p-3 border border-dashed border-border rounded-xl text-center bg-muted/5">No paired devices found.</div>
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

              {pairing ? (
                <div className="flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 mt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-primary">Device Pairing Code</span>
                    <X size={13} onClick={clearPairing} className="cursor-pointer text-muted-foreground hover:scale-105" />
                  </div>
                  <div className="text-center font-mono text-[22px] font-bold tracking-[0.2em] text-primary py-2 bg-background rounded-lg border border-primary/10">{pairing.code}</div>
                  <div className="flex gap-1.5">
                    <Input readOnly value={pairing.pairingUrl} className="h-8 flex-1 text-xs font-mono" />
                    <Button variant="outline" size="sm" className="h-8 px-2.5" onClick={() => navigator.clipboard?.writeText(pairing.pairingUrl)}>
                      <Copy size={13} />
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 border-t border-border-soft pt-4">
                  <FieldLabel>Pair a New Device</FieldLabel>
                  <AddRow value={newDeviceLabel} onChange={setNewDeviceLabel} placeholder="Device name, e.g. Phone" onAdd={() => startPairing(newDeviceLabel)} />
                </div>
              )}
            </div>
          )}

          {/* ── AGENT MODES ── */}
          {activeTab === "general" && (
            <div className="border-t border-border-soft pt-4 flex flex-col gap-3">
              <FieldLabel>Active Security Mode</FieldLabel>
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
                      <div className="mt-0.5 text-[9px] opacity-70 leading-relaxed">{mode.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Global Save Button */}
        {activeTab !== "devices" && (
          <div className="mt-6 pt-4 pb-8 border-t border-border-soft flex justify-end pr-8">
            <Button onClick={onSave} className="w-full md:w-auto px-6 h-9 font-bold bg-primary text-primary-foreground hover:bg-primary/95 transition-all">
              Save Settings &amp; Policies
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
