'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Sun, Moon, Menu, PanelRightClose, PanelRightOpen, Eye, EyeOff, Settings } from 'lucide-react';

/**
 * Header — App navigation bar
 *
 * Desktop: [logo] [center controls] [status + theme + panel toggles]
 * Mobile:  [logo] [hamburger + right panel toggle]
 */
export default function Header({
  status,
  getStatusColor,
  showThinking,
  onToggleThinking,
  showSettings,
  onToggleSettings,
  theme,
  mounted,
  onToggleTheme,
  onToggleSidebar,
  onToggleRightPanel,
  sidebarOpen,
  rightPanelOpen,
  isDesktop,
  isMobile,
  notificationCenter,
}) {
  return (
    <header className="app-header">
      {/* ── Left: Logo + Sidebar toggle ── */}
      <div className="header-logo">
        {!isDesktop && (
          <button
            onClick={onToggleSidebar}
            className="interactive-base focus-ring"
            aria-label="Toggle sidebar"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary)',
              padding: 'var(--space-1)',
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Menu size={18} />
          </button>
        )}
        <div className="header-logo-dot" />
        <span className="header-logo-text">AegisAgent</span>
      </div>

      {/* ── Center: Toggle buttons (desktop) ── */}
      {isDesktop && (
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <Button
            variant="outline"
            size="sm"
            onClick={onToggleThinking}
          >
            {showThinking ? <EyeOff size={14} /> : <Eye size={14} />}
            {showThinking ? 'Chat View' : 'Console View'}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={onToggleSettings}
          >
            <Settings size={14} />
            {showSettings ? 'Hide Settings' : 'Configure'}
          </Button>
        </div>
      )}

      {/* ── Right: Status + Theme + Panel toggles ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        {/* Status indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: getStatusColor?.(),
              boxShadow: `0 0 8px ${getStatusColor?.() || 'var(--text-tertiary)'}`,
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontSize: '0.7rem',
              textTransform: 'uppercase',
              letterSpacing: '1px',
              fontWeight: '600',
              color: getStatusColor?.(),
              whiteSpace: 'nowrap',
            }}
          >
            {status}
          </span>
        </div>

        {/* Theme toggle */}
        {mounted && (
          <button
            onClick={onToggleTheme}
            className="interactive-base focus-ring"
            aria-label={`Switch to ${theme.mode === 'dark' ? 'light' : 'dark'} theme`}
            style={{
              background: 'none',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)',
              padding: '6px',
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              lineHeight: 0,
            }}
          >
            {theme.mode === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        )}

        {/* Notification center */}
        {notificationCenter}

        {/* Right panel toggle (desktop) */}
        {isDesktop && (
          <button
            onClick={onToggleRightPanel}
            className="interactive-base focus-ring"
            aria-label="Toggle right panel"
            style={{
              background: 'none',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)',
              padding: '6px',
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              lineHeight: 0,
            }}
          >
            {rightPanelOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
          </button>
        )}

        {/* Mobile: right panel toggle */}
        {isMobile && (
          <button
            onClick={onToggleRightPanel}
            className="interactive-base focus-ring"
            aria-label="Toggle right panel"
            style={{
              background: 'none',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)',
              padding: '6px',
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              lineHeight: 0,
            }}
          >
            <PanelRightOpen size={18} />
          </button>
        )}
      </div>
    </header>
  );
}
