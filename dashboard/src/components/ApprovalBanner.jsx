"use client";

import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ShieldCheck, Shield, ShieldOff, ExternalLink } from "lucide-react";

export default function ApprovalBanner({ approvalRequest, onApprove, onDeny }) {
  if (!approvalRequest) return null;

  // Edit mode directory permission request
  if (approvalRequest.type === "edit_permission") {
    return (
      <Card
        style={{
          marginBottom: "16px",
          borderColor: "var(--accent-warning)",
          background: "rgba(59, 130, 246, 0.08)",
        }}
      >
        <CardContent style={{ padding: "16px" }}>
          <h4
            style={{
              color: "#60a5fa",
              marginBottom: "8px",
              fontSize: "0.95rem",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <Shield size={16} /> Directory Access Outside Safe Zone
          </h4>
          <p style={{ fontSize: "0.85rem", marginBottom: "8px", color: "var(--text-secondary)" }}>
            The agent is in <strong style={{ color: "#fbbf24" }}>Edit</strong> mode and wants to access a path outside the project directory.
          </p>
          <div style={{
            fontFamily: "monospace",
            fontSize: "0.85rem",
            background: "rgba(0,0,0,0.5)",
            padding: "10px",
            borderRadius: "6px",
            marginBottom: "8px",
            border: "1px solid var(--border-subtle)",
          }}>
            <div style={{ color: "#fbbf24", marginBottom: "4px" }}>
              <ExternalLink size={12} style={{ marginRight: "4px" }} />
              Tool: {approvalRequest.toolName}
            </div>
            <div style={{ color: "var(--text-primary)" }}>
              Path(s): {(approvalRequest.paths || []).join(", ")}
            </div>
            <div style={{ color: "var(--text-secondary)", fontSize: "0.75rem", marginTop: "4px" }}>
              Safe zone: {approvalRequest.safeZone}
            </div>
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <Button
              onClick={() => onApprove("allow_once")}
              style={{ background: "#2563eb" }}
              size="sm"
            >
              <ShieldCheck size={14} /> Allow Once
            </Button>
            <Button
              onClick={() => onApprove("allow_session")}
              style={{ background: "#059669" }}
              size="sm"
            >
              <Shield size={14} /> Allow for Session
            </Button>
            <Button
              onClick={() => onApprove("deny")}
              style={{ background: "#dc2626" }}
              size="sm"
              variant="destructive"
            >
              <ShieldOff size={14} /> Deny
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Standard approval (plan mode command execution)
  return (
    <Card
      style={{
        marginBottom: "16px",
        borderColor: "var(--accent-warning)",
        background: "rgba(245, 158, 11, 0.08)",
      }}
    >
      <CardContent style={{ padding: "16px" }}>
        <h4
          style={{
            color: "var(--accent-warning)",
            marginBottom: "8px",
            fontSize: "0.95rem",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <AlertTriangle size={16} /> Command Execution Requested
        </h4>
        <p
          style={{
            fontFamily: "monospace",
            fontSize: "0.85rem",
            background: "rgba(0,0,0,0.5)",
            padding: "10px",
            borderRadius: "6px",
            marginBottom: "12px",
            border: "1px solid var(--border-subtle)",
          }}
        >
          {approvalRequest.command}
        </p>
        <div style={{ display: "flex", gap: "8px" }}>
          <Button
            onClick={() => onApprove(true)}
            style={{ background: "var(--accent-success)" }}
            size="sm"
          >
            <ShieldCheck size={14} /> Approve
          </Button>
          <Button onClick={() => onDeny()} variant="destructive" size="sm">
            Deny
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
