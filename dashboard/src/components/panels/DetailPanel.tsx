// @ts-nocheck
'use client';

import React from 'react';
import { Activity, Folder, GitBranch, List, Settings } from 'lucide-react';

const TABS = [
  { id: 'agent', label: 'Agent', icon: <Activity size={13} /> },
  { id: 'workspace', label: 'Workspace', icon: <Folder size={13} /> },
  { id: 'plan', label: 'Plan', icon: <GitBranch size={13} /> },
  { id: 'logs', label: 'Logs', icon: <List size={13} /> },
  { id: 'settings', label: 'Settings', icon: <Settings size={13} /> },
];

/**
 * DetailPanel — Tabbed right panel with: Agent | Workspace | Plan | Logs | Settings
 */
export default function DetailPanel({ activeTab, onTabChange, children }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 border-b border-border px-3">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-xs font-medium transition-colors ${
              activeTab === tab.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>
      <div className="flex flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
}
