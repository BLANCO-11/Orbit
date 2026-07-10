'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, ChevronRight, Shield, Edit3, Zap } from 'lucide-react';

const MODES = [
  {
    id: 'plan',
    label: 'Plan',
    desc: 'All actions require approval',
    color: 'var(--accent-info)',
  },
  {
    id: 'edit',
    label: 'Edit',
    desc: 'Reads free, writes need approval',
    color: 'var(--accent-warning)',
  },
  {
    id: 'yolo',
    label: 'YOLO',
    desc: 'Full autonomous execution',
    color: 'var(--accent-danger)',
  },
];

/**
 * ModeSelector — Dropdown button for Plan / Edit / YOLO modes.
 *
 * Props:
 *   sessionMode — current mode string ('plan' | 'edit' | 'yolo' | '')
 *   onSetSessionMode — (mode: string) => void
 */
export default function ModeSelector({ sessionMode, onSetSessionMode }) {
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

  const getModeColor = (modeId) => {
    const m = MODES.find((m) => m.id === modeId);
    return m ? m.color : 'var(--accent-primary)';
  };

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={() => setOpen((prev) => !prev)}
        title="Switch agent mode"
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
        {sessionMode ? (
          <span style={{ color: getModeColor(sessionMode) }}>
            {sessionMode.toUpperCase()}
          </span>
        ) : (
          <span>CHAT</span>
        )}
        <ChevronDown size={12} style={{ opacity: 0.5 }} />
      </button>

      {open && (
        <div
          className="animate-scale-in"
          style={{
            position: 'absolute',
            bottom: '38px',
            left: '0',
            minWidth: '200px',
            background: 'var(--surface-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            zIndex: 40,
            overflow: 'hidden',
            padding: '4px',
          }}
        >
          {MODES.map((m) => {
            const isActive = (sessionMode || '') === m.id;
            return (
              <button
                key={m.id}
                onClick={() => {
                  onSetSessionMode(isActive ? '' : m.id);
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
                  color: isActive ? m.color : 'var(--text-secondary)',
                  fontSize: '0.78rem',
                  textAlign: 'left',
                  gap: '8px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                  }}
                >
                  <span style={{ fontWeight: '600' }}>{m.label}</span>
                  <span
                    style={{
                      fontSize: '0.65rem',
                      color: 'var(--text-tertiary)',
                    }}
                  >
                    {m.desc}
                  </span>
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
