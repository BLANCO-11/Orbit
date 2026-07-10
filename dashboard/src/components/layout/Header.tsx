// @ts-nocheck
'use client';

import React from 'react';
import { Sun, Moon, Menu, PanelRight, Settings } from 'lucide-react';

const STATUS_META = {
  idle: { label: 'Idle', cls: 'bg-muted text-muted-foreground' },
  thinking: { label: 'Thinking', cls: 'bg-info/12 text-info' },
  executing: { label: 'Executing', cls: 'bg-accent text-accent-foreground' },
  waiting_approval: { label: 'Awaiting approval', cls: 'bg-warning/12 text-warning' },
  done: { label: 'Done', cls: 'bg-success/12 text-success' },
  error: { label: 'Error', cls: 'bg-destructive/12 text-destructive' },
};

function IconBtn({ label, onClick, children }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid size-8 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}

/**
 * Header — console top bar: brand · status pill · theme / notifications / settings / panel.
 */
export default function Header({
  status: statusKey,
  onToggleSettings,
  theme,
  mounted,
  onToggleTheme,
  onToggleSidebar,
  onToggleRightPanel,
  isDesktop,
  isMobile,
  notificationCenter,
  connectionState,
}) {
  // Connection problems take priority over the agent's own status.
  const meta = connectionState === 'connecting'
    ? { label: 'Connecting…', cls: 'bg-warning/12 text-warning' }
    : connectionState === 'disconnected'
      ? { label: 'Disconnected', cls: 'bg-destructive/12 text-destructive' }
      : STATUS_META[statusKey] || STATUS_META.idle;

  const showDot = meta !== STATUS_META.idle;

  return (
    <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-border-soft bg-sidebar px-4">
      {/* ── Brand ── */}
      <div className="flex items-center gap-2.5">
        {!isDesktop && (
          <IconBtn label="Toggle sidebar" onClick={onToggleSidebar}>
            <Menu size={16} />
          </IconBtn>
        )}
        <div className="relative size-[18px] rounded-md bg-gradient-to-br from-primary/80 to-primary shadow-[0_0_0_3px_var(--accent)]">
          <div className="absolute inset-[5px] rounded-[2px] bg-white/90" />
        </div>
        <span className="text-[15px] font-semibold tracking-tight">AegisAgent</span>
        <span className="ml-1 rounded-[5px] border border-border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider text-faint">
          Console
        </span>
      </div>

      {/* ── Status + controls ── */}
      <div className="flex items-center gap-2">
        <div className={`flex items-center gap-[7px] rounded-full py-[5px] pl-2.5 pr-3 text-xs font-semibold ${meta.cls}`}>
          {showDot && <span className="size-1.5 rounded-full bg-current shadow-[0_0_8px_currentColor]" />}
          {meta.label}
        </div>

        {mounted && (
          <IconBtn label={`Switch to ${theme.mode === 'dark' ? 'light' : 'dark'} theme`} onClick={onToggleTheme}>
            {theme.mode === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </IconBtn>
        )}

        {notificationCenter}

        <IconBtn label="Settings" onClick={onToggleSettings}>
          <Settings size={15} />
        </IconBtn>

        {isMobile && (
          <IconBtn label="Toggle panel" onClick={onToggleRightPanel}>
            <PanelRight size={15} />
          </IconBtn>
        )}
      </div>
    </header>
  );
}
