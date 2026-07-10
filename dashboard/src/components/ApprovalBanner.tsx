// @ts-nocheck
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
      <Card className="mb-4 border-warning bg-warning/5">
        <CardContent className="p-4">
          <h4 className="mb-2 flex items-center gap-1.5 text-[0.95rem] text-warning">
            <Shield size={16} /> Directory Access Outside Safe Zone
          </h4>
          <p className="mb-2 text-[0.85rem] text-muted-foreground">
            The agent is in <strong className="text-warning">Edit</strong> mode and wants to access a path outside the project directory.
          </p>
          <div className="mb-2 rounded-md border border-border bg-black/30 p-2.5 font-mono text-[0.85rem] dark:bg-black/50">
            <div className="mb-1 flex items-center gap-1 text-warning">
              <ExternalLink size={12} />
              Tool: {approvalRequest.toolName}
            </div>
            <div>Path(s): {(approvalRequest.paths || []).join(", ")}</div>
            <div className="mt-1 text-xs text-muted-foreground">Safe zone: {approvalRequest.safeZone}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => onApprove("allow_once")} size="sm">
              <ShieldCheck size={14} /> Allow Once
            </Button>
            <Button onClick={() => onApprove("allow_session")} size="sm" className="bg-success text-success-foreground hover:bg-success/80">
              <Shield size={14} /> Allow for Session
            </Button>
            <Button onClick={() => onApprove("deny")} size="sm" variant="destructive">
              <ShieldOff size={14} /> Deny
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Standard approval (plan mode command execution)
  return (
    <Card className="mb-4 border-warning bg-warning/5">
      <CardContent className="p-4">
        <h4 className="mb-2 flex items-center gap-1.5 text-[0.95rem] text-warning">
          <AlertTriangle size={16} /> Command Execution Requested
        </h4>
        <p className="mb-3 rounded-md border border-border bg-black/30 p-2.5 font-mono text-[0.85rem] dark:bg-black/50">
          {approvalRequest.command}
        </p>
        <div className="flex gap-2">
          <Button onClick={() => onApprove(true)} size="sm" className="bg-success text-success-foreground hover:bg-success/80">
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
