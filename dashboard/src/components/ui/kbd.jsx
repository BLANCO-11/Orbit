import React from 'react';
import { cn } from '@/lib/utils';

/**
 * Kbd — Keyboard shortcut display
 */
export function Kbd({ children, className, ...props }) {
  return (
    <kbd
      className={cn(
        'inline-flex items-center justify-center font-mono font-medium',
        className
      )}
      style={{
        minWidth: '20px',
        height: '20px',
        padding: '0 5px',
        fontSize: '0.65rem',
        borderRadius: '4px',
        background: 'var(--surface-secondary)',
        border: '1px solid var(--border-subtle)',
        borderBottomWidth: '2px',
        color: 'var(--text-secondary)',
        lineHeight: 1,
      }}
      {...props}
    >
      {children}
    </kbd>
  );
}
