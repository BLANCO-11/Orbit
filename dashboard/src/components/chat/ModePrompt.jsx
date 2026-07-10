'use client';

import React from 'react';
import { Shield, Edit3, Zap, GitBranch } from 'lucide-react';

/**
 * ModePrompt — Full mode selection screen shown when no mode is set
 */
export function ModePrompt({ onSetMode }) {
  return (
    <div
      className="animate-fade-in"
      style={{
        maxWidth: '600px',
        margin: '0 auto var(--space-5) auto',
        padding: 'var(--space-5)',
        background: 'var(--accent-primary-muted)',
        border: '1px solid color-mix(in oklch, var(--accent-primary) 30%, transparent)',
        borderRadius: 'var(--radius-lg)',
        textAlign: 'center',
      }}
    >
      <h3
        className="text-h3"
        style={{ marginBottom: 'var(--space-3)' }}
      >
        Choose Agent Mode
      </h3>
      <p
        className="text-secondary"
        style={{ marginBottom: 'var(--space-4)' }}
      >
        Select how autonomous you want the agent to be. This applies for the
        entire session.
      </p>
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-3)',
          justifyContent: 'center',
          flexWrap: 'wrap',
        }}
      >
        {/* Plan Mode */}
        <button
          onClick={() => onSetMode('plan')}
          className="interactive-base focus-ring"
          style={{
            flex: '1',
            minWidth: '140px',
            padding: 'var(--space-4) var(--space-5)',
            background: 'var(--accent-info-muted)',
            border: '1px solid color-mix(in oklch, var(--accent-info) 30%, transparent)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--text-primary)',
            textAlign: 'left',
          }}
        >
          <Shield
            size={20}
            style={{ marginBottom: '6px', color: 'var(--accent-info)' }}
          />
          <div style={{ fontWeight: '700', fontSize: '0.95rem', marginBottom: '4px' }}>
            Plan Mode
          </div>
          <div className="text-tertiary" style={{ lineHeight: '1.4' }}>
            Agent plans the approach, explains what it will do, then asks for
            approval before any action.
          </div>
        </button>

        {/* Edit Mode */}
        <button
          onClick={() => onSetMode('edit')}
          className="interactive-base focus-ring"
          style={{
            flex: '1',
            minWidth: '140px',
            padding: 'var(--space-4) var(--space-5)',
            background: 'var(--accent-warning-muted)',
            border: '1px solid color-mix(in oklch, var(--accent-warning) 30%, transparent)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--text-primary)',
            textAlign: 'left',
          }}
        >
          <Edit3
            size={20}
            style={{ marginBottom: '6px', color: 'var(--accent-warning)' }}
          />
          <div style={{ fontWeight: '700', fontSize: '0.95rem', marginBottom: '4px' }}>
            Edit Mode
          </div>
          <div className="text-tertiary" style={{ lineHeight: '1.4' }}>
            Agent can read files freely but asks for approval before writing or
            editing anything.
          </div>
        </button>

        {/* YOLO Mode */}
        <button
          onClick={() => onSetMode('yolo')}
          className="interactive-base focus-ring"
          style={{
            flex: '1',
            minWidth: '140px',
            padding: 'var(--space-4) var(--space-5)',
            background: 'var(--accent-danger-muted)',
            border: '1px solid color-mix(in oklch, var(--accent-danger) 30%, transparent)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--text-primary)',
            textAlign: 'left',
          }}
        >
          <Zap
            size={20}
            style={{ marginBottom: '6px', color: 'var(--accent-danger)' }}
          />
          <div style={{ fontWeight: '700', fontSize: '0.95rem', marginBottom: '4px' }}>
            YOLO Mode
          </div>
          <div className="text-tertiary" style={{ lineHeight: '1.4' }}>
            Full autonomous execution. No approval prompts for any action.
          </div>
        </button>
      </div>
    </div>
  );
}

/**
 * ModeBadge — Compact mode indicator bar shown above the chat
 */
export function ModeBadge({ sessionMode }) {
  if (!sessionMode) return null;

  const getModeColor = () => {
    switch (sessionMode) {
      case 'plan': return 'var(--accent-info)';
      case 'edit': return 'var(--accent-warning)';
      case 'yolo': return 'var(--accent-danger)';
      default: return 'var(--accent-primary)';
    }
  };

  const getModeDesc = () => {
    switch (sessionMode) {
      case 'plan': return 'All actions require approval';
      case 'edit': return 'Reads auto-approved, writes need approval';
      case 'yolo': return 'Full autonomous execution';
      default: return '';
    }
  };

  const color = getModeColor();
  const bg = `color-mix(in oklch, ${color} 10%, transparent)`;
  const border = `color-mix(in oklch, ${color} 25%, transparent)`;

  return (
    <div
      className="animate-fade-in"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        margin: '0 auto var(--space-3) auto',
        padding: '6px 16px',
        maxWidth: '600px',
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: '20px',
        fontSize: '0.75rem',
        color: color,
      }}
    >
      <GitBranch size={12} style={{ flexShrink: 0 }} />
      <span style={{ fontWeight: '600' }}>{sessionMode.toUpperCase()}</span>
      <span style={{ opacity: 0.6 }}>&bull;</span>
      <span style={{ opacity: 0.8 }}>{getModeDesc()}</span>
    </div>
  );
}
