'use client';

import React, { useState } from 'react';
import { MessageSquare, FolderTree } from 'lucide-react';
import SessionList from '../SessionList';
import ExplorerSidebar from '../panels/ExplorerSidebar';

export default function SidebarSwitcher({
  sessions,
  currentSessionId,
  searchQuery,
  onSearchChange,
  groupedSessions,
  hoveredSessionId,
  onHover,
  onLeave,
  onSwitch,
  onDelete,
  onNewSession,
  childToParent,
  parentToChildren,
  sessionsLength,
  onFileSelect,
}: any) {
  const [activeTab, setActiveTab] = useState<'sessions' | 'files'>('sessions');

  return (
    <div className="flex h-full flex-col">
      {/* Switcher Tab bar */}
      <div className="flex shrink-0 border-b border-border-soft px-3 py-2 bg-sidebar gap-1.5">
        <button
          onClick={() => setActiveTab('sessions')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-[12px] font-semibold transition-all duration-150 ${
            activeTab === 'sessions'
              ? 'bg-card text-foreground shadow-card border border-border-soft'
              : 'text-faint hover:text-foreground hover:bg-muted/40'
          }`}
        >
          <MessageSquare size={13} />
          Sessions
        </button>
        <button
          onClick={() => setActiveTab('files')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-[12px] font-semibold transition-all duration-150 ${
            activeTab === 'files'
              ? 'bg-card text-foreground shadow-card border border-border-soft'
              : 'text-faint hover:text-foreground hover:bg-muted/40'
          }`}
        >
          <FolderTree size={13} />
          Explorer
        </button>
      </div>

      {/* Panel contents */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'sessions' ? (
          <div className="h-full w-full animate-fade-in">
            <SessionList
              currentSessionId={currentSessionId}
              searchQuery={searchQuery}
              onSearchChange={onSearchChange}
              groupedSessions={groupedSessions}
              hoveredSessionId={hoveredSessionId}
              onHover={onHover}
              onLeave={onLeave}
              onSwitch={onSwitch}
              onDelete={onDelete}
              onNewSession={onNewSession}
              childToParent={childToParent}
              parentToChildren={parentToChildren}
              sessionsLength={sessionsLength}
            />
          </div>
        ) : (
          <div className="h-full w-full animate-fade-in">
            <ExplorerSidebar onFileSelect={onFileSelect} />
          </div>
        )}
      </div>
    </div>
  );
}
