"use client";

import React from "react";
import {
  ChevronDown, ChevronRight,
  Terminal, FileCode, Globe, Settings,
  Loader2, CheckCircle2
} from "lucide-react";

/**
 * ToolCallCard — Collapsible tool call display
 *
 * Props:
 *   tool         – { id, name, arguments, result, status } (status: "running" | "done")
 *   isExpanded   – boolean (whether currently expanded)
 *   onToggle     – () => void (call to toggle expansion)
 *   getToolSummary – (tool) => string
 *   getToolOutput  – (result) => string
 */
export default function ToolCallCard({ tool, isExpanded, onToggle, getToolSummary, getToolOutput }) {
  // Determine tool icon
  let ToolIcon = Settings;
  if (tool.name === "bash") ToolIcon = Terminal;
  else if (["write", "edit", "read", "find"].includes(tool.name)) ToolIcon = FileCode;
  else if (tool.name.includes("lightpanda")) ToolIcon = Globe;

  return (
    <div style={{
      border: "1px solid var(--border-color)",
      borderRadius: "6px",
      background: "rgba(0,0,0,0.2)",
      overflow: "hidden"
    }}>
      {/* Header Row */}
      <div
        onClick={onToggle}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 10px",
          cursor: "pointer",
          userSelect: "none",
          fontSize: "0.75rem",
          background: "rgba(255,255,255,0.02)"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: "1", overflow: "hidden" }}>
          {tool.status === "running" ? (
            <Loader2 className="animate-spin" style={{ width: "12px", height: "12px", color: "var(--warning)", flexShrink: 0 }} />
          ) : (
            <CheckCircle2 style={{ width: "12px", height: "12px", color: "var(--success)", flexShrink: 0 }} />
          )}
          <ToolIcon style={{ width: "12px", height: "12px", color: "var(--text-muted)", flexShrink: 0 }} />
          <span style={{ color: "var(--text-main)", fontWeight: "500", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {getToolSummary(tool)}
          </span>
        </div>
        <div style={{ color: "var(--text-muted)", display: "flex", alignItems: "center", marginLeft: "8px" }}>
          {isExpanded ? <ChevronDown style={{ width: "14px", height: "14px" }} /> : <ChevronRight style={{ width: "14px", height: "14px" }} />}
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div style={{
          padding: "8px 10px",
          borderTop: "1px solid var(--border-color)",
          background: "#0c0c0e",
          fontSize: "0.75rem",
          fontFamily: "ui-monospace, monospace"
        }}>
          {/* Arguments Block */}
          {tool.arguments && Object.keys(tool.arguments).length > 0 && (
            <div style={{ marginBottom: "6px" }}>
              <div style={{ color: "var(--text-dark)", marginBottom: "2px", fontSize: "0.65rem", textTransform: "uppercase" }}>Arguments:</div>
              <pre style={{
                background: "rgba(255,255,255,0.03)",
                padding: "5px",
                borderRadius: "4px",
                overflowX: "auto",
                color: "#a78bfa"
              }}>{JSON.stringify(tool.arguments, null, 2)}</pre>
            </div>
          )}

          {/* Output Block */}
          <div>
            <div style={{ color: "var(--text-dark)", marginBottom: "2px", fontSize: "0.65rem", textTransform: "uppercase" }}>Output:</div>
            <pre style={{
              background: "rgba(0,0,0,0.4)",
              padding: "6px",
              borderRadius: "4px",
              overflowX: "auto",
              whiteSpace: "pre-wrap",
              color: "#34d399",
              maxHeight: "150px",
              overflowY: "auto"
            }}>{getToolOutput(tool.result)}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
