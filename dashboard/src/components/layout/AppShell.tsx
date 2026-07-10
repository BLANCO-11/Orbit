'use client';

import React, { useState, useCallback } from 'react';
import { useResponsive } from '@/hooks/useResponsive';
import Header from './Header';
import Sidebar from './Sidebar';
import RightPanel from './RightPanel';
import BottomNav from './BottomNav';

/**
 * AppShell — Responsive 3-column layout shell.
 *
 * Desktop (xl):   [Sidebar 260px] [Main flex] [RightPanel 360px]
 * Tablet  (lg):   [Main flex] + sidebar/right as slide-over drawers
 * Mobile  (<md):  [Main flex] + bottom nav + full-screen drawers
 */
export default function AppShell({
  /** Sidebar content (SessionList) */
  sidebar,
  /** Main content (chat area, etc.) */
  children,
  /** Right panel content (Metrics or Settings) */
  rightPanel,
  /** Right panel active tab */
  rightPanelTab,
  /** Whether right panel shows metrics or settings */
  showSettings,

  /** Header props — pass through */
  headerProps,

  /** Sidebar props */
  sidebarProps,

  /** Bottom nav items for mobile */
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
    <div className="flex flex-col h-full">
      {/* ── Header ── */}
      <Header
        onToggleSidebar={toggleSidebar}
        onToggleRightPanel={toggleRightPanel}
        sidebarOpen={sidebarOpen}
        rightPanelOpen={rightPanelOpen}
        isDesktop={isDesktop}
        isMobile={isMobile}
        {...headerProps}
      />

      {/* ── Main Body ── */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* ── Sidebar ── */}
        {isDesktop ? (
          <aside className="sidebar-panel">
            {sidebar}
          </aside>
        ) : (
          <>
            {/* Overlay backdrop */}
            {sidebarOpen && (
              <div
                onClick={closeSidebar}
                className="fixed inset-0 z-20 bg-black/40"
                style={{ top: 'var(--header-height)' }}
              />
            )}
            <aside className={`sidebar-panel ${sidebarOpen ? 'open' : ''}`}>
              {sidebar}
            </aside>
          </>
        )}

        {/* ── Main Content Area ── */}
        <main className="main-content">
          {children}
        </main>

        {/* ── Right Panel ── */}
        {isDesktop ? (
          <aside className="right-panel">
            {rightPanel}
          </aside>
        ) : (
          <>
            {rightPanelOpen && (
              <div
                onClick={closeRightPanel}
                className="fixed inset-0 z-20 bg-black/40"
                style={{ top: 'var(--header-height)' }}
              />
            )}
            <aside className={`right-panel ${rightPanelOpen ? 'open' : ''}`}>
              {rightPanel}
            </aside>
          </>
        )}
      </div>

      {/* ── Mobile Bottom Nav ── */}
      {isMobile && (
        <BottomNav
          items={bottomNavItems}
          activeTab={activeNavTab}
          onTabChange={onNavTabChange}
        />
      )}
    </div>
  );
}
