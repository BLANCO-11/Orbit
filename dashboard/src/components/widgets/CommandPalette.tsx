// @ts-nocheck
'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, CornerDownLeft } from 'lucide-react';
import { Kbd } from '@/components/ui/kbd';

/**
 * CommandPalette — Spotlight-style command launcher (Ctrl+K).
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
  { id: 'theme-light', label: 'Theme: Light', theme: 'light' },
  { id: 'theme-dark', label: 'Theme: Dark', theme: 'dark' },
];

export default function CommandPalette({ isOpen, onClose, handlers }) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);

  const allCommands = [...COMMANDS, ...THEME_COMMANDS];

  const filtered = query.trim()
    ? allCommands.filter((c) => c.label.toLowerCase().includes(query.toLowerCase()))
    : [...COMMANDS, { type: 'header', id: 'header-themes', label: 'Themes' }, ...THEME_COMMANDS];

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

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

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') { onClose(); return; }
      const selectable = filtered.filter((f) => !f.type);
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, selectable.length - 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex((i) => Math.max(i - 1, 0)); }
      if (e.key === 'Enter') { e.preventDefault(); executeCommand(selectable[selectedIndex]); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, selectedIndex, filtered, onClose, executeCommand]);

  if (!isOpen) return null;

  const selectableItems = filtered.filter((f) => !f.type);

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]">
      <div onClick={onClose} className="absolute inset-0 bg-black/50" />

      <div className="relative w-[560px] max-w-[90vw] animate-in zoom-in-95 overflow-hidden rounded-xl border border-border bg-popover shadow-2xl backdrop-blur-2xl">
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3.5">
          <Search size={16} className="shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
            placeholder="Type a command..."
            className="flex-1 bg-transparent text-[0.9rem] outline-none"
          />
          <span className="flex items-center gap-0.5 rounded border border-border px-1.5 py-0.5 text-[0.65rem] text-muted-foreground">
            <CornerDownLeft size={10} /> select
          </span>
        </div>

        <div className="max-h-[360px] overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <div className="p-5 text-center text-sm text-muted-foreground">No commands found</div>
          ) : (
            filtered.map((item, i) => {
              if (item.type === 'header') {
                return (
                  <div key={i} className="px-2.5 pb-1 pt-2 text-[0.62rem] font-bold uppercase tracking-wider text-muted-foreground">
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
                  onMouseEnter={() => setSelectedIndex(actualIndex)}
                  role="button"
                  tabIndex={0}
                  className={`flex cursor-pointer items-center justify-between rounded-md px-2.5 py-2 text-[0.82rem] ${isSelected ? 'bg-accent' : ''}`}
                >
                  <span>{item.label}</span>
                  {item.shortcut && <Kbd>{item.shortcut}</Kbd>}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
