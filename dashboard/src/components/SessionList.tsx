// @ts-nocheck
"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";

export default function SessionList({
  sessions,
  currentSessionId,
  searchQuery,
  onSearchChange,
  groupedSessions,
  hoveredSessionId,
  onHover,
  onLeave,
  onSwitch,
  onDelete,
  onNewSession,
  getSessionPreview,
  sessionsLength
}) {
  return (
    <div style={{
      width: "100%",
      height: "100%",
      display: "flex",
      flexDirection: "column",
      flexShrink: 0
    }}>
      {/* New Session Button */}
      <div style={{ padding: "16px 12px 8px 12px" }}>
        <Button
          onClick={onNewSession}
          style={{ 
            width: "100%", 
            justifyContent: "center", 
            gap: "8px", 
            height: "36px", 
            fontSize: "0.8rem", 
            fontWeight: "600",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border-strong)",
            background: "var(--surface-elevated)",
            color: "var(--text-primary)",
            transition: "all 0.2s var(--ease-out-expo)"
          }}
          className="interactive-base"
          variant="outline"
        >
          <Plus size={14} /> New Session
        </Button>
      </div>

      {/* Session Search */}
      <div style={{ padding: "0 12px 8px 12px" }}>
        <input
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search sessions..."
          style={{
            width: "100%",
            height: "34px",
            fontSize: "0.78rem",
            borderRadius: "var(--radius-sm)",
            backgroundColor: "var(--input)",
            color: "var(--text-primary)",
            border: "1px solid var(--border-subtle)",
            padding: "4px 12px",
            outline: "none",
            transition: "border-color 0.2s var(--ease-out-expo)"
          }}
          onFocus={(e) => e.target.style.borderColor = "var(--accent-primary)"}
          onBlur={(e) => e.target.style.borderColor = "var(--border-subtle)"}
        />
      </div>

      {/* Sessions List with Date Grouping */}
      <div style={{ flex: "1", overflowY: "auto", padding: "0 8px 16px 8px" }}>
        {groupedSessions.length === 0 ? (
          <div style={{ color: "var(--text-secondary)", fontSize: "0.75rem", textAlign: "center", padding: "20px 0" }}>
            {searchQuery ? "No matching sessions." : "No sessions yet."}
          </div>
        ) : (
          groupedSessions.map(([groupName, groupSessions]) => (
            <div key={groupName} style={{ marginBottom: "12px" }}>
              <div style={{
                fontSize: "0.62rem",
                fontWeight: "700",
                color: "var(--text-secondary)",
                textTransform: "uppercase",
                letterSpacing: "1.2px",
                padding: "4px 8px 6px 8px"
              }}>
                {groupName}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                {groupSessions.map((s) => {
                  const isActive = s.id === currentSessionId;
                  const preview = getSessionPreview(s);
                  return (
                    <div
                      key={s.id}
                      onClick={() => onSwitch(s.id)}
                      onMouseEnter={() => onHover(s.id)}
                      onMouseLeave={() => onLeave()}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "8px 12px",
                        borderRadius: "var(--radius-md)",
                        cursor: "pointer",
                        fontSize: "0.78rem",
                        background: isActive 
                          ? "var(--accent-primary-muted)" 
                          : hoveredSessionId === s.id 
                            ? "rgba(255, 255, 255, 0.03)" 
                            : "transparent",
                        border: "1px solid transparent",
                        borderColor: isActive ? "rgba(0, 113, 227, 0.15)" : "transparent",
                        color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                        transition: "all 0.15s var(--ease-out-expo)",
                        minHeight: "40px",
                        position: "relative"
                      }}
                    >
                      {/* Active Indicator Line */}
                      {isActive && (
                        <div style={{
                          position: "absolute",
                          left: "4px",
                          width: "3px",
                          height: "18px",
                          borderRadius: "999px",
                          background: "var(--accent-primary)"
                        }} />
                      )}

                      <div style={{ flex: "1", overflow: "hidden", paddingLeft: isActive ? "6px" : "0" }}>
                        <span style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          display: "block",
                          fontWeight: isActive ? "600" : "500",
                          color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                        }}>
                          {s.title}
                        </span>
                        {/* Session preview */}
                        {preview && (
                          <span style={{
                            fontSize: "0.68rem",
                            color: "var(--text-secondary)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            display: "block",
                            marginTop: "2px",
                            opacity: isActive ? 0.95 : 0.75
                          }}>
                            {preview}
                          </span>
                        )}
                      </div>

                      {(isActive || hoveredSessionId === s.id) && sessionsLength > 1 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDelete(s.id);
                          }}
                          style={{
                            background: "none",
                            border: "none",
                            padding: "4px",
                            borderRadius: "var(--radius-sm)",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "var(--accent-danger)",
                            opacity: 0.65,
                            transition: "all 0.15s ease",
                            marginLeft: "6px",
                            flexShrink: 0
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.opacity = "1";
                            e.currentTarget.style.background = "var(--accent-danger-muted)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.opacity = "0.65";
                            e.currentTarget.style.background = "none";
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
