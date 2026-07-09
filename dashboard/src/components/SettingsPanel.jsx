"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2 } from "lucide-react";

export default function SettingsPanel({
  securityConfig,
  setSecurityConfig,
  baseURL,
  setBaseURL,
  apiKey,
  setApiKey,
  selectedNormalModel,
  setSelectedNormalModel,
  selectedReasoningModel,
  setSelectedReasoningModel,
  selectedVoice,
  setSelectedVoice,
  taskMode,
  setTaskMode,
  systemPromptType,
  setSystemPromptType,
  voiceResponse,
  setVoiceResponse,
  autoCompactEnabled,
  setAutoCompactEnabled,
  autoCompactThreshold,
  setAutoCompactThreshold,
  models,
  voices,
  onSave,
  onManualCompact,
  onAddConfigItem,
  onRemoveConfigItem,
  newReadPath,
  setNewReadPath,
  newWritePath,
  setNewWritePath,
  newBlockedPath,
  setNewBlockedPath,
  newAllowedPrefix,
  setNewAllowedPrefix,
  newAutoApprove,
  setNewAutoApprove,
}) {
  const sectionLabelStyle = {
    fontSize: "0.95rem",
    fontWeight: "700",
    color: "var(--text-main)",
    borderBottom: "1px solid var(--border-muted)",
    paddingBottom: "10px",
    marginTop: "10px",
    marginBottom: "10px",
  };

  const fieldLabelStyle = {
    display: "block",
    fontSize: "0.75rem",
    color: "var(--text-muted)",
    marginBottom: "4px",
    fontWeight: "600",
  };

  const rowStyle = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    background: "rgba(255,255,255,0.02)",
    padding: "8px",
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--border-color)",
  };

  const tagStyle = {
    background: "rgba(124, 58, 237, 0.15)",
    border: "1px solid rgba(124, 58, 237, 0.3)",
    padding: "1px 6px",
    borderRadius: "12px",
    fontSize: "0.7rem",
    display: "inline-flex",
    alignItems: "center",
    gap: "3px",
  };

  const tagGreenStyle = {
    ...tagStyle,
    background: "rgba(16, 185, 129, 0.15)",
    border: "1px solid rgba(16, 185, 129, 0.3)",
  };

  const pathRowStyle = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    background: "rgba(255,255,255,0.02)",
    padding: "3px 6px",
    borderRadius: "6px",
    fontSize: "0.7rem",
    border: "1px solid var(--border-color)",
  };

  const blockedPathRowStyle = {
    ...pathRowStyle,
    background: "rgba(239, 68, 68, 0.03)",
    border: "1px solid rgba(239, 68, 68, 0.15)",
  };

  const addRowStyle = {
    display: "flex",
    gap: "4px",
  };

  const smallInputStyle = {
    flex: "1",
    height: "26px",
    fontSize: "0.75rem",
    padding: "2px 8px",
  };

  const smallButtonStyle = {
    height: "26px",
    padding: "0 10px",
    fontSize: "0.75rem",
  };

  const renderTagList = (items, onRemove, tagStyles = tagStyle) => (
    <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", margin: "6px 0" }}>
      {items.map((p, i) => (
        <span key={i} style={tagStyles}>
          {p}
          <button
            onClick={() => onRemove(i)}
            style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: "0.7rem" }}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );

  const renderAddRow = (value, setter, placeholder, onAdd) => (
    <div style={addRowStyle}>
      <Input
        value={value}
        onChange={(e) => setter(e.target.value)}
        placeholder={placeholder}
        style={smallInputStyle}
      />
      <Button onClick={onAdd} variant="outline" style={smallButtonStyle}>
        <Plus size={12} />
      </Button>
    </div>
  );

  const renderPathList = (items, onRemove, rowStyles = pathRowStyle) => (
    <div style={{ display: "flex", flexDirection: "column", gap: "3px", margin: "4px 0" }}>
      {items.map((p, i) => (
        <div key={i} style={rowStyles}>
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: "85%",
            }}
          >
            {p}
          </span>
          <Trash2
            size={12}
            onClick={() => onRemove(i)}
            style={{ color: "#f87171", cursor: "pointer", flexShrink: 0 }}
          />
        </div>
      ))}
    </div>
  );

  return (
    <aside className="sidebar-panel">
      <div
        style={{
          fontSize: "0.95rem",
          fontWeight: "700",
          color: "var(--text-main)",
          borderBottom: "1px solid var(--border-muted)",
          paddingBottom: "10px",
        }}
      >
        ⚙️ Agent Settings
      </div>

      {/* ── LiteLLM configurations ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <div>
          <label style={fieldLabelStyle}>LITELLM BASE ENDPOINT</label>
          <Input
            value={baseURL}
            onChange={(e) => setBaseURL(e.target.value)}
            style={{ height: "32px", fontSize: "0.8rem" }}
          />
        </div>
        <div>
          <label style={fieldLabelStyle}>API KEY</label>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            style={{ height: "32px", fontSize: "0.8rem" }}
          />
        </div>
      </div>

      {/* ── Model Selections ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <div>
          <label style={fieldLabelStyle}>NORMAL EXECUTION MODEL</label>
          <Select value={selectedNormalModel} onValueChange={setSelectedNormalModel}>
            <SelectTrigger style={{ width: "100%", height: "32px", fontSize: "0.8rem" }}>
              <SelectValue placeholder="Select model" />
            </SelectTrigger>
            <SelectContent>
              {models.length > 0 ? (
                models.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.id}
                  </SelectItem>
                ))
              ) : (
                <SelectItem value="loading" disabled>
                  No models loaded
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label style={fieldLabelStyle}>REASONING PLANNER MODEL</label>
          <Select value={selectedReasoningModel} onValueChange={setSelectedReasoningModel}>
            <SelectTrigger style={{ width: "100%", height: "32px", fontSize: "0.8rem" }}>
              <SelectValue placeholder="Select model" />
            </SelectTrigger>
            <SelectContent>
              {models.length > 0 ? (
                models.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.id}
                  </SelectItem>
                ))
              ) : (
                <SelectItem value="loading" disabled>
                  No models loaded
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ── Agent Thinking Mode ── */}
      <div>
        <label style={fieldLabelStyle}>AGENT THINKING MODE</label>
        <Select value={taskMode} onValueChange={setTaskMode}>
          <SelectTrigger style={{ width: "100%", height: "32px", fontSize: "0.8rem" }}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="normal">Normal Model Only (Fast)</SelectItem>
            <SelectItem value="reasoning">Reasoning Model Only (Deep)</SelectItem>
            <SelectItem value="hybrid">Hybrid Orchestrator (Plan + Exec)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* ── System Prompt Directives ── */}
      <div>
        <label style={fieldLabelStyle}>SYSTEM PROMPT DIRECTIVES</label>
        <Select value={systemPromptType} onValueChange={setSystemPromptType}>
          <SelectTrigger style={{ width: "100%", height: "32px", fontSize: "0.8rem" }}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="standard">Standard PA Prompt</SelectItem>
            <SelectItem value="fable-5">Claude Fable 5 Leak Prompt</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* ── TTS Voice Selection ── */}
      <div>
        <label style={fieldLabelStyle}>LOCAL TTS VOICE</label>
        <Select value={selectedVoice} onValueChange={setSelectedVoice}>
          <SelectTrigger style={{ width: "100%", height: "32px", fontSize: "0.8rem" }}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {voices.length > 0 ? (
              voices.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.display_name || v.id}
                </SelectItem>
              ))
            ) : (
              <SelectItem value="alba">alba (Default)</SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>

      {/* ── Voice Response Toggle ── */}
      <div style={rowStyle}>
        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: "600" }}>
          VOICE RESPONSES (TTS)
        </span>
        <Switch checked={voiceResponse} onCheckedChange={setVoiceResponse} />
      </div>

      {/* ── Memory & Compaction ── */}
      <div style={sectionLabelStyle}>🧹 Memory & Compaction</div>

      <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "18px" }}>
        <div style={rowStyle}>
          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: "600" }}>
            AUTO COMPACTION
          </span>
          <Switch
            checked={autoCompactEnabled}
            onCheckedChange={setAutoCompactEnabled}
          />
        </div>

        <div style={{ padding: "4px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "0.75rem",
              color: "var(--text-muted)",
              marginBottom: "6px",
              fontWeight: "600",
            }}
          >
            <span>COMPACTION THRESHOLD</span>
            <span style={{ color: "var(--primary-foreground)" }}>{autoCompactThreshold}%</span>
          </div>
          <input
            type="range"
            min="30"
            max="90"
            step="5"
            value={autoCompactThreshold}
            onChange={(e) => setAutoCompactThreshold(parseInt(e.target.value))}
            style={{ width: "100%", accentColor: "var(--primary)", cursor: "pointer" }}
            disabled={!autoCompactEnabled}
          />
        </div>

        <Button
          variant="outline"
          onClick={onManualCompact}
          style={{ width: "100%", height: "32px", fontSize: "0.8rem", gap: "6px" }}
        >
          🧹 Compact Memory Now
        </Button>
      </div>

      {/* ── Security Configurations ── */}
      <div style={sectionLabelStyle}>🛡️ Security configurations</div>

      {securityConfig ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {/* HITL Toggle */}
          <div style={rowStyle}>
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              Require Approval (HITL)
            </span>
            <Switch
              checked={securityConfig.shellCommands?.requireApproval ?? true}
              onCheckedChange={(checked) => {
                const updated = { ...securityConfig };
                if (!updated.shellCommands) updated.shellCommands = {};
                updated.shellCommands.requireApproval = checked;
                setSecurityConfig(updated);
              }}
            />
          </div>

          {/* Allowed Utilities */}
          <div>
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: "600" }}>
              Allowed Utilities list:
            </span>
            {renderTagList(
              securityConfig.shellCommands?.allowedPrefixes || [],
              (i) => onRemoveConfigItem("shellCommands", "allowedPrefixes", i)
            )}
            {renderAddRow(
              newAllowedPrefix,
              setNewAllowedPrefix,
              "e.g. git",
              () => onAddConfigItem("shellCommands", "allowedPrefixes", newAllowedPrefix, setNewAllowedPrefix)
            )}
          </div>

          {/* Auto-Approve Commands */}
          <div>
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: "600" }}>
              Auto-Approve commands:
            </span>
            {renderTagList(
              securityConfig.shellCommands?.autoApprove || [],
              (i) => onRemoveConfigItem("shellCommands", "autoApprove", i),
              tagGreenStyle
            )}
            {renderAddRow(
              newAutoApprove,
              setNewAutoApprove,
              "e.g. ls",
              () => onAddConfigItem("shellCommands", "autoApprove", newAutoApprove, setNewAutoApprove)
            )}
          </div>

          {/* Allowed Read Paths */}
          <div>
            <span
              style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: "600", display: "block", marginBottom: "3px" }}
            >
              Allowed Read Directories:
            </span>
            {renderPathList(
              securityConfig.fileSystem?.allowedReadPaths || [],
              (i) => onRemoveConfigItem("fileSystem", "allowedReadPaths", i)
            )}
            {renderAddRow(
              newReadPath,
              setNewReadPath,
              "/absolute/path",
              () => onAddConfigItem("fileSystem", "allowedReadPaths", newReadPath, setNewReadPath)
            )}
          </div>

          {/* Allowed Write Paths */}
          <div>
            <span
              style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: "600", display: "block", marginBottom: "3px" }}
            >
              Allowed Write Directories:
            </span>
            {renderPathList(
              securityConfig.fileSystem?.allowedWritePaths || [],
              (i) => onRemoveConfigItem("fileSystem", "allowedWritePaths", i)
            )}
            {renderAddRow(
              newWritePath,
              setNewWritePath,
              "/absolute/path",
              () => onAddConfigItem("fileSystem", "allowedWritePaths", newWritePath, setNewWritePath)
            )}
          </div>

          {/* Blocked Paths */}
          <div>
            <span
              style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: "600", display: "block", marginBottom: "3px" }}
            >
              Explicitly Blocked Directories:
            </span>
            {renderPathList(
              securityConfig.fileSystem?.blockedPaths || [],
              (i) => onRemoveConfigItem("fileSystem", "blockedPaths", i),
              blockedPathRowStyle
            )}
            {renderAddRow(
              newBlockedPath,
              setNewBlockedPath,
              "/absolute/path",
              () => onAddConfigItem("fileSystem", "blockedPaths", newBlockedPath, setNewBlockedPath)
            )}
          </div>

          {/* Save Button */}
          <Button
            onClick={onSave}
            style={{ width: "100%", padding: "10px", marginTop: "10px", fontSize: "0.85rem" }}
          >
            Save Settings & Policies
          </Button>
        </div>
      ) : (
        <div style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>Loading settings...</div>
      )}
    </aside>
  );
}
