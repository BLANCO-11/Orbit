"use client";

import React from "react";
import { Loader2 } from "lucide-react";

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
      }}
    >
      {icon} {title}
    </div>
  );
}

export default function MetricsPanel({ metrics, status, approvalsHistory }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
      {/* SECTION 1: METRICS GRID */}
      <div>
        <SectionHeader icon="📊" title="Session Metrics" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
          <MetricCard
            label="⏱️ Turn Latency"
            value={
              status === "thinking" || status === "executing" ? (
                <span
                  style={{
                    color: "var(--warning)",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <Loader2 className="animate-spin" style={{ width: "12px", height: "12px" }} />{" "}
                  Calculating
                </span>
              ) : (
                `${metrics.latency}s`
              )
            }
          />
          <MetricCard
            label="🔧 Tool Calls"
            value={`${metrics.toolCalls} calls`}
          />
          <MetricCard
            label="🪙 Token Volume"
            value={`${(metrics.tokens || 0).toLocaleString()} tkn`}
          />
          <MetricCard
            label="💸 Est. Session Cost"
            value={`$${metrics.cost}`}
            color="#34d399"
          />
        </div>
      </div>

      {/* SECTION 2: ACTIVE ORCHESTRATION (SUBAGENTS) */}
      <div>
        <SectionHeader icon="🤖" title="Subagent Orchestration" />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            maxHeight: "150px",
            overflowY: "auto",
          }}
        >
          {(!metrics.activeSubagents || metrics.activeSubagents.length === 0) ? (
            <div
              style={{
                fontSize: "0.75rem",
                color: "var(--text-dark)",
                fontStyle: "italic",
              }}
            >
              No subagents spawned in this session.
            </div>
          ) : (
            metrics.activeSubagents.map((sa, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background:
                    sa.status === "active"
                      ? "rgba(59, 130, 246, 0.05)"
                      : "rgba(255,255,255,0.01)",
                  border:
                    sa.status === "active"
                      ? "1px solid rgba(59, 130, 246, 0.2)"
                      : "1px solid var(--border-muted)",
                  padding: "6px 10px",
                  borderRadius: "6px",
                  fontSize: "0.75rem",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span
                    style={{
                      width: "6px",
                      height: "6px",
                      borderRadius: "50%",
                      background:
                        sa.status === "active" ? "#3b82f6" : "var(--text-dark)",
                      boxShadow:
                        sa.status === "active" ? "0 0 8px #3b82f6" : "none",
                    }}
                  />
                  <span
                    style={{
                      fontWeight: sa.status === "active" ? "600" : "400",
                      color:
                        sa.status === "active" ? "#fff" : "var(--text-main)",
                    }}
                  >
                    {sa.name}
                  </span>
                </div>
                <span style={{ fontSize: "0.7rem", color: "var(--text-dark)" }}>
                  {sa.status === "active"
                    ? `Started ${sa.time}`
                    : `Exited ${sa.timeEnd || sa.time}`}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* SECTION 3: CHRONOLOGICAL ACTION TIMELINE */}
      <div>
        <SectionHeader icon="📜" title="Chronological Action Feed" />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            maxHeight: "180px",
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

      {/* SECTION 4: APPROVAL DECISION QUEUE */}
      <div>
        <SectionHeader icon="🛡️" title="Approval Guard History" />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            maxHeight: "150px",
            overflowY: "auto",
          }}
        >
          {(!approvalsHistory || approvalsHistory.length === 0) ? (
            <div
              style={{
                fontSize: "0.75rem",
                color: "var(--text-dark)",
                fontStyle: "italic",
              }}
            >
              No HITL approval actions taken.
            </div>
          ) : (
            approvalsHistory.map((app, i) => {
              const statusColor =
                app.status === "approved"
                  ? "#34d399"
                  : app.status === "denied"
                  ? "#f87171"
                  : "#fbbf24";
              const statusBg =
                app.status === "approved"
                  ? "rgba(52, 211, 153, 0.15)"
                  : app.status === "denied"
                  ? "rgba(239, 68, 68, 0.15)"
                  : "rgba(245, 158, 11, 0.15)";

              return (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    background: "rgba(0,0,0,0.15)",
                    border: "1px solid var(--border-color)",
                    padding: "6px 10px",
                    borderRadius: "6px",
                    fontSize: "0.75rem",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: "4px",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "0.65rem",
                        padding: "2px 6px",
                        borderRadius: "4px",
                        fontWeight: "600",
                        background: statusBg,
                        color: statusColor,
                      }}
                    >
                      {app.status.toUpperCase()}
                    </span>
                    <span style={{ fontSize: "0.65rem", color: "var(--text-dark)" }}>
                      {app.time}
                    </span>
                  </div>
                  <div
                    style={{
                      fontFamily: "monospace",
                      fontSize: "0.7rem",
                      background: "rgba(0,0,0,0.2)",
                      padding: "4px 6px",
                      borderRadius: "4px",
                      overflowX: "auto",
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
