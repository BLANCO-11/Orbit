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
    <aside style={{
      width: "240px",
      borderRight: "1px solid var(--border-color)",
      background: "rgba(9, 9, 11, 0.4)",
      display: "flex",
      flexDirection: "column",
      flexShrink: 0
    }}>
      {/* New Session Button */}
      <div style={{ padding: "16px" }}>
        <Button
          onClick={onNewSession}
          style={{ width: "100%", justifyContent: "flex-start", gap: "8px", height: "36px", fontSize: "0.8rem", borderRadius: "var(--radius-sm)" }}
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
            height: "30px",
            fontSize: "0.75rem",
            borderRadius: "6px",
            backgroundColor: "var(--input-bg)",
            color: "var(--text-main)",
            border: "1px solid var(--border-color)",
            padding: "4px 10px",
            outline: "none"
          }}
        />
      </div>

      {/* Sessions List with Date Grouping */}
      <div style={{ flex: "1", overflowY: "auto", padding: "0 12px 16px 12px" }}>
        {groupedSessions.length === 0 ? (
          <div style={{ color: "var(--text-dark)", fontSize: "0.75rem", textAlign: "center", padding: "20px 0" }}>
            {searchQuery ? "No matching sessions." : "No sessions yet."}
          </div>
        ) : (
          groupedSessions.map(([groupName, groupSessions]) => (
            <div key={groupName} style={{ marginBottom: "8px" }}>
              <div style={{
                fontSize: "0.65rem",
                fontWeight: "700",
                color: "var(--text-dark)",
                textTransform: "uppercase",
                letterSpacing: "1px",
                padding: "4px 4px 6px 4px"
              }}>
                {groupName}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
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
                        padding: "8px 10px",
                        borderRadius: "6px",
                        cursor: "pointer",
                        fontSize: "0.75rem",
                        background: isActive ? "var(--input-bg)" : "transparent",
                        border: isActive ? "1px solid var(--border-color)" : "1px solid transparent",
                        color: isActive ? "#fff" : "var(--text-muted)",
                        transition: "all 0.12s ease",
                        minHeight: "36px",
                        position: "relative"
                      }}
                    >
                      <div style={{ flex: "1", overflow: "hidden" }}>
                        <span style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          display: "block",
                          fontWeight: isActive ? "600" : "400"
                        }}>
                          {s.title}
                        </span>
                        {/* Session preview on hover */}
                        {(isActive || hoveredSessionId === s.id) && preview && (
                          <span style={{
                            fontSize: "0.65rem",
                            color: "var(--text-dark)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            display: "block",
                            marginTop: "2px"
                          }}>
                            {preview}
                          </span>
                        )}
                      </div>
                      {(isActive || hoveredSessionId === s.id) && sessionsLength > 1 && (
                        <Trash2
                          size={12}
                          onClick={(e) => {
                            e.stopPropagation();
                            onDelete(s.id);
                          }}
                          style={{
                            color: "var(--danger)",
                            cursor: "pointer",
                            opacity: 0.7,
                            transition: "opacity 0.1s ease",
                            flexShrink: 0,
                            marginLeft: "4px"
                          }}
                          onMouseEnter={(e) => e.target.style.opacity = 1}
                          onMouseLeave={(e) => e.target.style.opacity = 0.7}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
