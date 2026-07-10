'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, ChevronRight, FileText, Cpu } from 'lucide-react';

const PROMPT_TYPES = [
  {
    id: 'standard',
    label: 'Standard',
    desc: 'Standard PA Prompt',
    color: 'var(--accent-info)',
    icon: FileText
  },
  {
    id: 'fable-5',
    label: 'Fable 5',
    desc: 'Claude Fable 5 Leak Prompt',
    color: 'var(--accent-primary)',
    icon: Cpu
  }
];

export default function PromptTypeSelector({ systemPromptType, onSetSystemPromptType }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('mousedown', handleClick);
    }
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const getPromptTypeColor = (typeId) => {
    const p = PROMPT_TYPES.find((p) => p.id === typeId);
    return p ? p.color : 'var(--text-secondary)';
  };

  const getPromptTypeLabel = (typeId) => {
    const p = PROMPT_TYPES.find((p) => p.id === typeId);
    return p ? p.label : 'Standard';
  };

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={() => setOpen((prev) => !prev)}
        title="Switch system prompt type"
        className="interactive-base focus-ring"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          height: '32px',
          padding: '0 10px',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border-subtle)',
          background: 'rgba(255, 255, 255, 0.03)',
          color: 'var(--text-secondary)',
          fontSize: '0.72rem',
          fontWeight: '600',
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ color: getPromptTypeColor(systemPromptType || 'standard') }}>
          PROMPT: {getPromptTypeLabel(systemPromptType || 'standard').toUpperCase()}
        </span>
        <ChevronDown size={12} style={{ opacity: 0.5 }} />
      </button>

      {open && (
        <div
          className="animate-scale-in"
          style={{
            position: 'absolute',
            bottom: '38px',
            left: '0',
            minWidth: '220px',
            background: 'var(--surface-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            zIndex: 40,
            overflow: 'hidden',
            padding: '4px',
          }}
        >
          {PROMPT_TYPES.map((p) => {
            const isActive = (systemPromptType || 'standard') === p.id;
            const Icon = p.icon;
            return (
              <button
                key={p.id}
                onClick={() => {
                  onSetSystemPromptType(p.id);
                  setOpen(false);
                }}
                className="interactive-base focus-ring"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '6px',
                  border: 'none',
                  background: isActive
                    ? 'var(--accent-primary-muted)'
                    : 'transparent',
                  color: isActive ? p.color : 'var(--text-secondary)',
                  fontSize: '0.78rem',
                  textAlign: 'left',
                  gap: '8px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Icon size={14} style={{ color: isActive ? p.color : 'var(--text-tertiary)' }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontWeight: '600' }}>{p.label}</span>
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)' }}>{p.desc}</span>
                  </div>
                </div>
                {isActive && (
                  <ChevronRight size={14} style={{ opacity: 0.5, flexShrink: 0 }} />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
