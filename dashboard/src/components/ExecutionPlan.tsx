// @ts-nocheck
"use client";

import React, { useEffect, useRef, useState } from "react";
import { Loader2, ChevronDown, ChevronRight } from "lucide-react";

/**
 * ReasoningTab — Shows per-query reasoning audit trails.
 * Each user query gets its own accordion. Within each accordion,
 * streaming reasoning entries are collapsible.
 */
export default function ExecutionPlan({ executionPlan, reasoningHistory = [] }) {
  const scrollRef = useRef(null);
  // Per-group collapse state: { [groupIndex]: boolean }
  const [groupCollapsed, setGroupCollapsed] = useState({});
  // Per-entry collapse within each group: { groupIndex: { entryIndex: boolean } }
  const [entryCollapsed, setEntryCollapsed] = useState({});

  // Auto-scroll when new reasoning arrives
  useEffect(() => {
    if (scrollRef.current) {
      requestAnimationFrame(() => {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      });
    }
  }, [reasoningHistory.length, reasoningHistory.map(g => g.entries?.length).pop()]);

  // Collapse all groups by default
  useEffect(() => {
    if (reasoningHistory.length > 0) {
      setGroupCollapsed(prev => {
        const next = { ...prev };
        reasoningHistory.forEach((_, idx) => {
          if (next[idx] === undefined) {
            next[idx] = true; // collapse by default
          }
        });
        return next;
      });
    }
  }, [reasoningHistory.length]);

  const toggleGroup = (idx) => {
    setGroupCollapsed(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  const toggleEntry = (groupIdx, entryIdx) => {
    setEntryCollapsed(prev => {
      const group = prev[groupIdx] || {};
      const isCurrentlyExpanded = group[entryIdx] === true;
      return { ...prev, [groupIdx]: { ...group, [entryIdx]: !isCurrentlyExpanded } };
    });
  };

  // If we have reasoning history with query groups
  if (reasoningHistory && reasoningHistory.length > 0) {
    // Only show groups that have entries (skip empty current group)
    const groupsWithContent = reasoningHistory.filter(g => g.entries && g.entries.length > 0);

    if (groupsWithContent.length === 0) {
      // Check if there's a current (empty) group with live reasoning
      const hasLiveReasoning = reasoningHistory.length > 0 && 
        reasoningHistory[reasoningHistory.length - 1].entries &&
        reasoningHistory[reasoningHistory.length - 1].entries.length === 0;

      return (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          height: "100%", color: "var(--text-secondary)", gap: "10px", minHeight: "150px",
        }}>
          <Loader2 className="animate-spin" style={{ width: "16px", height: "16px" }} />
          <span style={{ fontSize: "0.75rem" }}>
            {hasLiveReasoning ? "Waiting for reasoning..." : "No reasoning recorded yet."}
          </span>
        </div>
      );
    }

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "10px", height: "100%" }}>
        <div style={{
          fontSize: "0.7rem", fontWeight: "600", color: "var(--text-secondary)",
          textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "4px",
          display: "flex", alignItems: "center", gap: "6px"
        }}>
          <span style={{ width: "4px", height: "4px", borderRadius: "50%", background: "var(--text-secondary)" }} />
          Reasoning Trail
          <span style={{ fontSize: "0.6rem", opacity: 0.6 }}>({groupsWithContent.length} queries)</span>
        </div>

        <div
          ref={scrollRef}
          style={{
            flex: "1", display: "flex", flexDirection: "column", gap: "8px",
            paddingRight: "4px", minHeight: 0, overflowY: "auto", scrollBehavior: "smooth"
          }}
        >
          {reasoningHistory.map((group, gIdx) => {
            // Skip empty groups unless it's the last one with live reasoning
            if (!group.entries || group.entries.length === 0) {
              const isCurrentLive = gIdx === reasoningHistory.length - 1 && executionPlan;
              if (!isCurrentLive) return null;
            }

            const isCurrentGroup = gIdx === reasoningHistory.length - 1;
            const isCollapsed = groupCollapsed[gIdx] === true;
            const entries = group.entries || [];
            const entryCount = entries.length;

            return (
              <div
                key={gIdx}
                style={{
                  border: "1px solid var(--border-default)",
                  borderRadius: "6px",
                  background: "rgba(255,255,255,0.02)",
                  overflow: "hidden",
                  transition: "all 0.15s ease"
                }}
              >
                {/* Group header */}
                <div
                  onClick={() => toggleGroup(gIdx)}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "7px 10px", cursor: "pointer", userSelect: "none",
                    borderBottom: !isCollapsed ? "1px solid var(--border-default)" : "none",
                    background: isCurrentGroup && !isCollapsed ? "rgba(59, 130, 246, 0.04)" : "transparent"
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", overflow: "hidden" }}>
                    <span style={{
                      width: "4px", height: "4px", borderRadius: "50%",
                      background: isCurrentGroup ? "var(--accent-info)" : "var(--text-tertiary)",
                      flexShrink: 0
                    }} />
                    <span style={{
                      fontSize: "0.7rem", fontWeight: isCurrentGroup ? "600" : "400",
                      color: isCurrentGroup ? "var(--accent-info)" : "var(--text-secondary)",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      maxWidth: "240px"
                    }}>
                      {isCurrentGroup ? "Current" : `Query ${gIdx + 1}`}
                    </span>
                    {group.query && (
                      <span style={{
                        fontSize: "0.6rem", color: "var(--text-tertiary)",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        maxWidth: "120px"
                      }}>
                        {group.query}
                      </span>
                    )}
                    {group.queryTimestamp && (
                      <span style={{ fontSize: "0.55rem", color: "var(--text-tertiary)", flexShrink: 0 }}>
                        {group.queryTimestamp}
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                    {entryCount > 0 && (
                      <span style={{ fontSize: "0.6rem", color: "var(--text-tertiary)" }}>
                        {entryCount} step{entryCount !== 1 ? "s" : ""}
                      </span>
                    )}
                    {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  </div>
                </div>

                {/* Group content — streaming entries */}
                {!isCollapsed && (
                  <div style={{ padding: "6px 8px", display: "flex", flexDirection: "column", gap: "4px" }}>
                    {/* If no entries but has live executionPlan, show it inline */}
                    {entryCount === 0 && isCurrentGroup && executionPlan && (
                      <div style={{
                        padding: "6px 8px", fontSize: "0.75rem", color: "var(--text-primary)",
                        whiteSpace: "pre-wrap", lineHeight: "1.5", maxHeight: "320px",
                        overflowY: "auto", fontFamily: "ui-monospace, monospace",
                        background: "rgba(0,0,0,0.1)", borderRadius: "4px"
                      }}>
                        {executionPlan}
                      </div>
                    )}

                    {/* Individual reasoning entries */}
                    {entryCount === 1 && (
                      <div style={{
                        padding: "6px 8px", fontSize: "0.73rem", color: "var(--text-primary)",
                        whiteSpace: "pre-wrap", lineHeight: "1.5", maxHeight: "320px",
                        overflowY: "auto", fontFamily: "ui-monospace, monospace",
                        background: "rgba(0,0,0,0.1)", borderRadius: "4px",
                        opacity: isCurrentGroup ? 1 : 0.8
                      }}>
                        {entries[0].content || ""}
                      </div>
                    )}

                    {entryCount > 1 && entries.map((entry, eIdx) => {
                      const isLastEntry = eIdx === entries.length - 1;
                      const isEntryCollapsed = (entryCollapsed[gIdx] || {})[eIdx] !== true;

                      return (
                        <div
                          key={eIdx}
                          style={{
                            border: "1px solid rgba(255,255,255,0.04)",
                            borderRadius: "4px",
                            overflow: "hidden"
                          }}
                        >
                          {/* Sub-entry header */}
                          <div
                            onClick={() => toggleEntry(gIdx, eIdx)}
                            style={{
                              display: "flex", alignItems: "center", justifyContent: "space-between",
                              padding: "4px 8px", cursor: "pointer", userSelect: "none",
                              background: "rgba(255,255,255,0.015)"
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                              <span style={{
                                width: "3px", height: "3px", borderRadius: "50%",
                                background: isLastEntry ? "var(--accent-info)" : "var(--text-tertiary)",
                                flexShrink: 0
                              }} />
                              <span style={{ fontSize: "0.65rem", color: "var(--text-tertiary)" }}>
                                Step {eIdx + 1}
                              </span>
                              {entry.timestamp && (
                                <span style={{ fontSize: "0.55rem", color: "var(--text-tertiary)" }}>
                                  {entry.timestamp}
                                </span>
                              )}
                            </div>
                            {isEntryCollapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
                          </div>

                          {/* Sub-entry content */}
                          {!isEntryCollapsed && (
                            <div style={{
                              padding: "4px 8px 6px 8px", fontSize: "0.73rem",
                              color: "var(--text-primary)", whiteSpace: "pre-wrap",
                              lineHeight: "1.5", maxHeight: isLastEntry ? "320px" : "100px",
                              overflowY: "auto", fontFamily: "ui-monospace, monospace",
                              opacity: isLastEntry ? 1 : 0.7
                            }}>
                              {entry.content || ""}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Show live reasoning update streaming if not yet captured as entry */}
                    {isCurrentGroup && executionPlan && 
                      entries.length > 0 && 
                      executionPlan !== entries[entries.length - 1].content && (
                      <div style={{
                        padding: "6px 8px", fontSize: "0.73rem", color: "var(--accent-info)",
                        whiteSpace: "pre-wrap", lineHeight: "1.5", maxHeight: "160px",
                        overflowY: "auto", fontFamily: "ui-monospace, monospace",
                        background: "rgba(59, 130, 246, 0.04)", borderRadius: "4px",
                        border: "1px solid rgba(59, 130, 246, 0.08)"
                      }}>
                        {executionPlan}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Fallback: no history at all
  if (!executionPlan) {
    return (
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        height: "100%", color: "var(--text-secondary)", gap: "10px", minHeight: "150px",
      }}>
        <Loader2 className="animate-spin" style={{ width: "16px", height: "16px" }} />
        <span style={{ fontSize: "0.75rem" }}>Waiting for reasoning...</span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px", height: "100%" }}>
      <div style={{
        fontSize: "0.7rem", fontWeight: "600", color: "var(--text-secondary)",
        textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "4px",
        display: "flex", alignItems: "center", gap: "6px"
      }}>
        <span style={{ width: "4px", height: "4px", borderRadius: "50%", background: "var(--text-secondary)" }} />
        Current Reasoning
      </div>
      <div
        ref={scrollRef}
        style={{
          flex: "1", fontSize: "0.75rem", color: "var(--text-primary)",
          whiteSpace: "pre-wrap", lineHeight: "1.5", padding: "10px",
          background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-default)",
          borderRadius: "6px", minHeight: 0, overflowY: "auto",
          fontFamily: "ui-monospace, monospace", scrollBehavior: "smooth"
        }}
      >
        {executionPlan}
      </div>
    </div>
  );
}
