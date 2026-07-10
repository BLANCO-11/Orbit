// @ts-nocheck
"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Plus, Trash2, Settings, Shield, Edit3, Zap, Smartphone, Copy, X } from "lucide-react";
import { useDevices } from "@/hooks/useDevices";

const AGENT_MODES = [
  { id: "plan", label: "Plan", desc: "Plan then approve", icon: Shield, color: "text-chart-3" },
  { id: "edit", label: "Edit", desc: "Read free, write needs ok", icon: Edit3, color: "text-warning" },
  { id: "yolo", label: "YOLO", desc: "Full autonomy", icon: Zap, color: "text-destructive" },
];

function SectionLabel({ children }) {
  return <div className="mt-2 mb-2 border-b border-border pb-2 text-[0.95rem] font-bold">{children}</div>;
}

function FieldLabel({ children }) {
  return <label className="mb-1 block text-xs font-semibold text-muted-foreground">{children}</label>;
}

function ToggleRow({ label, checked, onCheckedChange }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 p-2">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function TagList({ items, onRemove, tone = "default" }) {
  const toneClass = tone === "success" ? "border-success/30 bg-success/10 text-success" : "border-primary/30 bg-primary/10 text-primary";
  return (
    <div className="my-1.5 flex flex-wrap gap-1">
      {items.map((p, i) => (
        <span key={i} className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 py-px text-[0.7rem] ${toneClass}`}>
          {p}
          <button onClick={() => onRemove(i)} className="text-destructive">×</button>
        </span>
      ))}
    </div>
  );
}

function PathList({ items, onRemove, danger }) {
  return (
    <div className="my-1 flex flex-col gap-0.5">
      {items.map((p, i) => (
        <div
          key={i}
          className={`flex items-center justify-between rounded px-1.5 py-0.5 text-[0.7rem] ${
            danger ? "border border-destructive/15 bg-destructive/5" : "border border-border bg-muted/30"
          }`}
        >
          <span className="max-w-[85%] overflow-hidden text-ellipsis whitespace-nowrap">{p}</span>
          <Trash2 size={12} onClick={() => onRemove(i)} className="shrink-0 cursor-pointer text-destructive" />
        </div>
      ))}
    </div>
  );
}

function AddRow({ value, onChange, placeholder, onAdd }) {
  return (
    <div className="flex gap-1">
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-[26px] flex-1 text-xs" />
      <Button onClick={onAdd} variant="outline" size="xs">
        <Plus size={12} />
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
  models,
  voices,
  onSave,
  onManualCompact,
  onAddConfigItem,
  onRemoveConfigItem,
  sessionMode,
  onSetSessionMode,
}) {
  const { devices, pairing, startPairing, clearPairing, revokeDevice } = useDevices();
  const [newDeviceLabel, setNewDeviceLabel] = useState("");

  return (
    <aside className="flex flex-col gap-4 p-1">
      <div className="flex items-center gap-2 border-b border-border pb-2.5 text-[0.95rem] font-bold">
        <Settings size={14} /> Agent Settings
      </div>

      {/* ── LiteLLM configurations ── */}
      <div className="flex flex-col gap-2.5">
        <div>
          <FieldLabel>LITELLM BASE ENDPOINT</FieldLabel>
          <Input value={settings.baseURL} onChange={(e) => onSettingsChange({ baseURL: e.target.value })} className="h-8 text-sm" />
        </div>
        <div>
          <FieldLabel>API KEY</FieldLabel>
          <Input type="password" value={settings.apiKey} onChange={(e) => onSettingsChange({ apiKey: e.target.value })} className="h-8 text-sm" />
        </div>
      </div>

      {/* ── Model Selections ── */}
      <div className="flex flex-col gap-2.5">
        <div>
          <FieldLabel>NORMAL EXECUTION MODEL</FieldLabel>
          <Select value={settings.selectedNormalModel} onValueChange={(v) => onSettingsChange({ selectedNormalModel: v })}>
            <SelectTrigger className="h-8 w-full text-sm"><SelectValue placeholder="Select model" /></SelectTrigger>
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
          <FieldLabel>REASONING PLANNER MODEL</FieldLabel>
          <Select value={settings.selectedReasoningModel} onValueChange={(v) => onSettingsChange({ selectedReasoningModel: v })}>
            <SelectTrigger className="h-8 w-full text-sm"><SelectValue placeholder="Select model" /></SelectTrigger>
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

      <div>
        <FieldLabel>AGENT THINKING MODE</FieldLabel>
        <Select value={settings.taskMode} onValueChange={(v) => onSettingsChange({ taskMode: v })}>
          <SelectTrigger className="h-8 w-full text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="normal">Normal Model Only (Fast)</SelectItem>
            <SelectItem value="reasoning">Reasoning Model Only (Deep)</SelectItem>
            <SelectItem value="hybrid">Hybrid Orchestrator (Plan + Exec)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <FieldLabel>SYSTEM PROMPT DIRECTIVES</FieldLabel>
        <Select value={systemPromptType} onValueChange={setSystemPromptType}>
          <SelectTrigger className="h-8 w-full text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="standard">Standard PA Prompt</SelectItem>
            <SelectItem value="fable-5">Claude Fable 5 Leak Prompt</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <FieldLabel>LOCAL TTS VOICE</FieldLabel>
        <Select value={settings.selectedVoice} onValueChange={(v) => onSettingsChange({ selectedVoice: v })}>
          <SelectTrigger className="h-8 w-full text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            {voices.length > 0 ? (
              voices.map((v) => <SelectItem key={v.id} value={v.id}>{v.display_name || v.id}</SelectItem>)
            ) : (
              <SelectItem value="alba">alba (Default)</SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>

      <ToggleRow label="VOICE RESPONSES (TTS)" checked={voiceResponse} onCheckedChange={setVoiceResponse} />

      {/* ── Memory & Compaction ── */}
      <SectionLabel>Memory &amp; Compaction</SectionLabel>
      <div className="mb-2 flex flex-col gap-2.5">
        <ToggleRow
          label="AUTO COMPACTION"
          checked={settings.autoCompactEnabled}
          onCheckedChange={(v) => onSettingsChange({ autoCompactEnabled: v })}
        />
        <div className="p-1">
          <div className="mb-1.5 flex justify-between text-xs font-semibold text-muted-foreground">
            <span>COMPACTION THRESHOLD</span>
            <span className="text-foreground">{settings.autoCompactThreshold}%</span>
          </div>
          <input
            type="range"
            min="30"
            max="90"
            step="5"
            value={settings.autoCompactThreshold}
            onChange={(e) => onSettingsChange({ autoCompactThreshold: parseInt(e.target.value) })}
            disabled={!settings.autoCompactEnabled}
            className="w-full accent-primary"
          />
        </div>
        <Button variant="outline" onClick={onManualCompact} className="w-full">
          Compact Memory Now
        </Button>
      </div>

      {/* ── Agent Mode ── */}
      <SectionLabel>Agent Mode</SectionLabel>
      <div className="mb-2 flex flex-col gap-2">
        <div className="flex gap-1.5">
          {AGENT_MODES.map((mode) => {
            const isActive = sessionMode === mode.id;
            return (
              <button
                key={mode.id}
                onClick={() => onSetSessionMode(mode.id)}
                className={`flex-1 rounded-lg border p-2.5 text-center transition-colors ${
                  isActive ? `border-current bg-accent ${mode.color}` : "border-border bg-muted/20 text-muted-foreground hover:bg-muted"
                }`}
              >
                <mode.icon size={16} className="mx-auto mb-0.5" />
                <div className={`text-[0.72rem] ${isActive ? "font-bold" : ""}`}>{mode.label}</div>
                <div className="mt-0.5 text-[0.6rem] opacity-70">{mode.desc}</div>
              </button>
            );
          })}
        </div>
        {sessionMode && (
          <div className="rounded bg-muted/30 px-2 py-1 text-[0.7rem] text-muted-foreground">
            Current session mode: <strong>{sessionMode.toUpperCase()}</strong>
          </div>
        )}
      </div>

      {/* ── Security Configurations ── */}
      <SectionLabel>Security Configurations</SectionLabel>

      {securityConfig ? (
        <div className="flex flex-col gap-3.5">
          <ToggleRow
            label="Require Approval (HITL)"
            checked={securityConfig.shellCommands?.requireApproval ?? true}
            onCheckedChange={(checked) => {
              const updated = { ...securityConfig };
              if (!updated.shellCommands) updated.shellCommands = {};
              updated.shellCommands.requireApproval = checked;
              setSecurityConfig(updated);
            }}
          />

          <div>
            <span className="text-xs font-semibold text-muted-foreground">Allowed Utilities list:</span>
            <TagList items={securityConfig.shellCommands?.allowedPrefixes || []} onRemove={(i) => onRemoveConfigItem("shellCommands", "allowedPrefixes", i)} />
            <AddRow
              value={settings.newAllowedPrefix}
              onChange={(v) => onSettingsChange({ newAllowedPrefix: v })}
              placeholder="e.g. git"
              onAdd={() => onAddConfigItem("shellCommands", "allowedPrefixes", settings.newAllowedPrefix, "newAllowedPrefix")}
            />
          </div>

          <div>
            <span className="text-xs font-semibold text-muted-foreground">Auto-Approve commands:</span>
            <TagList items={securityConfig.shellCommands?.autoApprove || []} onRemove={(i) => onRemoveConfigItem("shellCommands", "autoApprove", i)} tone="success" />
            <AddRow
              value={settings.newAutoApprove}
              onChange={(v) => onSettingsChange({ newAutoApprove: v })}
              placeholder="e.g. ls"
              onAdd={() => onAddConfigItem("shellCommands", "autoApprove", settings.newAutoApprove, "newAutoApprove")}
            />
          </div>

          <div>
            <span className="mb-0.5 block text-xs font-semibold text-muted-foreground">Allowed Read Directories:</span>
            <PathList items={securityConfig.fileSystem?.allowedReadPaths || []} onRemove={(i) => onRemoveConfigItem("fileSystem", "allowedReadPaths", i)} />
            <AddRow
              value={settings.newReadPath}
              onChange={(v) => onSettingsChange({ newReadPath: v })}
              placeholder="/absolute/path"
              onAdd={() => onAddConfigItem("fileSystem", "allowedReadPaths", settings.newReadPath, "newReadPath")}
            />
          </div>

          <div>
            <span className="mb-0.5 block text-xs font-semibold text-muted-foreground">Allowed Write Directories:</span>
            <PathList items={securityConfig.fileSystem?.allowedWritePaths || []} onRemove={(i) => onRemoveConfigItem("fileSystem", "allowedWritePaths", i)} />
            <AddRow
              value={settings.newWritePath}
              onChange={(v) => onSettingsChange({ newWritePath: v })}
              placeholder="/absolute/path"
              onAdd={() => onAddConfigItem("fileSystem", "allowedWritePaths", settings.newWritePath, "newWritePath")}
            />
          </div>

          <div>
            <span className="mb-0.5 block text-xs font-semibold text-muted-foreground">Explicitly Blocked Directories:</span>
            <PathList items={securityConfig.fileSystem?.blockedPaths || []} onRemove={(i) => onRemoveConfigItem("fileSystem", "blockedPaths", i)} danger />
            <AddRow
              value={settings.newBlockedPath}
              onChange={(v) => onSettingsChange({ newBlockedPath: v })}
              placeholder="/absolute/path"
              onAdd={() => onAddConfigItem("fileSystem", "blockedPaths", settings.newBlockedPath, "newBlockedPath")}
            />
          </div>

          <Button onClick={onSave} className="mt-2 w-full">
            Save Settings &amp; Policies
          </Button>
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">Loading settings...</div>
      )}

      {/* ── Paired Devices ── */}
      <SectionLabel>
        <span className="flex items-center gap-1.5"><Smartphone size={13} /> Paired Devices</span>
      </SectionLabel>
      <div className="mb-2 flex flex-col gap-2">
        {devices.length === 0 ? (
          <div className="text-xs italic text-muted-foreground">No other devices paired yet.</div>
        ) : (
          devices.map((d) => (
            <div key={d.id} className="flex items-center justify-between rounded-md border border-border bg-muted/30 p-2">
              <div className="flex flex-col gap-0.5 overflow-hidden">
                <span className={`text-[0.78rem] font-semibold ${d.revoked ? "text-muted-foreground" : ""}`}>
                  {d.label} {d.revoked && "(revoked)"}
                </span>
                <span className="text-[0.68rem] text-muted-foreground">
                  {d.lastSeen ? `Last seen ${new Date(d.lastSeen).toLocaleString()}` : "Never connected"}
                </span>
              </div>
              {!d.revoked && (
                <Trash2 size={13} onClick={() => revokeDevice(d.id)} className="shrink-0 cursor-pointer text-destructive" />
              )}
            </div>
          ))
        )}

        {pairing ? (
          <div className="flex flex-col gap-2 rounded-md border border-primary bg-primary/10 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">Enter this code on the new device — expires in 5 minutes</span>
              <X size={13} onClick={clearPairing} className="cursor-pointer text-muted-foreground" />
            </div>
            <div className="text-center font-mono text-[1.3rem] font-bold tracking-[0.2em] text-primary">{pairing.code}</div>
            <div className="flex gap-1">
              <Input readOnly value={pairing.pairingUrl} className="h-[26px] flex-1 text-xs" />
              <Button variant="outline" size="xs" onClick={() => navigator.clipboard?.writeText(pairing.pairingUrl)}>
                <Copy size={12} />
              </Button>
            </div>
          </div>
        ) : (
          <AddRow value={newDeviceLabel} onChange={setNewDeviceLabel} placeholder="Device name, e.g. My Phone" onAdd={() => startPairing(newDeviceLabel)} />
        )}
      </div>
    </aside>
  );
}
