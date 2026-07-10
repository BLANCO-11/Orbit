"use client";

import React, { useState } from "react";
import ToolCallCard from "./ToolCallCard";
import { ChevronDown, ChevronRight, Loader2, CheckCircle2, Shield, Edit3, Zap, Play, Check, MessageSquare } from "lucide-react";

/**
 * getAgentActivityText — Returns human-readable explanation of what the agent is currently doing
 */
function getAgentActivityText(tool) {
  if (!tool) return "Thinking...";
  const name = tool.name;
  const args = tool.arguments || {};
  
  const getBasename = (pathStr) => {
    if (!pathStr) return "";
    return pathStr.split(/[/\\]/).pop();
  };

  switch (name) {
    case "view_file":
    case "read_file": {
      const file = getBasename(args.AbsolutePath || args.path || args.TargetFile);
      return `Reading the file ${file ? `"${file}"` : "content"}`;
    }
    case "write_to_file":
    case "replace_file_content":
    case "multi_replace_file_content": {
      const file = getBasename(args.TargetFile || args.AbsolutePath || args.path);
      return `Editing the file ${file ? `"${file}"` : "content"}`;
    }
    case "run_command": {
      const cmd = args.CommandLine || "";
      const truncatedCmd = cmd.length > 40 ? cmd.substring(0, 40) + "..." : cmd;
      return `Running command "${truncatedCmd}"`;
    }
    case "grep_search": {
      const query = args.Query || "";
      return `Searching codebase for "${query}"`;
    }
    case "search_web": {
      const query = args.query || "";
      return `Searching the web for "${query}"`;
    }
    case "list_dir": {
      const dir = getBasename(args.DirectoryPath);
      return `Analyzing directory ${dir ? `"${dir}"` : ""}`;
    }
    case "invoke_subagent": {
      const sub = args.Subagents?.[0]?.Role || "subagent";
      return `Spawning subagent: ${sub}`;
    }
    case "ask_permission": {
      return `Requesting permission for "${args.Action}"`;
    }
    default:
      return `Running ${name} tool`;
  }
}

/**
 * ToolGroupAccordion — Groups multiple tool executions into a single, neat collapsible accordion
 */
