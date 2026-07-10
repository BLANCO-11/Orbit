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
      style={{
        height: '56px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-around',
        borderTop: '1px solid var(--border-subtle)',
        background: 'var(--surface-elevated)',
        backdropFilter: 'blur(16px)',
        flexShrink: 0,
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        zIndex: 25,
      }}
    >
      {items.map(item => {
        const isActive = activeTab === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onTabChange?.(item.id)}
            className="interactive-base focus-ring"
            aria-label={item.label}
            aria-current={isActive ? 'page' : undefined}
            style={{
              flex: 1,
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '2px',
              background: 'none',
              border: 'none',
              color: isActive ? 'var(--accent-primary)' : 'var(--text-tertiary)',
              fontSize: '0.65rem',
              fontWeight: isActive ? '600' : '400',
              padding: '4px 0',
              transition: 'color var(--duration-150) var(--ease-out-expo)',
              borderTop: isActive ? '2px solid var(--accent-primary)' : '2px solid transparent',
            }}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
