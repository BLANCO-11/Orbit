'use client';

import React from 'react';

/**
 * RightPanel — Wrapper for right sidebar content (metrics, settings)
 */
export default function RightPanel({ children, className = '', style = {} }) {
  return (
    <div
      className={`right-panel ${className}`}
      style={style}
    >
      <div style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', flex: 1 }}>
        {children}
      </div>
    </div>
  );
}
