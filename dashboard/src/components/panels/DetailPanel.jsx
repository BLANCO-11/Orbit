'use client';

import React from 'react';
import { Activity, Folder, GitBranch, List, Settings } from 'lucide-react';

/**
 * DetailPanel — Tabbed right panel with: Agent | Workspace | Plan | Logs | Settings
 */
export default function DetailPanel({ activeTab, onTabChange, children }) {
  const tabs = [
    { id: 'agent', label: 'Agent', icon: <Activity size={13} /> },
    { id: 'workspace', label: 'Workspace', icon: <Folder size={13} /> },
    { id: 'plan', label: 'Plan', icon: <GitBranch size={13} /> },
    { id: 'logs', label: 'Logs', icon: <List size={13} /> },
    { id: 'settings', label: 'Settings', icon: <Settings size={13} /> },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex', borderBottom: '1px solid var(--border-subtle)',
        padding: '0 var(--space-3)', flexShrink: 0,
      }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              padding: '10px 14px', fontSize: '0.75rem', fontWeight: '500',
              color: activeTab === tab.id ? 'var(--text-primary)' : 'var(--text-tertiary)',
              borderBottom: activeTab === tab.id ? '2px solid var(--accent-primary)' : '2px solid transparent',
              background: 'none', borderTop: 'none', borderLeft: 'none', borderRight: 'none',
              cursor: 'pointer', transition: 'color 0.15s ease, border-color 0.15s ease',
              whiteSpace: 'nowrap',
            }}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
    </div>
  );
}
