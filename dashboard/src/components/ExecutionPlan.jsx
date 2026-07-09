"use client";

import React from "react";
import { Loader2 } from "lucide-react";

export default function ExecutionPlan({ executionPlan }) {
  if (!executionPlan) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          color: "var(--text-muted)",
          gap: "10px",
          minHeight: "150px",
        }}
      >
        <Loader2 className="animate-spin" style={{ width: "20px", height: "20px" }} />
        <span style={{ fontSize: "0.8rem" }}>Waiting for roadmap generation...</span>
      </div>
    );
  }

  return (
    <div
      style={{
        fontSize: "0.8rem",
        color: "var(--text-main)",
        whiteSpace: "pre-wrap",
        lineHeight: "1.5",
      }}
    >
      {executionPlan}
    </div>
  );
}
