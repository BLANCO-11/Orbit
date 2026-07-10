// @ts-nocheck
'use client';

import React from 'react';
import { GitBranch, Terminal, Activity, Settings2 } from 'lucide-react';

const TABS = [
  { id: 'roadmap', label: 'Reasoning', icon: GitBranch },
  { id: 'console', label: 'Console', icon: Terminal },
  { id: 'control_panel', label: 'Health', icon: Activity },
  { id: 'settings', label: 'Settings', icon: Settings2 },
];

/**
 * RightPanelShell — Tabbed right panel wrapper
 *
 * Props:
 *   activeTab — current tab id
 *   onTabChange — (tabId: string) => void
 *   children — content for the active tab
 *   show — whether the panel should be visible (for responsive toggling)
 */
export default function RightPanelShell({
  activeTab,
  onTabChange,
  children,
  show = true,
}) {
  if (!show) return null;

  return (
    <aside
      className="right-panel"
      style={{ padding: 0 }}
    >
      {/* ── Tab Switcher (Apple Segmented Control Style) ── */}
      <div
        style={{
          display: 'flex',
          background: 'var(--surface-secondary)',
          borderBottom: '1px solid var(--border-subtle)',
          padding: '6px 8px',
          gap: '2px',
          flexShrink: 0,
        }}
      >
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className="interactive-base focus-ring"
              style={{
                flex: 1,
                padding: '6px 4px',
                fontSize: '0.72rem',
                fontWeight: isActive ? '600' : '500',
                background: isActive ? 'var(--surface-elevated)' : 'transparent',
                border: 'none',
                boxShadow: isActive ? '0 1px 3px rgba(0, 0, 0, 0.15)' : 'none',
                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                borderRadius: 'var(--radius-sm)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '5px',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s var(--ease-out-expo)',
              }}
            >
              <Icon size={11} style={{ opacity: isActive ? 1 : 0.8 }} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* ── Tab Content ── */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 'var(--space-5)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-5)',
        }}
      >
        {children}
      </div>
    </aside>
  );
}
