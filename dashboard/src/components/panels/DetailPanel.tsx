// @ts-nocheck
'use client';

import React from 'react';
import { Activity, Folder, GitBranch, List, Settings } from 'lucide-react';

const TABS = [
  { id: 'agent', label: 'Agent', icon: Activity },
  { id: 'workspace', label: 'Workspace', icon: Folder },
  { id: 'plan', label: 'Plan', icon: GitBranch },
  { id: 'logs', label: 'Logs', icon: List },
  { id: 'settings', label: 'Settings', icon: Settings },
];

/**
 * DetailPanel — inspector tab strip: Agent | Workspace | Plan | Logs | Settings
 */
export default function DetailPanel({ activeTab, onTabChange, children }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-border-soft px-3">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 pb-[11px] pt-3 text-[12.5px] transition-colors ${
                isActive
                  ? 'border-primary font-semibold text-foreground'
                  : 'border-transparent font-medium text-faint hover:text-foreground'
              }`}
            >
              <Icon size={13} />
              {tab.label}
            </button>
          );
        })}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
}
