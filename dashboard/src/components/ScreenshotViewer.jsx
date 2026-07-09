"use client";

import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export default function ScreenshotViewer({ screenshotFile }) {
  if (!screenshotFile) return null;

  return (
    <Card
      style={{
        display: "flex",
        flexDirection: "column",
        background: "var(--panel-bg)",
        borderColor: "var(--border-color)",
      }}
    >
      <CardHeader
        style={{
          padding: "10px 16px",
          borderBottom: "1px solid var(--border-muted)",
        }}
      >
        <CardTitle
          style={{
            fontSize: "0.75rem",
            fontWeight: "600",
            color: "var(--text-muted)",
          }}
        >
          🌐 Browser Preview (Lightpanda)
        </CardTitle>
      </CardHeader>
      <CardContent
        style={{
          flex: "1",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(0,0,0,0.3)",
          padding: "12px",
          overflow: "hidden",
        }}
      >
        <img
          src={screenshotFile}
          alt="Browser Screenshot"
          style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
        />
      </CardContent>
    </Card>
  );
}
