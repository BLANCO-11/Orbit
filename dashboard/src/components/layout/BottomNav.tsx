'use client';

import React, { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';

/**
 * BottomNav — mobile bottom navigation, frosted. Lives at the page level so
 * every view (not just the console) keeps navigation on phones.
 *
 * `items` are the top destinations; `moreItems` open in a frosted sheet
 * above the bar (secondary destinations: Fleet, Agents, Connectors, …).
 * Both use { id, label, icon } format.
 */
export default function BottomNav({ items = [], moreItems = [], activeTab, onTabChange }) {
  const [moreOpen, setMoreOpen] = useState(false);
  if (!items.length) return null;

  const moreActive = moreItems.some((m) => m.id === activeTab);

  const handleTab = (id) => {
    setMoreOpen(false);
    onTabChange?.(id);
  };

  return (
    <>
      {moreOpen && (
        <>
          <div onClick={() => setMoreOpen(false)} className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" />
          <div className="glass-overlay animate-sheet-up fixed inset-x-3 z-50 rounded-2xl border border-border p-2"
            style={{ bottom: 'calc(4.25rem + env(safe-area-inset-bottom, 0px))' }}
          >
            <div className="grid grid-cols-3 gap-1">
              {moreItems.map((item) => {
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleTab(item.id)}
                    aria-label={item.label}
                    aria-current={isActive ? 'page' : undefined}
                    className={`flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-xl px-2 py-2.5 text-[0.7rem] transition-colors ${
                      isActive
                        ? 'bg-accent font-semibold text-accent-foreground'
                        : 'font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                    }`}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      <nav
        className="glass z-40 flex h-14 shrink-0 items-center justify-around border-t border-border"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {items.map((item) => {
          const isActive = activeTab === item.id && !moreOpen;
          return (
            <button
              key={item.id}
              onClick={() => handleTab(item.id)}
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined}
              className={`flex h-full min-w-[44px] flex-1 flex-col items-center justify-center gap-0.5 border-t-2 pt-1 text-[0.65rem] transition-colors ${
                isActive
                  ? 'border-primary font-semibold text-primary'
                  : 'border-transparent font-normal text-muted-foreground'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          );
        })}
        {moreItems.length > 0 && (
          <button
            onClick={() => setMoreOpen((p) => !p)}
            aria-label="More destinations"
            aria-expanded={moreOpen}
            className={`flex h-full min-w-[44px] flex-1 flex-col items-center justify-center gap-0.5 border-t-2 pt-1 text-[0.65rem] transition-colors ${
              moreOpen || moreActive
                ? 'border-primary font-semibold text-primary'
                : 'border-transparent font-normal text-muted-foreground'
            }`}
          >
            <MoreHorizontal size={18} />
            <span>More</span>
          </button>
        )}
      </nav>
    </>
  );
}
