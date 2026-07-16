// @ts-nocheck
'use client';

import React from 'react';

// One small banner primitive (Workstream D5). The resume banner, the mode-
// suggestion prompt, and the HITL approval cards previously each hand-rolled the
// same `border-warning/40 bg-warning/8 rounded-[11px] p-4 shadow-card` chrome;
// they now share this so the in-chat banner visual language is defined once.

const TONES = {
  warning: 'border-warning/40 bg-warning/8',
  info: 'border-info/40 bg-info/8',
  danger: 'border-destructive/40 bg-destructive/8',
};

export default function Banner({ tone = 'warning', className = '', children }) {
  return (
    <div className={`rounded-[11px] border p-4 shadow-card ${TONES[tone] || TONES.warning} ${className}`}>
      {children}
    </div>
  );
}
