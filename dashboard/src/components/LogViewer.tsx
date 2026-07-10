// @ts-nocheck
"use client";

import React from "react";

export default function LogViewer({ logs, logEndRef }) {
  return (
    <div className="flex-1 overflow-y-auto p-2">
      <div className="rounded-md bg-black/5 p-1 dark:bg-black/40">
        {logs.length === 0 && (
          <span className="font-mono text-xs text-muted-foreground">No activity logs yet.</span>
        )}
        {logs.map((log, index) => (
          <div
            key={index}
            className={`whitespace-pre-wrap break-words px-1 py-px font-mono text-xs ${
              log.isError ? 'text-destructive' : log.isSystem ? 'text-muted-foreground' : ''
            }`}
          >
            <span className="mr-1.5 text-muted-foreground">[{log.timestamp}]</span>
            {log.text}
          </div>
        ))}
        <div ref={logEndRef} />
      </div>
    </div>
  );
}
