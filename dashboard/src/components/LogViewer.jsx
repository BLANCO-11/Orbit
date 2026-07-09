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
              color: "var(--text-dark)",
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
                ? "var(--danger)"
                : log.isSystem
                ? "var(--text-muted)"
                : "var(--text-main)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            <span style={{ color: "var(--text-dark)", marginRight: "6px" }}>
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
