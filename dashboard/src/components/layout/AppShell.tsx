'use client';

import React, { useState, useCallback } from 'react';
import { useResponsive } from '@/hooks/useResponsive';
import Header from './Header';
import BottomNav from './BottomNav';

/**
 * AppShell — Responsive 3-column layout shell.
 *
 * Desktop (lg+):  [Sidebar 264px] [Main flex] [RightPanel 360px]
 * Mobile  (<lg):  [Main flex] + bottom nav + full-screen drawers
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

  const toggleSidebar = useCallback(() => setSidebarOpen(prev => !prev), []);
  const toggleRightPanel = useCallback(() => setRightPanelOpen(prev => !prev), []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const closeRightPanel = useCallback(() => setRightPanelOpen(false), []);

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <Header
        onToggleSidebar={toggleSidebar}
        onToggleRightPanel={toggleRightPanel}
        rightPanelOpen={rightPanelOpen}
        isDesktop={isDesktop}
        isMobile={isMobile}
        {...headerProps}
      />

      <div className="relative flex flex-1 overflow-hidden">
        {/* ── Sidebar ── */}
        {isDesktop ? (
          <aside className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-border">
            {sidebar}
          </aside>
        ) : (
          <>
            {sidebarOpen && (
              <div onClick={closeSidebar} className="fixed inset-0 z-20 bg-black/40" />
            )}
            <aside
              className={`fixed inset-y-0 left-0 z-30 flex w-72 max-w-[85vw] flex-col overflow-y-auto border-r border-border bg-sidebar transition-transform duration-200 ${
                sidebarOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
              }`}
            >
              {sidebar}
            </aside>
          </>
        )}

        {/* ── Main Content ── */}
        <main className="flex flex-1 flex-col overflow-hidden">{children}</main>

        {/* ── Right Panel ── */}
        {isDesktop ? (
          <aside className="flex w-96 shrink-0 flex-col overflow-y-auto border-l border-border">
            {rightPanel}
          </aside>
        ) : (
          <>
            {rightPanelOpen && (
              <div onClick={closeRightPanel} className="fixed inset-0 z-20 bg-black/40" />
            )}
            <aside
              className={`fixed inset-y-0 right-0 z-30 flex w-full max-w-md flex-col overflow-y-auto border-l border-border bg-sidebar transition-transform duration-200 ${
                rightPanelOpen ? 'translate-x-0 shadow-2xl' : 'translate-x-full'
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
