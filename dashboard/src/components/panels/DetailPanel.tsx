'use client';

import React from 'react';
import { Activity, Folder, GitBranch, List } from 'lucide-react';

const TABS = [
  { id: 'agent', label: 'Overview', icon: Activity },
  { id: 'workspace', label: 'Workspace', icon: Folder },
  { id: 'trace', label: 'Trace', icon: GitBranch },
  { id: 'logs', label: 'Logs', icon: List },
] as const;

export type InspectorTab = (typeof TABS)[number]['id'];

interface DetailPanelProps {
  activeTab: string;
  onTabChange: (tab: InspectorTab) => void;
  children: React.ReactNode;
}

/**
 * DetailPanel — inspector segments: Overview | Workspace | Trace | Logs.
 * Settings lives on the icon rail now, not in a fifth clipped tab.
 */
export default function DetailPanel({ activeTab, onTabChange, children }: DetailPanelProps) {
  return (
    <div className="flex h-full flex-col">
      <div role="tablist" aria-label="Inspector" className="flex shrink-0 gap-0.5 border-b border-border-soft px-3">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
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
