// @ts-nocheck
import React from 'react';
import { cn } from '@/lib/utils';

/**
 * Separator — Horizontal or vertical divider
 */
export function Separator({
  orientation = 'horizontal',
  className,
  style,
  ...props
}) {
  const isHorizontal = orientation === 'horizontal';

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn('shrink-0 bg-[var(--border-subtle)]', className)}
      style={{
        width: isHorizontal ? '100%' : '1px',
        height: isHorizontal ? '1px' : '100%',
        margin: isHorizontal ? 'var(--space-4) 0' : '0 var(--space-4)',
        ...style,
      }}
      {...props}
    />
  );
}
