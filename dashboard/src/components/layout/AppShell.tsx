// @ts-nocheck
'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useResponsive } from '@/hooks/useResponsive';
import Header from './Header';

/**
 * Drag-to-resize for the chrome columns. Width persists per storage key.
 * `invert` flips the drag direction for right-edge columns (inspector).
 */
function useResizableWidth(key, initial, min, max, invert = false) {
  const [width, setWidth] = useState(() => {
    if (typeof window === 'undefined') return initial;
    const saved = Number(localStorage.getItem(key));
    return saved >= min && saved <= max ? saved : initial;
  });
  const [dragging, setDragging] = useState(false);
  const widthRef = useRef(width);
  widthRef.current = width;

  const onPointerDown = useCallback((e) => {
    e.preventDefault();
    setDragging(true);
    const startX = e.clientX;
    const startW = widthRef.current;
    const move = (ev) => {
      const delta = ev.clientX - startX;
      setWidth(Math.min(max, Math.max(min, startW + (invert ? -delta : delta))));
    };
    const up = () => {
      setDragging(false);
      localStorage.setItem(key, String(widthRef.current));
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [key, min, max, invert]);

  return [width, onPointerDown, dragging];
}

function ResizeHandle({ onPointerDown }) {
  return (
    <div
      onPointerDown={onPointerDown}
      role="separator"
      aria-orientation="vertical"
      className="group relative z-10 w-0 shrink-0 cursor-col-resize"
    >
      <div className="absolute inset-y-0 -left-[3px] w-[6px] transition-colors group-hover:bg-primary/20 group-active:bg-primary/30" />
    </div>
  );
}

/**
 * AppShell — three-zone console layout.
 *
 * Desktop (lg+):  [Sidebar] [Conversation] [Inspector] — chrome columns run
 *                 full height; the header floats over the conversation as
 *                 frosted glass, and both side columns are drag-resizable.
 *                 Below xl the inspector auto-collapses (header toggle
 *                 brings it back).
 * Mobile  (<lg):  [Conversation] + slide-over drawers. The bottom tab bar
 *                 lives at the page level, not here.
 */
export default function AppShell({
  sidebar,
  children,
  rightPanel,
  headerProps,
  rightPanelCollapsed = false,
  onToggleRightPanelCollapse,
}: any) {
  const { isDesktop, isMobile, isXl } = useResponsive();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, startSidebarResize, sidebarDragging] =
    useResizableWidth('orbit_sidebar_w', 264, 208, 360, false);
  const [inspectorWidth, startInspectorResize, inspectorDragging] =
    useResizableWidth('orbit_inspector_w', 372, 300, 560, true);

  // Smaller desktops: the inspector yields its width back automatically;
  // the header toggle overrides on demand.
  const [autoHidden, setAutoHidden] = useState(false);
  useEffect(() => { setAutoHidden(isDesktop && !isXl); }, [isDesktop, isXl]);

  const inspectorHidden = rightPanelCollapsed || autoHidden;
  const handleToggleInspector = useCallback(() => {
    if (autoHidden) setAutoHidden(false);
    else onToggleRightPanelCollapse?.();
  }, [autoHidden, onToggleRightPanelCollapse]);

  const toggleSidebar = useCallback(() => setSidebarOpen((prev) => !prev), []);
  const toggleRightPanel = useCallback(() => setRightPanelOpen((prev) => !prev), []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const closeRightPanel = useCallback(() => setRightPanelOpen(false), []);

  return (
    <div className="flex h-full min-h-0 bg-background text-foreground">
      {/* ── Sidebar ── (desktop: full-height column, collapsible + resizable) */}
      {isDesktop ? (
        <>
          <aside
            style={{
              width: sidebarCollapsed ? '0px' : `${sidebarWidth}px`,
              borderRightWidth: sidebarCollapsed ? '0px' : '1px',
            }}
            className={`flex shrink-0 flex-col overflow-hidden border-border-soft bg-sidebar ${
              sidebarDragging ? '' : 'transition-all duration-200 ease-out'
            }`}
          >
            <div style={{ width: `${sidebarWidth}px` }} className="flex h-full shrink-0 flex-col">
              {sidebar}
            </div>
          </aside>
          {!sidebarCollapsed && <ResizeHandle onPointerDown={startSidebarResize} />}
        </>
      ) : (
        <>
          {sidebarOpen && <div onClick={closeSidebar} className="fixed inset-0 z-20 bg-black/40 backdrop-blur-[2px]" />}
          <aside
            className={`fixed inset-y-0 left-0 z-30 flex w-72 max-w-[85vw] flex-col border-r border-border bg-sidebar shadow-float transition-transform duration-200 ${
              sidebarOpen ? 'translate-x-0' : '-translate-x-full'
            }`}
          >
            {sidebar}
          </aside>
        </>
      )}

      {/* ── Conversation column — content scrolls under the frosted header ── */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="absolute inset-x-0 top-0 z-20">
          <Header
            onToggleSidebar={toggleSidebar}
            onToggleRightPanel={isDesktop ? handleToggleInspector : toggleRightPanel}
            rightPanelCollapsed={inspectorHidden}
            onToggleSidebarCollapse={() => setSidebarCollapsed((p) => !p)}
            sidebarCollapsed={sidebarCollapsed}
            isDesktop={isDesktop}
            isMobile={isMobile}
            {...headerProps}
          />
        </div>
        <main className="relative flex min-h-0 flex-1 flex-col">{children}</main>
      </div>

      {/* ── Inspector ── (desktop: full-height column, resizable, auto-collapses <xl) */}
      {isDesktop ? (
        <>
          {!inspectorHidden && <ResizeHandle onPointerDown={startInspectorResize} />}
          <aside
            style={{
              width: inspectorHidden ? '0px' : `${inspectorWidth}px`,
              borderLeftWidth: inspectorHidden ? '0px' : '1px',
            }}
            className={`flex shrink-0 flex-col overflow-hidden border-border-soft bg-sidebar ${
              inspectorDragging ? '' : 'transition-all duration-200 ease-out'
            }`}
          >
            <div style={{ width: `${inspectorWidth}px` }} className="flex h-full shrink-0 flex-col">
              {rightPanel}
            </div>
          </aside>
        </>
      ) : (
        <>
          {rightPanelOpen && <div onClick={closeRightPanel} className="fixed inset-0 z-20 bg-black/40 backdrop-blur-[2px]" />}
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
  );
}