function ToolGroupAccordion({ tools, expandedTools, toggleTool, getToolSummary, getToolOutput }) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const runningTools = tools.filter(t => t.status === "running");
  const isRunning = runningTools.length > 0;
  const totalCalls = tools.length;
  
  // Extract unique tool names (e.g. bash, read_file) to show in status summary
  const uniqueNames = tools
    .map(t => t.name)
    .filter((value, index, self) => self.indexOf(value) === index)
    .join(", ");

  return (
    <div style={{
      width: "100%",
      maxWidth: "600px",
      border: "1px solid var(--border-color)",
      borderRadius: "8px",
      background: "rgba(0, 0, 0, 0.15)",
      marginTop: "8px",
      marginLeft: "14px",
      overflow: "hidden",
      fontSize: "0.8rem"
    }}>
      {/* Header Accordion Click Area */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          cursor: "pointer",
          userSelect: "none",
          background: "rgba(255, 255, 255, 0.015)",
          transition: "background 0.15s ease"
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255, 255, 255, 0.04)"}
        onMouseLeave={(e) => e.currentTarget.style.background = "rgba(255, 255, 255, 0.015)"}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: "1", overflow: "hidden" }}>
          {isRunning ? (
            <Loader2 className="animate-spin" style={{ width: "13px", height: "13px", color: "var(--warning)", flexShrink: 0 }} />
          ) : (
            <CheckCircle2 style={{ width: "13px", height: "13px", color: "var(--success)", flexShrink: 0 }} />
          )}
          
          <span style={{ fontWeight: "600", color: "var(--text-main)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {isRunning 
              ? getAgentActivityText(runningTools[runningTools.length - 1])
              : `Ran ${totalCalls} command${totalCalls > 1 ? "s" : ""}`
            }
          </span>

          <span style={{ fontSize: "0.7rem", color: "var(--text-dark)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            ({uniqueNames})
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "4px", color: "var(--text-muted)", marginLeft: "8px" }}>
          <span style={{ fontSize: "0.7rem" }}>{isExpanded ? "Collapse" : "Details"}</span>
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
      </div>

      {/* Nested Expanded Tool List */}
      {isExpanded && (
        <div style={{
          padding: "10px",
          borderTop: "1px solid var(--border-color)",
          background: "rgba(0, 0, 0, 0.2)",
          display: "flex",
          flexDirection: "column",
          gap: "8px"
        }}>
          {tools.map((tool) => (
            <ToolCallCard
              key={tool.id}
              tool={tool}
              isExpanded={!!expandedTools[tool.id]}
              onToggle={() => toggleTool(tool.id)}
              getToolSummary={getToolSummary}
              getToolOutput={getToolOutput}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * ModeSuggestionAccordion — Shows when agent suggests switching mode.
 */
function ModeSuggestionAccordion({ message, currentMode, onSetSessionMode, onSetSessionModeAndReRun }) {
  const [isExpanded, setIsExpanded] = useState(true);
  
  const modesInfo = {
    chat: { id: "", label: "Chat Mode", desc: "Free conversation only", icon: MessageSquare, color: "#a1a1aa" },
    plan: { id: "plan", label: "Plan Mode", desc: "Plan then approve", icon: Shield, color: "#3b82f6" },
    edit: { id: "edit", label: "Edit Mode", desc: "Read free, write needs ok", icon: Edit3, color: "#fbbf24" },
    yolo: { id: "yolo", label: "YOLO Mode", desc: "Full autonomous execution", icon: Zap, color: "#ef4444" }
  };
  
  const suggestedKey = message.suggestedMode || "plan";
  const suggested = modesInfo[suggestedKey] || modesInfo.plan;
  const currentKey = currentMode || "chat";
  const current = modesInfo[currentKey] || modesInfo.chat;
  
  return (
    <div style={{
      width: "100%",
      maxWidth: "600px",
      border: "1px solid rgba(245, 158, 11, 0.35)",
      borderRadius: "8px",
      background: "rgba(245, 158, 11, 0.03)",
      marginTop: "8px",
      overflow: "hidden",
      fontSize: "0.82rem",
      boxShadow: "0 4px 20px rgba(0, 0, 0, 0.25)"
    }}>
      {/* Header */}
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          cursor: "pointer",
          userSelect: "none",
          background: "rgba(245, 158, 11, 0.08)",
          borderBottom: isExpanded ? "1px solid rgba(245, 158, 11, 0.15)" : "none",
          transition: "background 0.15s ease"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#fbbf24", fontWeight: "600" }}>
          <Shield size={16} />
          <span>Action Paused: Mode Change Suggested</span>
        </div>
        <div style={{ color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "4px" }}>
          <span style={{ fontSize: "0.7rem" }}>{isExpanded ? "Collapse" : "Expand"}</span>
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
      </div>
      
      {/* Content */}
      {isExpanded && (
        <div style={{ padding: "14px", display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ color: "var(--text-main)", lineHeight: "1.45" }}>
            {message.reason || "The agent needs a different mode to perform this action."}
          </div>
          
          <div style={{
            background: "rgba(0,0,0,0.2)",
            padding: "8px 12px",
            borderRadius: "6px",
            border: "1px solid var(--border-color)",
            display: "flex",
            flexDirection: "column",
            gap: "2px"
          }}>
            <div style={{ fontSize: "0.68rem", color: "var(--text-dark)", fontWeight: "700", letterSpacing: "0.5px" }}>CURRENT MODE</div>
            <div style={{ fontWeight: "700", color: current.color, display: "flex", alignItems: "center", gap: "6px" }}>
              {React.createElement(current.icon, { size: 14 })}
              <span>{current.label.toUpperCase()}</span>
              <span style={{ fontWeight: "400", color: "var(--text-muted)", fontSize: "0.75rem" }}>— {current.desc}</span>
            </div>
          </div>
          
          <div style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            marginTop: "4px"
          }}>
            <div style={{ fontSize: "0.7rem", fontWeight: "600", color: "var(--text-muted)" }}>SELECT NEW MODE TO PROCEED:</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {Object.entries(modesInfo).map(([key, mInfo]) => {
                const isCurrent = currentKey === key;
                const isSuggested = suggestedKey === key;
                
                return (
                  <div 
                    key={key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "8px 12px",
                      borderRadius: "6px",
                      background: isCurrent 
                        ? "rgba(255,255,255,0.03)" 
                        : isSuggested 
                          ? "rgba(245, 158, 11, 0.05)" 
                          : "rgba(255,255,255,0.01)",
                      border: isCurrent
                        ? "1px solid rgba(255,255,255,0.1)"
                        : isSuggested
                          ? "1px solid rgba(245, 158, 11, 0.3)"
                          : "1px solid var(--border-color)",
                      opacity: isCurrent ? 0.6 : 1,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      {React.createElement(mInfo.icon, { size: 16, style: { color: mInfo.color } })}
                      <div>
                        <div style={{ fontWeight: "700", color: isCurrent ? "var(--text-muted)" : "var(--text-main)" }}>
                          {mInfo.label} {isSuggested && <span style={{ fontSize: "0.65rem", color: "#fbbf24", background: "rgba(245,158,11,0.15)", padding: "1px 4px", borderRadius: "4px", marginLeft: "4px" }}>SUGGESTED</span>}
                        </div>
                        <div style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>{mInfo.desc}</div>
                      </div>
                    </div>
                    
                    <div style={{ display: "flex", gap: "6px" }}>
                      {isCurrent ? (
                        <div style={{ display: "flex", alignItems: "center", gap: "4px", color: "var(--text-muted)", fontSize: "0.75rem", fontWeight: "600" }}>
                          <Check size={14} style={{ color: "var(--success)" }} /> Active
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={() => onSetSessionMode(mInfo.id)}
                            style={{
                              padding: "4px 8px",
                              borderRadius: "4px",
                              border: "1px solid var(--border-color)",
                              background: "rgba(255,255,255,0.05)",
                              color: "var(--text-main)",
                              fontSize: "0.72rem",
                              cursor: "pointer",
                              transition: "all 0.1s ease"
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.1)"}
                            onMouseLeave={e => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                          >
                            Switch Only
                          </button>
                          {onSetSessionModeAndReRun && (
                            <button
                              onClick={() => onSetSessionModeAndReRun(mInfo.id)}
                              style={{
                                padding: "4px 10px",
                                borderRadius: "4px",
                                border: isSuggested ? "1px solid #fbbf24" : "1px solid var(--primary)",
                                background: isSuggested ? "rgba(245, 158, 11, 0.25)" : "var(--primary)",
                                color: isSuggested ? "#fbbf24" : "var(--primary-foreground)",
                                fontSize: "0.72rem",
                                fontWeight: "600",
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                gap: "4px",
                                transition: "all 0.1s ease"
                              }}
                              onMouseEnter={e => e.currentTarget.style.background = isSuggested ? "rgba(245, 158, 11, 0.35)" : "var(--primary-hover)"}
                              onMouseLeave={e => e.currentTarget.style.background = isSuggested ? "rgba(245, 158, 11, 0.25)" : "var(--primary)"}
                            >
                              <Play size={10} fill="currentColor" /> Switch & Re-run
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * ChatMessage — Single chat message bubble
 */
export default function ChatMessage({ message, renderMarkdown, expandedTools, toggleTool, getToolSummary, getToolOutput, onSetSessionMode, onSetSessionModeAndReRun, sessionMode }) {
  const isUser = message.role === "user";

  if (message.isModeSuggestion) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          width: "100%",
          marginBottom: "8px"
        }}
      >
        <ModeSuggestionAccordion
          message={message}
          currentMode={sessionMode}
          onSetSessionMode={onSetSessionMode}
          onSetSessionModeAndReRun={onSetSessionModeAndReRun}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
        width: "100%"
      }}
    >
      <div style={{
        background: isUser ? "var(--primary)" : "var(--input-bg)",
        padding: "10px 14px",
        borderRadius: isUser ? "14px 14px 2px 14px" : "14px 14px 14px 2px",
        maxWidth: "85%",
        fontSize: "0.9rem",
        border: isUser ? "none" : "1px solid var(--border-color)",
        color: isUser ? "var(--primary-foreground)" : "var(--text-main)",
        boxShadow: isUser ? "0 4px 12px var(--primary-glow)" : "none",
        width: "fit-content"
      }}>
        {isUser ? (
          <div style={{ whiteSpace: "pre-wrap" }}>{message.content}</div>
        ) : (
          <div
            className="markdown-content"
            dangerouslySetInnerHTML={renderMarkdown(message.content)}
          />
        )}
      </div>

      {/* Latency display */}
      {!isUser && message.latency && (
        <div style={{
          fontSize: "0.72rem",
          color: "var(--text-muted)",
          marginTop: "4px",
          marginLeft: "8px",
          fontStyle: "italic",
          opacity: 0.8
        }}>
          Latency: {message.latency}s
        </div>
      )}

      {/* Accordion grouping all tool calls in the turn — each on a new line */}
      {message.tools && message.tools.length > 0 && (
        <div className="tool-call-separator" style={{ width: "100%", maxWidth: "600px", marginLeft: "14px" }}>
          <ToolGroupAccordion
            tools={message.tools}
            expandedTools={expandedTools}
            toggleTool={toggleTool}
            getToolSummary={getToolSummary}
            getToolOutput={getToolOutput}
          />
        </div>
      )}
    </div>
  );
}

/**
 * ChatEmptyState — Empty-state placeholder shown when there are no messages
 */
export function ChatEmptyState() {
  return (
    <div style={{ margin: "100px auto", textAlign: "center", color: "var(--text-muted)", maxWidth: "380px" }}>
      <h3 style={{ color: "#fff", marginBottom: "8px", fontWeight: "600" }}>AegisAgent Active</h3>
      <p style={{ fontSize: "0.85rem" }}>
        Speak or type to delegate OS operations, write code, run audits, or browse web applications.
      </p>
    </div>
  );
}
