// @ts-nocheck
import React from 'react';
import { cn } from '@/lib/utils';

const variants = {
  default: {
    background: 'var(--surface-elevated)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-default)',
  },
  success: {
    background: 'var(--accent-success-muted)',
    color: 'var(--accent-success)',
    border: '1px solid color-mix(in oklch, var(--accent-success) 30%, transparent)',
  },
  warning: {
    background: 'var(--accent-warning-muted)',
    color: 'var(--accent-warning)',
    border: '1px solid color-mix(in oklch, var(--accent-warning) 30%, transparent)',
  },
  danger: {
    background: 'var(--accent-danger-muted)',
    color: 'var(--accent-danger)',
    border: '1px solid color-mix(in oklch, var(--accent-danger) 30%, transparent)',
  },
  info: {
    background: 'var(--accent-info-muted)',
    color: 'var(--accent-info)',
    border: '1px solid color-mix(in oklch, var(--accent-info) 30%, transparent)',
  },
  neutral: {
    background: 'var(--surface-secondary)',
    color: 'var(--text-tertiary)',
    border: '1px solid var(--border-subtle)',
  },
};

const sizes = {
  sm: { fontSize: '0.65rem', padding: '1px 6px', borderRadius: '10px' },
  default: { fontSize: '0.7rem', padding: '2px 8px', borderRadius: '12px' },
};

export function Badge({
  children,
  variant = 'default',
  size = 'default',
  className,
  style,
  ...props
}) {
  const v = variants[variant] || variants.default;
  const s = sizes[size] || sizes.default;

  return (
    <span
      className={cn(
        'inline-flex items-center font-medium whitespace-nowrap',
        className
      )}
      style={{
        background: v.background,
        color: v.color,
        border: v.border,
        fontSize: s.fontSize,
        padding: s.padding,
        borderRadius: s.borderRadius,
        lineHeight: 1.3,
        ...style,
      }}
      {...props}
    >
      {children}
    </span>
  );
}
