"use client";

import React from "react";

export default function LogViewer({ logs, logEndRef }) {
  return (
    <div
      style={{
        flex: "1",
        overflowY: "auto",
        padding: "8px",
      }}
    >
      <div
        style={{
          background: "rgba(9, 9, 11, 0.4)",
          borderRadius: "var(--radius-sm)",
          padding: "4px",
        }}
      >
        {logs.length === 0 && (
          <span
            style={{
              color: "var(--text-tertiary)",
              fontSize: "0.75rem",
              fontFamily: "monospace",
            }}
          >
            No activity logs yet.
          </span>
        )}
        {logs.map((log, index) => (
          <div
            key={index}
            style={{
              fontFamily: "monospace",
              fontSize: "0.75rem",
              padding: "1px 4px",
              color: log.isError
                ? "var(--accent-danger)"
                : log.isSystem
                ? "var(--text-secondary)"
                : "var(--text-primary)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            <span style={{ color: "var(--text-tertiary)", marginRight: "6px" }}>
              [{log.timestamp}]
            </span>
            {log.text}
          </div>
        ))}
        <div ref={logEndRef} />
      </div>
    </div>
  );
}
