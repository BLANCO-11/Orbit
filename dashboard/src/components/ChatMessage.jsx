"use client";

import React, { useState } from "react";
import ToolCallCard from "./ToolCallCard";
import { ChevronDown, ChevronRight, Loader2, CheckCircle2 } from "lucide-react";

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
 * ChatMessage — Single chat message bubble
 */
export default function ChatMessage({ message, renderMarkdown, expandedTools, toggleTool, getToolSummary, getToolOutput }) {
  const isUser = message.role === "user";

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

      {/* Accordion grouping all tool calls in the turn */}
      {message.tools && message.tools.length > 0 && (
        <ToolGroupAccordion
          tools={message.tools}
          expandedTools={expandedTools}
          toggleTool={toggleTool}
          getToolSummary={getToolSummary}
          getToolOutput={getToolOutput}
        />
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
