// @ts-nocheck
"use client";

import React from "react";
import { AlertTriangle, ShieldCheck, Shield, ShieldOff, ExternalLink } from "lucide-react";

/**
 * ApprovalBanner — HITL approval cards (command execution / edit-mode path access).
 */
export default function ApprovalBanner({ approvalRequest, onApprove, onDeny }) {
  if (!approvalRequest) return null;

  // Edit-mode directory permission request
  if (approvalRequest.type === "edit_permission") {
    return (
      <div className="rounded-[11px] border border-warning/40 bg-warning/8 p-4 shadow-card">
        <h4 className="mb-1.5 flex items-center gap-1.5 text-[13.5px] font-semibold text-warning">
          <Shield size={15} /> Path outside the safe zone
        </h4>
        <p className="mb-2.5 text-[13px] text-muted-foreground">
          The agent wants to write outside its session workspace. Allow it once, for this session, or always for this folder.
        </p>
        <div className="mb-3 rounded-lg border border-border bg-background p-2.5 font-mono text-xs">
          <div className="mb-1 flex items-center gap-1.5 text-warning">
            <ExternalLink size={11} />
            {approvalRequest.toolName}
          </div>
          <div className="break-all">{(approvalRequest.paths || []).join(", ")}</div>
          <div className="mt-1 text-[11px] text-faint">Safe zone: {approvalRequest.safeZone}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onApprove("allow_once")}
            className="flex items-center gap-1.5 rounded-[9px] bg-primary px-3.5 py-[7px] text-[13px] font-semibold text-primary-foreground hover:opacity-90"
          >
            <ShieldCheck size={14} /> Allow once
          </button>
          <button
            onClick={() => onApprove("allow_session")}
            className="flex items-center gap-1.5 rounded-[9px] bg-success px-3.5 py-[7px] text-[13px] font-semibold text-success-foreground hover:opacity-90"
          >
            <Shield size={14} /> Allow for session
          </button>
          <button
            onClick={() => onApprove("allow_always")}
            title="Add this folder to the durable write allow-list (Settings → Security)"
            className="flex items-center gap-1.5 rounded-[9px] border border-success/40 bg-success/10 px-3.5 py-[7px] text-[13px] font-semibold text-success hover:bg-success/20"
          >
            <ShieldCheck size={14} /> Always allow this folder
          </button>
          <button
            onClick={() => onApprove("deny")}
            className="flex items-center gap-1.5 rounded-[9px] border border-destructive/40 bg-destructive/10 px-3.5 py-[7px] text-[13px] font-semibold text-destructive hover:bg-destructive/20"
          >
            <ShieldOff size={14} /> Deny
          </button>
        </div>
      </div>
    );
  }

  // Standard command approval
  return (
    <div className="rounded-[11px] border border-warning/40 bg-warning/8 p-4 shadow-card">
      <h4 className="mb-2 flex items-center gap-1.5 text-[13.5px] font-semibold text-warning">
        <AlertTriangle size={15} /> Command needs your approval
      </h4>
      <pre className="mb-3 overflow-x-auto rounded-lg border border-border bg-background p-2.5 font-mono text-xs">
        {approvalRequest.command}
      </pre>
      <div className="flex gap-2">
        <button
          onClick={() => onApprove(true)}
          className="flex items-center gap-1.5 rounded-[9px] bg-success px-3.5 py-[7px] text-[13px] font-semibold text-success-foreground hover:opacity-90"
        >
          <ShieldCheck size={14} /> Approve
        </button>
        <button
          onClick={() => onDeny()}
          className="flex items-center gap-1.5 rounded-[9px] border border-destructive/40 bg-destructive/10 px-3.5 py-[7px] text-[13px] font-semibold text-destructive hover:bg-destructive/20"
        >
          Deny
        </button>
      </div>
    </div>
  );
}
