'use client';

import React from 'react';

/**
 * BottomNav — Mobile bottom navigation bar
 *
 * Items format:
 *   { id: 'chat', label: 'Chat', icon: <ChatBubbleIcon /> }
 */
export default function BottomNav({ items = [], activeTab, onTabChange }) {
  if (!items.length) return null;

  return (
    <nav
      className="flex h-14 shrink-0 items-center justify-around border-t border-border bg-background"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {items.map((item) => {
        const isActive = activeTab === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onTabChange?.(item.id)}
            aria-label={item.label}
            aria-current={isActive ? 'page' : undefined}
            className={`flex h-full flex-1 flex-col items-center justify-center gap-0.5 border-t-2 pt-1 text-[0.65rem] transition-colors ${
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
    </nav>
  );
}
