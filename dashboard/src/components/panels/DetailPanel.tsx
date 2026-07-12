'use client';

import React from 'react';
import { Activity, Folder, GitBranch, List, Monitor, TerminalSquare } from 'lucide-react';

const TABS = [
  { id: 'agent', label: 'Overview', icon: Activity },
  { id: 'preview', label: 'Preview', icon: Monitor },
  { id: 'console', label: 'Console', icon: TerminalSquare },
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
 * DetailPanel — inspector segments: Overview · Preview · Console · Workspace ·
 * Trace · Logs. All six fit without a horizontal scrollbar: the active tab
 * shows icon + label, the rest are icon-only (label via tooltip). No scrolling
 * navbar — the whole strip is always visible.
 */
export default function DetailPanel({ activeTab, onTabChange, children }: DetailPanelProps) {
  return (
    <div className="flex h-full flex-col">
      <div role="tablist" aria-label="Inspector" className="flex shrink-0 items-stretch gap-0.5 border-b border-border-soft px-2">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              aria-label={tab.label}
              title={tab.label}
              onClick={() => onTabChange(tab.id)}
              className={`flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 pb-[11px] pt-3 text-[12.5px] transition-colors ${
                isActive
                  ? 'border-primary font-semibold text-foreground'
                  : 'flex-1 border-transparent font-medium text-faint hover:text-foreground'
              }`}
            >
              <Icon size={14} className="shrink-0" />
              {isActive && <span>{tab.label}</span>}
            </button>
          );
        })}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
}
