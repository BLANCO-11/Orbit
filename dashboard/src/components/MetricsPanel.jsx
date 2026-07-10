"use client";

import React, { useState } from "react";
import { Loader2, ChevronDown, ChevronRight, Activity, Cpu, DollarSign, Clock, Layers, List, Shield, GitBranch, Bot, UserCheck } from "lucide-react";

function MetricCard({ label, value, color }) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid var(--border-color)",
        padding: "8px 12px",
        borderRadius: "6px",
      }}
    >
      <div
        style={{
          fontSize: "0.65rem",
          color: "var(--text-muted)",
          marginBottom: "2px",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: "1.1rem",
          fontWeight: "700",
          color: color || "#fff",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function SectionHeader({ icon, title }) {
  return (
    <div
      style={{
        fontSize: "0.75rem",
        fontWeight: "700",
        color: "var(--text-muted)",
        textTransform: "uppercase",
        letterSpacing: "1px",
        marginBottom: "8px",
        display: "flex",
        alignItems: "center",
        gap: "6px",
      }}
    >
      {icon && <span>{icon}</span>} {title}
    </div>
  );
}

/**
 * SubagentPanel — Detailed view for a single subagent with state (idle/working/blocked/done),
 * current action (tool call or reasoning), tool calls, and inline reasoning
 */
function SubagentPanel({ subagent }) {
  const [expanded, setExpanded] = useState(false);

  // Normalize status for display
  const status = subagent.status || "idle";
  const stateColor = status === "working" || status === "active" ? "#3b82f6" :
    status === "blocked" ? "#f59e0b" :
    status === "completed" ? "#10b981" :
    status === "failed" ? "#ef4444" : "#71717a";

  const stateBg = status === "working" || status === "active" ? "rgba(59, 130, 246, 0.15)" :
    status === "blocked" ? "rgba(245, 158, 11, 0.15)" :
    status === "completed" ? "rgba(16, 185, 129, 0.15)" :
    status === "failed" ? "rgba(239, 68, 68, 0.15)" : "rgba(113, 113, 122, 0.15)";

  const stateLabel = status === "working" || status === "active" ? "WORKING" :
    status === "blocked" ? "BLOCKED" :
    status === "completed" ? "DONE" :
    status === "failed" ? "FAILED" : "IDLE";

  const isActive = status === "working" || status === "active" || status === "blocked";

  // Human-readable current action
  const action = subagent.currentAction || "";
  const actionLabel = !action ? (status === "completed" ? "Finished" : "Idle") :
    action === "reasoning" ? "Thinking..." :
    action === "ask_permission" || action === "ask_user" ? "Awaiting approval" :
    action === "subagent" ? "Managing sub-agents" :
    action === "bash" || action === "run_command" ? "Running shell command" :
    action === "write" || action === "edit" ? "Editing files" :
    action === "read" ? "Reading files" :
    action === "grep_search" ? "Searching code" :
    action === "search_web" ? "Searching web" :
    `Executing ${action}`;

  return (
    <div
      style={{
        border: isActive ? `1px solid ${stateColor}44` : "1px solid var(--border-color)",
        borderRadius: "8px",
        background: isActive ? `${stateColor}08` : "rgba(255,255,255,0.01)",
        overflow: "hidden",
        transition: "all 0.15s ease"
      }}
    >
      {/* Header — always visible */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 10px",
          cursor: "pointer",
          userSelect: "none",
          gap: "8px"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: "1", overflow: "hidden" }}>
          {/* Animated state dot */}
          <span style={{
            width: "6px", height: "6px", borderRadius: "50%",
            background: stateColor,
            boxShadow: isActive ? `0 0 8px ${stateColor}` : "none",
            flexShrink: 0,
            transition: "all 0.3s ease"
          }} />
          <Bot size={12} style={{ flexShrink: 0, color: "var(--text-muted)" }} />
          
          <div style={{ display: "flex", flexDirection: "column", gap: "1px", overflow: "hidden", flex: "1" }}>
            {/* Name */}
            <span style={{
              fontWeight: isActive ? "600" : "400",
              color: isActive ? "#fff" : "var(--text-main)",
              fontSize: "0.75rem",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            }}>
              {subagent.name || "Subagent"}
            </span>
            {/* Current action as micro label */}
            {action && (
              <span style={{
                fontSize: "0.6rem",
                color: stateColor,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap"
              }}>
                {actionLabel}
              </span>
            )}
          </div>

          {/* State badge */}
          <span style={{
            fontSize: "0.6rem",
            padding: "1px 6px",
            borderRadius: "10px",
            fontWeight: "600",
            background: stateBg,
            color: stateColor,
            flexShrink: 0
          }}>
            {stateLabel}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "4px", flexShrink: 0 }}>
          {subagent.toolCalls > 0 && (
            <span style={{ fontSize: "0.6rem", color: "var(--text-dark)" }}>
              {subagent.toolCalls} t
            </span>
          )}
          {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div style={{
          padding: "8px 10px",
          borderTop: "1px solid var(--border-color)",
          background: "rgba(0,0,0,0.15)",
          fontSize: "0.7rem",
          display: "flex",
          flexDirection: "column",
          gap: "6px"
        }}>
          {/* Current action highlight */}
          {action && (
            <div style={{
              padding: "4px 6px",
              background: `${stateColor}10`,
              borderRadius: "4px",
              border: `1px solid ${stateColor}20`,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between"
            }}>
              <span style={{ color: "var(--text-muted)", fontSize: "0.65rem" }}>Current Action</span>
              <span style={{ color: stateColor, fontWeight: "600", fontSize: "0.7rem" }}>{actionLabel}</span>
            </div>
          )}
          
          {/* Inherited permissions */}
          {subagent.inheritedMode && (
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-muted)" }}>Permissions</span>
              <span style={{
                color: subagent.inheritedMode === "edit" ? "#fbbf24" :
                       subagent.inheritedMode === "yolo" ? "#f87171" :
                       subagent.inheritedMode === "plan" ? "#60a5fa" : "#a1a1aa",
                fontSize: "0.65rem", fontWeight: "600"
              }}>
                {subagent.inheritedMode.toUpperCase()}
              </span>
            </div>
          )}
          
          {/* Timeline */}
          {subagent.time && (
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-muted)" }}>Started</span>
              <span style={{ color: "var(--text-main)" }}>{subagent.time}</span>
            </div>
          )}
          {subagent.timeEnd && (
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-muted)" }}>Completed</span>
              <span style={{ color: "var(--text-main)" }}>{subagent.timeEnd}</span>
            </div>
          )}
          {subagent.tokens > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-muted)" }}>Token Usage</span>
              <span style={{ color: "#a78bfa" }}>{(subagent.tokens || 0).toLocaleString()} tkn</span>
            </div>
          )}
          
          {/* Recent reasoning */}
          {subagent.reasoning && (
            <div style={{
              marginTop: "4px",
              padding: "6px",
              background: "rgba(59, 130, 246, 0.05)",
              borderRadius: "4px",
              border: "1px solid rgba(59, 130, 246, 0.12)"
            }}>
              <div style={{ color: "var(--text-muted)", marginBottom: "3px", fontSize: "0.65rem" }}>
                Recent Reasoning
              </div>
              <div style={{ color: "var(--text-main)", whiteSpace: "pre-wrap", fontSize: "0.7rem" }}>
                {subagent.reasoning.substring(0, 200)}{subagent.reasoning.length > 200 ? "..." : ""}
              </div>
            </div>
          )}
          
          {/* Tool calls */}
          {subagent.toolCalls > 0 && (
            <div style={{
              marginTop: "4px",
              padding: "6px",
              background: "rgba(0,0,0,0.2)",
              borderRadius: "4px"
            }}>
              <div style={{ color: "var(--text-muted)", marginBottom: "3px", fontSize: "0.65rem" }}>
                Tool Calls ({subagent.toolCalls})
              </div>
              {(subagent.recentToolCalls || []).length > 0 ? (
                (subagent.recentToolCalls || []).map((tc, i) => (
                  <div key={i} style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "0.65rem",
                    padding: "2px 0",
                    color: "var(--text-main)",
                    borderBottom: i < (subagent.recentToolCalls || []).length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none"
                  }}>
                    <span>{tc.name}</span>
                    <span style={{ color: "var(--text-dark)" }}>{tc.status}</span>
                  </div>
                ))
              ) : (
                <span style={{ color: "var(--text-dark)", fontSize: "0.65rem" }}>
                  {subagent.toolCalls} total (tracked internally)
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function MetricsPanel({ metrics, status, approvalsHistory }) {
  const [activeSubagentTab, setActiveSubagentTab] = useState("all");

  // Subagent tab: "all" or specific subagent name
  const displayedSubagents = activeSubagentTab === "all"
    ? (metrics.activeSubagents || [])
    : (metrics.activeSubagents || []).filter(sa => sa.name === activeSubagentTab);

  // Count accumulated metrics across all subagents
  const totalSubagentTokens = (metrics.activeSubagents || []).reduce((sum, sa) => sum + (sa.tokens || 0), 0);
  const totalSubagentToolCalls = (metrics.activeSubagents || []).reduce((sum, sa) => sum + (sa.toolCalls || 0), 0);
  const activeSubagentCount = (metrics.activeSubagents || []).filter(sa => sa.status === "active" || sa.status === "working" || sa.status === "blocked").length;

  // Accumulated session metrics (chat + subagents) — now the frontend accumulates these
  // via the subagent_metrics handler, so metrics.toolCalls and metrics.tokens are already
  // the grand totals. But we still calculate here as a fallback.
  const accumulatedToolCalls = (metrics.toolCalls || 0);
  const accumulatedTokens = (metrics.tokens || 0);
  const accumulatedCost = metrics.cost || "0";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
      {/* SECTION 1: METRICS GRID — accumulated data */}
      <div>
        <SectionHeader icon={<Layers size={12} />} title="Session Metrics" />
        <div style={{
          display: "grid",
          gridTemplateColumns: activeSubagentCount > 0 ? "1fr 1fr" : "1fr 1fr 1fr",
          gap: "10px"
        }}>
          <MetricCard
            label={<span style={{ display: "flex", alignItems: "center", gap: "4px" }}><Cpu size={10} /> Token Volume</span>}
            value={`${accumulatedTokens.toLocaleString()} tkn`}
          />
          <MetricCard
            label={<span style={{ display: "flex", alignItems: "center", gap: "4px" }}><Activity size={10} /> Tool Calls</span>}
            value={`${accumulatedToolCalls} calls`}
          />
          <MetricCard
            label={<span style={{ display: "flex", alignItems: "center", gap: "4px" }}><DollarSign size={10} /> Est. Cost</span>}
            value={`$${accumulatedCost}`}
            color="#34d399"
          />
          {activeSubagentCount > 0 && (
            <MetricCard
              label={<span style={{ display: "flex", alignItems: "center", gap: "4px" }}><GitBranch size={10} /> Active Subagents</span>}
              value={`${activeSubagentCount} running`}
              color="#60a5fa"
            />
          )}
        </div>
      </div>

      {/* SECTION 2: SUBAGENT TABS — each subagent has its own tab */}
      {metrics.activeSubagents && metrics.activeSubagents.length > 0 && (
        <div>
          <SectionHeader icon={<GitBranch size={12} />} title="Subagent Orchestration" />
          
          {/* Subagent tab bar */}
          <div style={{
            display: "flex",
            gap: "4px",
            marginBottom: "8px",
            flexWrap: "wrap"
          }}>
            <button
              onClick={() => setActiveSubagentTab("all")}
              style={{
                padding: "4px 10px",
                fontSize: "0.7rem",
                fontWeight: "600",
                borderRadius: "6px",
                background: activeSubagentTab === "all" ? "rgba(59, 130, 246, 0.15)" : "rgba(255,255,255,0.03)",
                border: activeSubagentTab === "all" ? "1px solid rgba(59, 130, 246, 0.3)" : "1px solid var(--border-color)",
                color: activeSubagentTab === "all" ? "#60a5fa" : "var(--text-muted)",
                cursor: "pointer",
                transition: "all 0.12s ease"
              }}
            >
              All ({metrics.activeSubagents.length})
            </button>
            {metrics.activeSubagents.map((sa, i) => {
              const saStatus = sa.status || "idle";
              const saStateColor = saStatus === "working" || saStatus === "active" ? "#3b82f6" :
                saStatus === "blocked" ? "#f59e0b" :
                saStatus === "completed" ? "#10b981" :
                saStatus === "failed" ? "#ef4444" : "#71717a";
              return (
                <button
                  key={i}
                  onClick={() => setActiveSubagentTab(sa.name)}
                  style={{
                    padding: "4px 10px",
                    fontSize: "0.7rem",
                    fontWeight: "600",
                    borderRadius: "6px",
                    background: activeSubagentTab === sa.name ? 
                      `${saStateColor}20` : 
                      "rgba(255,255,255,0.03)",
                    border: activeSubagentTab === sa.name ? 
                      `1px solid ${saStateColor}50` :
                      "1px solid var(--border-color)",
                    color: activeSubagentTab === sa.name ? 
                      saStateColor : 
                      "var(--text-muted)",
                    cursor: "pointer",
                    transition: "all 0.12s ease",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px"
                  }}
                >
                  <span style={{
                    width: "4px", height: "4px", borderRadius: "50%",
                    background: saStateColor,
                    display: "inline-block"
                  }} />
                  {sa.name.length > 15 ? sa.name.substring(0, 15) + "..." : sa.name}
                </button>
              );
            })}
          </div>

          {/* Active subagent content */}
          <div style={{
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            maxHeight: "200px",
            overflowY: "auto",
            paddingRight: "4px",
          }}>
            {displayedSubagents.length === 0 ? (
              <div style={{ fontSize: "0.75rem", color: "var(--text-dark)", fontStyle: "italic" }}>
                No subagents match this filter.
              </div>
            ) : (
              displayedSubagents.map((sa, i) => (
                <SubagentPanel key={i} subagent={sa} />
              ))
            )}
          </div>
        </div>
      )}

      {/* SECTION 3: CHRONOLOGICAL ACTION TIMELINE */}
      <div>
        <SectionHeader icon={<List size={12} />} title="Action Feed" />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            maxHeight: "160px",
            overflowY: "auto",
            paddingRight: "4px",
          }}
        >
          {(!metrics.actionFeed || metrics.actionFeed.length === 0) ? (
            <div
              style={{
                fontSize: "0.75rem",
                color: "var(--text-dark)",
                fontStyle: "italic",
              }}
            >
              Waiting for tool activities...
            </div>
          ) : (
            metrics.actionFeed.map((feed, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  background: "rgba(0,0,0,0.15)",
                  borderLeft:
                    feed.type === "start"
                      ? "2px solid var(--warning)"
                      : "2px solid var(--success)",
                  padding: "6px 10px",
                  borderRadius: "0 6px 6px 0",
                  fontSize: "0.75rem",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: "2px",
                  }}
                >
                  <span style={{ color: "var(--text-main)", fontWeight: "500" }}>
                    {feed.text}
                  </span>
                  <span style={{ fontSize: "0.65rem", color: "var(--text-dark)" }}>
                    {feed.timestamp}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: "0.65rem",
                    color: feed.type === "start" ? "var(--warning)" : "var(--success)",
                  }}
                >
                  {feed.type === "start"
                    ? "Executing..."
                    : `Completed at ${feed.timestampEnd}`}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* SECTION 4: APPROVAL GUARD — functional value with action buttons */}
      <div>
        <SectionHeader icon={<Shield size={12} />} title="Approval Guard" />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            maxHeight: "200px",
            overflowY: "auto",
          }}
        >
          {(!approvalsHistory || approvalsHistory.length === 0) ? (
            <div
              style={{
                fontSize: "0.75rem",
                color: "var(--text-dark)",
                fontStyle: "italic",
                padding: "12px",
                textAlign: "center",
                background: "rgba(0,0,0,0.1)",
                borderRadius: "8px",
                border: "1px dashed var(--border-color)"
              }}
            >
              <UserCheck size={16} style={{ marginBottom: "4px", opacity: 0.5 }} />
              <div>No approvals requested yet.</div>
              <div style={{ fontSize: "0.65rem", marginTop: "4px" }}>
                When the agent needs to execute a command, you'll be prompted here to approve or deny it.
              </div>
            </div>
          ) : (
            approvalsHistory.map((app, i) => {
              const statusColor =
                app.status === "approved"
                  ? "#10b981"
                  : app.status === "denied"
                  ? "#ef4444"
                  : app.status === "pending"
                  ? "#f59e0b"
                  : "#71717a";
              const statusBg =
                app.status === "approved"
                  ? "rgba(16, 185, 129, 0.12)"
                  : app.status === "denied"
                  ? "rgba(239, 68, 68, 0.12)"
                  : app.status === "pending"
                  ? "rgba(245, 158, 11, 0.12)"
                  : "rgba(113, 113, 122, 0.12)";

              return (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    background: "rgba(0,0,0,0.15)",
                    border: `1px solid ${statusColor}22`,
                    padding: "8px 10px",
                    borderRadius: "8px",
                    fontSize: "0.75rem",
                    transition: "all 0.12s ease"
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: "6px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span
                        style={{
                          fontSize: "0.65rem",
                          padding: "2px 8px",
                          borderRadius: "10px",
                          fontWeight: "600",
                          background: statusBg,
                          color: statusColor,
                          textTransform: "uppercase"
                        }}
                      >
                        {app.status === "pending" ? "⏳ Pending" : app.status === "approved" ? "✅ Approved" : "❌ Denied"}
                      </span>
                      {app.resolvedBy && (
                        <span style={{ fontSize: "0.6rem", color: "var(--text-dark)" }}>
                          by {app.resolvedBy}
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: "0.65rem", color: "var(--text-dark)" }}>
                      {app.time}
                    </span>
                  </div>
                  <div
                    style={{
                      fontFamily: "monospace",
                      fontSize: "0.7rem",
                      background: "rgba(0,0,0,0.2)",
                      padding: "5px 8px",
                      borderRadius: "4px",
                      overflowX: "auto",
                      color: app.status === "denied" ? "#f87171" : "var(--text-main)"
                    }}
                  >
                    {app.command}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
