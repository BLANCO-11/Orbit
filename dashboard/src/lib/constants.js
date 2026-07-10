/**
 * AegisAgent Design Tokens (JS)
 * Used for inline styles and dynamic values.
 */

export const SPACING = {
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  8: '32px',
  10: '40px',
  12: '48px',
  16: '64px',
};

export const RADIUS = {
  sm: '6px',
  md: '10px',
  lg: '14px',
  xl: '18px',
  full: '9999px',
};

export const HEADER = {
  height: '56px',
};

export const SIDEBAR = {
  width: '260px',
};

export const RIGHT_PANEL = {
  width: '360px',
};

export const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
};

export const STATUS_COLORS = {
  idle: 'var(--text-tertiary)',
  thinking: 'var(--accent-warning)',
  executing: 'var(--accent-info)',
  waiting_approval: 'var(--accent-warning)',
  done: 'var(--accent-success)',
  error: 'var(--accent-danger)',
};

export const STATUS_LABELS = {
  idle: 'Idle',
  thinking: 'Thinking',
  executing: 'Executing',
  waiting_approval: 'Awaiting Approval',
  done: 'Done',
  error: 'Error',
};

export const MODE_CONFIG = [
  {
    id: 'plan',
    label: 'Plan',
    desc: 'Plan then approve',
    color: 'var(--accent-info)',
  },
  {
    id: 'edit',
    label: 'Edit',
    desc: 'Read free, write needs ok',
    color: 'var(--accent-warning)',
  },
  {
    id: 'yolo',
    label: 'YOLO',
    desc: 'Full autonomy',
    color: 'var(--accent-danger)',
  },
];

export const TASK_MODES = [
  { value: 'normal', label: 'Normal Model Only (Fast)' },
  { value: 'reasoning', label: 'Reasoning Model Only (Deep)' },
  { value: 'hybrid', label: 'Hybrid Orchestrator (Plan + Exec)' },
];

export const SYSTEM_PROMPT_TYPES = [
  { value: 'standard', label: 'Standard PA Prompt' },
  { value: 'fable-5', label: 'Claude Fable 5 Leak Prompt' },
];
