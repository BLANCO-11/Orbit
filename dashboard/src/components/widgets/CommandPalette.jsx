'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, CornerDownLeft } from 'lucide-react';

/**
 * CommandPalette — Spotlight-style command launcher (Ctrl+K).
 *
 * Commands:
 *   New Session, Switch Theme, Toggle Sidebar, Toggle Detail Panel,
 *   Compact Memory, Stop Agent, Open Settings, Toggle Logs
 */
const COMMANDS = [
  { id: 'new-session', label: 'New Session', shortcut: 'Ctrl+N', category: 'Sessions' },
  { id: 'toggle-sidebar', label: 'Toggle Sidebar', shortcut: 'Ctrl+B', category: 'View' },
  { id: 'toggle-panel', label: 'Toggle Detail Panel', shortcut: 'Ctrl+J', category: 'View' },
  { id: 'stop-agent', label: 'Stop Agent', shortcut: 'Escape', category: 'Agent' },
  { id: 'compact', label: 'Compact Memory', shortcut: '', category: 'Agent' },
  { id: 'settings', label: 'Open Settings', shortcut: '', category: 'Settings' },
  { id: 'toggle-logs', label: 'Toggle Logs Panel', shortcut: '', category: 'View' },
  { id: 'toggle-workspace', label: 'Open Workspace', shortcut: '', category: 'View' },
];

const THEME_COMMANDS = [
  { id: 'theme-deep-space', label: 'Theme: Deep Space', theme: 'deep-space' },
  { id: 'theme-frost', label: 'Theme: Frost', theme: 'frost' },
  { id: 'theme-forest', label: 'Theme: Forest', theme: 'forest' },
  { id: 'theme-ocean', label: 'Theme: Ocean', theme: 'ocean' },
  { id: 'theme-sepia', label: 'Theme: Sepia', theme: 'sepia' },
  { id: 'theme-high-contrast', label: 'Theme: High Contrast', theme: 'high-contrast' },
];

export default function CommandPalette({ isOpen, onClose, handlers }) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const allCommands = [...COMMANDS, ...THEME_COMMANDS];

  const filtered = query.trim()
    ? allCommands.filter(c => c.label.toLowerCase().includes(query.toLowerCase()))
    : [
        ...COMMANDS.filter(c => !c.category || c.category !== 'theme'),
        { type: 'header', label: 'Themes' },
        ...THEME_COMMANDS,
      ];

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, filtered.filter(f => !f.type).length - 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        executeCommand(filtered.filter(f => !f.type)[selectedIndex]);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, selectedIndex, filtered]);

  const executeCommand = useCallback((cmd) => {
    if (!cmd) return;
    onClose();

    switch (cmd.id) {
      case 'new-session': handlers.onNewSession?.(); break;
      case 'toggle-sidebar': handlers.onToggleSidebar?.(); break;
      case 'toggle-panel': handlers.onTogglePanel?.(); break;
      case 'stop-agent': handlers.onStop?.(); break;
      case 'compact': handlers.onCompact?.(); break;
      case 'settings': handlers.onOpenSettings?.(); break;
      case 'toggle-logs': handlers.onToggleLogs?.(); break;
      case 'toggle-workspace': handlers.onToggleWorkspace?.(); break;
      default:
        if (cmd.theme) handlers.onSetTheme?.(cmd.theme);
        break;
    }
  }, [handlers, onClose]);

  if (!isOpen) return null;

  const selectableItems = filtered.filter(f => !f.type);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      paddingTop: '15vh',
    }}>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} />

      {/* Palette */}
      <div style={{
        position: 'relative', width: '560px', maxWidth: '90vw',
        background: 'var(--surface-elevated)',
        backdropFilter: 'blur(30px)', WebkitBackdropFilter: 'blur(30px)',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
        overflow: 'hidden',
        animation: 'scale-in var(--duration-150) var(--ease-out-expo) both',
      }}>
        {/* Search input */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '14px 16px', borderBottom: '1px solid var(--border-subtle)',
        }}>
          <Search size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
            placeholder="Type a command..."
            style={{
              flex: 1, background: 'none', border: 'none', outline: 'none',
              color: 'var(--text-primary)', fontSize: '0.9rem',
              fontFamily: 'inherit',
            }}
          />
          <span style={{
            fontSize: '0.65rem', color: 'var(--text-tertiary)',
            border: '1px solid var(--border-subtle)', borderRadius: '4px',
            padding: '2px 6px', display: 'flex', alignItems: 'center', gap: '2px',
          }}>
            <CornerDownLeft size={10} /> select
          </span>
        </div>

        {/* Results */}
        <div ref={listRef} style={{ maxHeight: '360px', overflowY: 'auto', padding: '6px' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>
              No commands found
            </div>
          ) : (
            filtered.map((item, i) => {
              if (item.type === 'header') {
                return (
                  <div key={i} style={{
                    fontSize: '0.62rem', fontWeight: '700', color: 'var(--text-tertiary)',
                    textTransform: 'uppercase', letterSpacing: '1px',
                    padding: '8px 10px 4px 10px',
                  }}>
                    {item.label}
                  </div>
                );
              }
              const actualIndex = selectableItems.indexOf(item);
              const isSelected = actualIndex === selectedIndex;

              return (
                <div
                  key={item.id}
                  onClick={() => executeCommand(item)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                    background: isSelected ? 'var(--accent-primary-muted)' : 'transparent',
                    color: 'var(--text-primary)', fontSize: '0.82rem',
                    transition: 'background 0.1s ease',
                  }}
                  onMouseEnter={() => setSelectedIndex(actualIndex)}
                >
                  <span>{item.label}</span>
                  {item.shortcut && (
                    <span style={{
                      fontSize: '0.62rem', color: 'var(--text-tertiary)',
                      border: '1px solid var(--border-subtle)', borderRadius: '3px',
                      padding: '1px 5px',
                    }}>
                      {item.shortcut}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
