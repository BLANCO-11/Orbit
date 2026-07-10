// @ts-nocheck
'use client';

import React from 'react';

/**
 * Sidebar — Wrapper for left sidebar content (session list, etc.)
 * Just provides consistent padding and structure.
 */
export default function Sidebar({ children, className = '', style = {} }) {
  return (
    <div
      className={`sidebar-panel ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}
