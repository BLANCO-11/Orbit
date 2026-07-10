// @ts-nocheck
'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Sun, Moon, Menu, PanelRightClose, PanelRightOpen, Eye, EyeOff, Settings } from 'lucide-react';

const STATUS_META = {
  idle: { label: 'Idle', dot: 'bg-muted-foreground' },
  thinking: { label: 'Thinking', dot: 'bg-chart-3 shadow-[0_0_8px_var(--chart-3)]' },
  executing: { label: 'Executing', dot: 'bg-primary shadow-[0_0_8px_var(--primary)]' },
  waiting_approval: { label: 'Awaiting Approval', dot: 'bg-warning shadow-[0_0_8px_var(--warning)]' },
  done: { label: 'Done', dot: 'bg-success shadow-[0_0_8px_var(--success)]' },
  error: { label: 'Error', dot: 'bg-destructive shadow-[0_0_8px_var(--destructive)]' },
};

/**
 * Header — App navigation bar
 *
 * Desktop: [logo] [center controls] [status + theme + panel toggles]
 * Mobile:  [logo] [hamburger + right panel toggle]
 */
export default function Header({
  status: statusKey,
  showThinking,
  onToggleThinking,
  showSettings,
  onToggleSettings,
  theme,
  mounted,
  onToggleTheme,
  onToggleSidebar,
  onToggleRightPanel,
  rightPanelOpen,
  isDesktop,
  isMobile,
  notificationCenter,
  connectionState,
}) {
  // Connection problems take priority over the agent's own status.
  const meta = connectionState === 'connecting'
    ? { label: 'Connecting...', dot: 'bg-warning shadow-[0_0_8px_var(--warning)]' }
    : connectionState === 'disconnected'
      ? { label: 'Disconnected', dot: 'bg-destructive shadow-[0_0_8px_var(--destructive)]' }
      : STATUS_META[statusKey] || STATUS_META.idle;

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
      {/* ── Left: Logo + Sidebar toggle ── */}
      <div className="flex items-center gap-3">
        {!isDesktop && (
          <Button variant="ghost" size="icon" onClick={onToggleSidebar} aria-label="Toggle sidebar">
            <Menu size={18} />
          </Button>
        )}
        <div className="size-2 shrink-0 rounded-full bg-primary" />
        <span className="whitespace-nowrap text-[15px] font-semibold tracking-tight">AegisAgent</span>
      </div>

      {/* ── Center: Toggle buttons (desktop) ── */}
      {isDesktop && (
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onToggleThinking}>
            {showThinking ? <EyeOff size={14} /> : <Eye size={14} />}
            {showThinking ? 'Chat View' : 'Console View'}
          </Button>
          <Button variant="outline" size="sm" onClick={onToggleSettings}>
            <Settings size={14} />
            {showSettings ? 'Hide Settings' : 'Configure'}
          </Button>
        </div>
      )}

      {/* ── Right: Status + Theme + Panel toggles ── */}
      <div className="flex items-center gap-3">
        {/* Status indicator */}
        <div className="flex items-center gap-1.5">
          <div className={`size-2 shrink-0 rounded-full ${meta.dot}`} />
          <span className="whitespace-nowrap text-[0.7rem] font-semibold tracking-wide text-muted-foreground uppercase">
            {meta.label}
          </span>
        </div>

        {/* Theme toggle */}
        {mounted && (
          <Button
            variant="outline"
            size="icon"
            onClick={onToggleTheme}
            aria-label={`Switch to ${theme.mode === 'dark' ? 'light' : 'dark'} theme`}
          >
            {theme.mode === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </Button>
        )}

        {/* Notification center */}
        {notificationCenter}

        {/* Right panel toggle (desktop + mobile) */}
        {(isDesktop || isMobile) && (
          <Button variant="outline" size="icon" onClick={onToggleRightPanel} aria-label="Toggle right panel">
            {isDesktop && rightPanelOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
          </Button>
        )}
      </div>
    </header>
  );
}
