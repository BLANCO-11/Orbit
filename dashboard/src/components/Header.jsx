"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, Settings } from "lucide-react";

export default function Header({
  status,
  getStatusColor,
  showThinking,
  onToggleThinking,
  showSettings,
  onToggleSettings
}) {
  return (
    <header className="app-header">
      <div className="logo-container">
        <div className="logo-glow"></div>
        <span className="logo-text">AegisAgent OS Assistant</span>
      </div>

      {/* Central Controls using Shadcn Buttons */}
      <div style={{ display: "flex", gap: "8px" }}>
        <Button
          variant="outline"
          onClick={onToggleThinking}
          style={{ fontSize: "0.8rem", padding: "6px 12px", height: "32px" }}
        >
          {showThinking ? <EyeOff size={14} /> : <Eye size={14} />}
          {showThinking ? "Hide Logs (Chat View)" : "Show Logs (Console View)"}
        </Button>

        <Button
          variant="outline"
          onClick={onToggleSettings}
          style={{ fontSize: "0.8rem", padding: "6px 12px", height: "32px" }}
        >
          <Settings size={14} />
          {showSettings ? "Hide Settings" : "Configure Agent"}
        </Button>
      </div>

      {/* Status Indicator */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <div style={{
          width: "8px",
          height: "8px",
          borderRadius: "50%",
          backgroundColor: getStatusColor(),
          boxShadow: `0 0 8px ${getStatusColor()}`
        }}></div>
        <span style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "1px", fontWeight: "600", color: getStatusColor() }}>
          {status}
        </span>
      </div>
    </header>
  );
}
