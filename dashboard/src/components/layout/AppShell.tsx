// @ts-nocheck
'use client';

import React, { useState, useCallback } from 'react';
import { useResponsive } from '@/hooks/useResponsive';
import Header from './Header';
import BottomNav from './BottomNav';

/**
 * AppShell — three-zone console layout.
 *
 * Desktop (lg+):  [Sidebar 264px] [Conversation 1fr] [Inspector 372px]
 * Mobile  (<lg):  [Conversation] + bottom nav + slide-over drawers
 */
export default function AppShell({
  sidebar,
  children,
  rightPanel,
  headerProps,
  bottomNavItems,
  activeNavTab,
  onNavTabChange,
}: any) {
  const { isDesktop, isMobile } = useResponsive();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);

  const toggleSidebar = useCallback(() => setSidebarOpen((prev) => !prev), []);
  const toggleRightPanel = useCallback(() => setRightPanelOpen((prev) => !prev), []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const closeRightPanel = useCallback(() => setRightPanelOpen(false), []);

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <Header
        onToggleSidebar={toggleSidebar}
        onToggleRightPanel={toggleRightPanel}
        isDesktop={isDesktop}
        isMobile={isMobile}
        {...headerProps}
      />

      <div className="relative flex min-h-0 flex-1">
        {/* ── Sidebar ── */}
        {isDesktop ? (
          <aside className="flex w-[264px] shrink-0 flex-col border-r border-border-soft bg-sidebar">
            {sidebar}
          </aside>
        ) : (
          <>
            {sidebarOpen && <div onClick={closeSidebar} className="fixed inset-0 z-20 bg-black/40" />}
            <aside
              className={`fixed inset-y-0 left-0 z-30 flex w-72 max-w-[85vw] flex-col border-r border-border bg-sidebar shadow-float transition-transform duration-200 ${
                sidebarOpen ? 'translate-x-0' : '-translate-x-full'
              }`}
            >
              {sidebar}
            </aside>
          </>
        )}

        {/* ── Conversation ── */}
        <main className="relative flex min-w-0 flex-1 flex-col">{children}</main>

        {/* ── Inspector ── */}
        {isDesktop ? (
          <aside className="flex w-[372px] shrink-0 flex-col border-l border-border-soft bg-sidebar">
            {rightPanel}
          </aside>
        ) : (
          <>
            {rightPanelOpen && <div onClick={closeRightPanel} className="fixed inset-0 z-20 bg-black/40" />}
            <aside
              className={`fixed inset-y-0 right-0 z-30 flex w-full max-w-md flex-col border-l border-border bg-sidebar shadow-float transition-transform duration-200 ${
                rightPanelOpen ? 'translate-x-0' : 'translate-x-full'
              }`}
            >
              {rightPanel}
            </aside>
          </>
        )}
      </div>

      {isMobile && <BottomNav items={bottomNavItems} activeTab={activeNavTab} onTabChange={onNavTabChange} />}
    </div>
  );
}
