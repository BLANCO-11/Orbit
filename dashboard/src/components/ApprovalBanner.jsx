"use client";

import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ShieldCheck } from "lucide-react";

export default function ApprovalBanner({ approvalRequest, onApprove, onDeny }) {
  if (!approvalRequest) return null;

  return (
    <Card
      style={{
        marginBottom: "16px",
        borderColor: "var(--warning)",
        background: "rgba(245, 158, 11, 0.08)",
      }}
    >
      <CardContent style={{ padding: "16px" }}>
        <h4
          style={{
            color: "var(--warning)",
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
            border: "1px solid var(--border-muted)",
          }}
        >
          {approvalRequest.command}
        </p>
        <div style={{ display: "flex", gap: "8px" }}>
          <Button
            onClick={onApprove}
            style={{ background: "var(--success)" }}
            size="sm"
          >
            <ShieldCheck size={14} /> Approve
          </Button>
          <Button onClick={onDeny} variant="destructive" size="sm">
            Deny
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
