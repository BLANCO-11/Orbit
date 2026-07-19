// @ts-nocheck
'use client';

import React from 'react';
import { Sun, Moon, Menu, PanelRight, PanelLeftClose, PanelLeftOpen, Settings, MonitorSmartphone } from 'lucide-react';

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
      className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}

/**
 * Header — frosted bar floating over the conversation. Brand lives in the
 * icon rail on desktop; here it only appears on mobile (no rail there).
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
  centerView,
  onSetCenterView,
  planProgress,
  activeDevice,
  onToggleSidebarCollapse,
  sidebarCollapsed,
  rightPanelCollapsed = false,
  isVisible,
}) {
  // Connection problems take priority over the agent's own status.
  const meta = connectionState === 'connecting'
    ? { label: 'Connecting…', cls: 'bg-warning/12 text-warning' }
    : connectionState === 'disconnected'
      ? { label: 'Disconnected', cls: 'bg-destructive/12 text-destructive' }
      : STATUS_META[statusKey] || STATUS_META.idle;

  const showDot = meta !== STATUS_META.idle;

  return (
    <header className="glass flex h-[52px] items-center justify-between border-b border-border-soft px-3">
      {/* ── Left: nav toggles (+ brand on mobile — the rail owns it on desktop) ── */}
      <div className="flex items-center gap-2">
        {!isDesktop && (
          <IconBtn label="Toggle sidebar" onClick={onToggleSidebar}>
            <Menu size={16} />
          </IconBtn>
        )}
        {isDesktop && onToggleSidebarCollapse && (
          <IconBtn
            label={sidebarCollapsed ? 'Show sessions sidebar' : 'Hide sessions sidebar'}
            onClick={onToggleSidebarCollapse}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          </IconBtn>
        )}
        {isMobile && (
          <>
            <div className="relative size-[18px] rounded-md bg-gradient-to-br from-primary/80 to-primary shadow-[0_0_0_3px_var(--accent)]">
              <div className="absolute inset-[5px] rounded-[2px] bg-white/90" />
            </div>
            <span className="text-[15px] font-semibold tracking-tight">Orbit</span>
          </>
        )}
        {/* Primary agent this console is driving — the selected harness. Shown
            next to the sidebar toggle so it's always clear WHICH agent runs your
            prompts (esp. a remote one). Highlighted when remote. */}
        {activeDevice && (
          <span
            title={`Primary agent: ${activeDevice.name}${activeDevice.machine && activeDevice.machine !== 'local' ? ` on ${activeDevice.machine}` : ''} (${activeDevice.transport || 'local'})`}
            className={`ml-1 hidden items-center gap-1.5 rounded-md border px-2 py-0.75 text-[11px] font-semibold sm:inline-flex ${
              activeDevice.transport === 'remote'
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border bg-card text-muted-foreground'
            }`}
          >
            <MonitorSmartphone size={12} className={activeDevice.transport === 'remote' ? 'text-primary' : 'text-faint'} />
            <span className="max-w-45 truncate">{activeDevice.name || 'pi-code'}</span>
            {activeDevice.transport === 'remote' && activeDevice.machine && (
              <span className="text-[10px] font-normal text-primary/70">· {activeDevice.machine}</span>
            )}
          </span>
        )}
      </div>

      {/* ── Status + controls ── */}
      <div className="flex items-center gap-2">
        {onSetCenterView && (
          <div className="mr-1 inline-flex rounded-lg border border-border-soft bg-background p-0.5">
            {['timeline', 'mission'].filter((v) => !isVisible || isVisible('views', v)).map((v) => {
              const isMission = v === 'mission';
              const hasPlan = isMission && planProgress && planProgress.total > 0;
              return (
                <button
                  key={v}
                  onClick={() => onSetCenterView(v)}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-semibold capitalize transition-colors ${
                    centerView === v ? 'bg-card text-foreground shadow-card' : 'text-faint hover:text-foreground'
                  }`}
                >
                  {v}
                  {hasPlan && (
                    <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[9.5px] font-bold tabular-nums ${
                      planProgress.done === planProgress.total ? 'bg-success/15 text-success'
                        : planProgress.active ? 'bg-warning/15 text-warning' : 'bg-muted text-muted-foreground'
                    }`}>
                      {planProgress.active && <span className="size-[5px] animate-pulse rounded-full bg-warning" />}
                      {planProgress.done}/{planProgress.total}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
        <div className={`flex items-center gap-[7px] rounded-full py-[5px] pl-2.5 pr-3 text-xs font-semibold ${meta.cls}`}>
          {showDot && <span className="size-1.5 rounded-full bg-current shadow-[0_0_8px_currentColor]" />}
          {meta.label}
        </div>

        {notificationCenter}

        {(isMobile || isDesktop) && (
          <IconBtn label={isDesktop ? 'Toggle Inspector' : 'Toggle panel'} onClick={onToggleRightPanel}>
            <PanelRight size={15} />
          </IconBtn>
        )}
      </div>
    </header>
  );
}
