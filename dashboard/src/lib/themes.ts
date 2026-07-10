// dashboard/src/lib/themes.js
// Built-in theme definitions — each theme is a map of CSS token → value
// Custom themes created in the dashboard follow the same shape.

const themes = {
  // ═══════════════════════════════════════════════════════════════
  // Dark Theme — "Deep Space" (Default)
  // Claude Code-inspired dark palette. Navy-black with purple-blue ambient.
  // ═══════════════════════════════════════════════════════════════
  "deep-space": {
    id: "deep-space",
    name: "Deep Space",
    mode: "dark",
    isBuiltin: true,
    colors: {
      "--bg-base": "#08080c",
      "--bg-ambient-1": "rgba(30, 30, 60, 0.6)",
      "--bg-ambient-2": "rgba(20, 10, 30, 0.4)",
      "--surface-primary": "rgba(22, 22, 30, 0.6)",
      "--surface-secondary": "rgba(28, 28, 38, 0.4)",
      "--surface-elevated": "rgba(35, 35, 48, 0.8)",
      "--border-subtle": "rgba(255, 255, 255, 0.04)",
      "--border-default": "rgba(255, 255, 255, 0.07)",
      "--border-strong": "rgba(255, 255, 255, 0.14)",
      "--text-primary": "#ececee",
      "--text-secondary": "#8b8b90",
      "--text-tertiary": "#52525a",
      "--text-inverse": "#08080c",
      "--text-link": "#7c6ff7",
      "--accent-primary": "#6c5ce7",
      "--accent-primary-hover": "#7c6ff7",
      "--accent-primary-glow": "rgba(108, 92, 231, 0.25)",
      "--accent-primary-muted": "rgba(108, 92, 231, 0.12)",
      "--accent-success": "#00d68f",
      "--accent-success-muted": "rgba(0, 214, 143, 0.12)",
      "--accent-warning": "#ffaa00",
      "--accent-warning-muted": "rgba(255, 170, 0, 0.12)",
      "--accent-danger": "#ff3b5c",
      "--accent-danger-muted": "rgba(255, 59, 92, 0.12)",
      "--accent-info": "#54a0ff",
      "--accent-info-muted": "rgba(84, 160, 255, 0.12)",
      "--accent-purple": "#a855f7",
      "--accent-purple-muted": "rgba(168, 85, 247, 0.12)",
    },
    typography: {
      fontSans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      fontMono: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // Light Theme — "Frost"
  // Clean, bright, airy. White surfaces with cool undertones.
  // ═══════════════════════════════════════════════════════════════
  "frost": {
    id: "frost",
    name: "Frost",
    mode: "light",
    isBuiltin: true,
    colors: {
      "--bg-base": "#f8f8fa",
      "--bg-ambient-1": "rgba(230, 235, 250, 0.5)",
      "--bg-ambient-2": "rgba(240, 235, 250, 0.4)",
      "--surface-primary": "rgba(255, 255, 255, 0.75)",
      "--surface-secondary": "rgba(245, 245, 250, 0.55)",
      "--surface-elevated": "rgba(255, 255, 255, 0.9)",
      "--border-subtle": "rgba(0, 0, 0, 0.05)",
      "--border-default": "rgba(0, 0, 0, 0.1)",
      "--border-strong": "rgba(0, 0, 0, 0.18)",
      "--text-primary": "#1a1a1e",
      "--text-secondary": "#6b6b73",
      "--text-tertiary": "#9b9ba3",
      "--text-inverse": "#ffffff",
      "--text-link": "#5b4cdb",
      "--accent-primary": "#5b4cdb",
      "--accent-primary-hover": "#4a3cc4",
      "--accent-primary-glow": "rgba(91, 76, 219, 0.15)",
      "--accent-primary-muted": "rgba(91, 76, 219, 0.08)",
      "--accent-success": "#00b37a",
      "--accent-success-muted": "rgba(0, 179, 122, 0.08)",
      "--accent-warning": "#e69500",
      "--accent-warning-muted": "rgba(230, 149, 0, 0.08)",
      "--accent-danger": "#e62e4d",
      "--accent-danger-muted": "rgba(230, 46, 77, 0.08)",
      "--accent-info": "#3b8cff",
      "--accent-info-muted": "rgba(59, 140, 255, 0.08)",
      "--accent-purple": "#9333ea",
      "--accent-purple-muted": "rgba(147, 51, 234, 0.08)",
    },
    typography: {
      fontSans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      fontMono: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // Dark Theme — "Forest"
  // Green-tinted dark palette. Calm, nature-inspired.
  // ═══════════════════════════════════════════════════════════════
  "forest": {
    id: "forest",
    name: "Forest",
    mode: "dark",
    isBuiltin: true,
    colors: {
      "--bg-base": "#0a0f0a",
      "--bg-ambient-1": "rgba(15, 40, 20, 0.5)",
      "--bg-ambient-2": "rgba(10, 25, 10, 0.4)",
      "--surface-primary": "rgba(20, 28, 22, 0.6)",
      "--surface-secondary": "rgba(26, 34, 28, 0.4)",
      "--surface-elevated": "rgba(32, 40, 34, 0.8)",
      "--border-subtle": "rgba(255, 255, 255, 0.04)",
      "--border-default": "rgba(255, 255, 255, 0.07)",
      "--border-strong": "rgba(255, 255, 255, 0.14)",
      "--text-primary": "#e0e8e0",
      "--text-secondary": "#8a968a",
      "--text-tertiary": "#505a50",
      "--text-inverse": "#0a0f0a",
      "--text-link": "#4ade80",
      "--accent-primary": "#22c55e",
      "--accent-primary-hover": "#4ade80",
      "--accent-primary-glow": "rgba(34, 197, 94, 0.25)",
      "--accent-primary-muted": "rgba(34, 197, 94, 0.12)",
      "--accent-success": "#10b981",
      "--accent-success-muted": "rgba(16, 185, 129, 0.12)",
      "--accent-warning": "#f59e0b",
      "--accent-warning-muted": "rgba(245, 158, 11, 0.12)",
      "--accent-danger": "#ef4444",
      "--accent-danger-muted": "rgba(239, 68, 68, 0.12)",
      "--accent-info": "#38bdf8",
      "--accent-info-muted": "rgba(56, 189, 248, 0.12)",
      "--accent-purple": "#a78bfa",
      "--accent-purple-muted": "rgba(167, 139, 250, 0.12)",
    },
    typography: {
      fontSans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      fontMono: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // Dark Theme — "Ocean"
  // Blue-tinted dark palette. Calm, focused.
  // ═══════════════════════════════════════════════════════════════
  "ocean": {
    id: "ocean",
    name: "Ocean",
    mode: "dark",
    isBuiltin: true,
    colors: {
      "--bg-base": "#0a0e14",
      "--bg-ambient-1": "rgba(10, 30, 60, 0.5)",
      "--bg-ambient-2": "rgba(5, 20, 40, 0.4)",
      "--surface-primary": "rgba(18, 24, 34, 0.6)",
      "--surface-secondary": "rgba(24, 30, 40, 0.4)",
      "--surface-elevated": "rgba(30, 38, 50, 0.8)",
      "--border-subtle": "rgba(255, 255, 255, 0.04)",
      "--border-default": "rgba(255, 255, 255, 0.07)",
      "--border-strong": "rgba(255, 255, 255, 0.14)",
      "--text-primary": "#e0e8f0",
      "--text-secondary": "#8899aa",
      "--text-tertiary": "#4a5a6a",
      "--text-inverse": "#0a0e14",
      "--text-link": "#60a5fa",
      "--accent-primary": "#3b82f6",
      "--accent-primary-hover": "#60a5fa",
      "--accent-primary-glow": "rgba(59, 130, 246, 0.25)",
      "--accent-primary-muted": "rgba(59, 130, 246, 0.12)",
      "--accent-success": "#34d399",
      "--accent-success-muted": "rgba(52, 211, 153, 0.12)",
      "--accent-warning": "#fbbf24",
      "--accent-warning-muted": "rgba(251, 191, 36, 0.12)",
      "--accent-danger": "#f87171",
      "--accent-danger-muted": "rgba(248, 113, 113, 0.12)",
      "--accent-info": "#38bdf8",
      "--accent-info-muted": "rgba(56, 189, 248, 0.12)",
      "--accent-purple": "#c084fc",
      "--accent-purple-muted": "rgba(192, 132, 252, 0.12)",
    },
    typography: {
      fontSans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      fontMono: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // Light Theme — "Sepia"
  // Warm paper-like light theme. Easy on the eyes.
  // ═══════════════════════════════════════════════════════════════
  "sepia": {
    id: "sepia",
    name: "Sepia",
    mode: "light",
    isBuiltin: true,
    colors: {
      "--bg-base": "#faf8f5",
      "--bg-ambient-1": "rgba(250, 240, 220, 0.5)",
      "--bg-ambient-2": "rgba(245, 235, 215, 0.4)",
      "--surface-primary": "rgba(255, 252, 248, 0.8)",
      "--surface-secondary": "rgba(248, 244, 238, 0.6)",
      "--surface-elevated": "rgba(255, 255, 252, 0.92)",
      "--border-subtle": "rgba(0, 0, 0, 0.06)",
      "--border-default": "rgba(0, 0, 0, 0.12)",
      "--border-strong": "rgba(0, 0, 0, 0.2)",
      "--text-primary": "#3d3427",
      "--text-secondary": "#7a6e5e",
      "--text-tertiary": "#a89880",
      "--text-inverse": "#faf8f5",
      "--text-link": "#b85c38",
      "--accent-primary": "#b85c38",
      "--accent-primary-hover": "#c97a50",
      "--accent-primary-glow": "rgba(184, 92, 56, 0.15)",
      "--accent-primary-muted": "rgba(184, 92, 56, 0.08)",
      "--accent-success": "#6b8e23",
      "--accent-success-muted": "rgba(107, 142, 35, 0.08)",
      "--accent-warning": "#c78500",
      "--accent-warning-muted": "rgba(199, 133, 0, 0.08)",
      "--accent-danger": "#c0392b",
      "--accent-danger-muted": "rgba(192, 57, 43, 0.08)",
      "--accent-info": "#2980b9",
      "--accent-info-muted": "rgba(41, 128, 185, 0.08)",
      "--accent-purple": "#8e44ad",
      "--accent-purple-muted": "rgba(142, 68, 173, 0.08)",
    },
    typography: {
      fontSans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      fontMono: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // High Contrast — Accessible
  // Pure black/white for maximum contrast and accessibility.
  // ═══════════════════════════════════════════════════════════════
  "high-contrast": {
    id: "high-contrast",
    name: "High Contrast",
    mode: "dark",
    isBuiltin: true,
    colors: {
      "--bg-base": "#000000",
      "--bg-ambient-1": "transparent",
      "--bg-ambient-2": "transparent",
      "--surface-primary": "rgba(20, 20, 20, 0.9)",
      "--surface-secondary": "rgba(30, 30, 30, 0.8)",
      "--surface-elevated": "rgba(40, 40, 40, 0.95)",
      "--border-subtle": "rgba(255, 255, 255, 0.1)",
      "--border-default": "rgba(255, 255, 255, 0.2)",
      "--border-strong": "rgba(255, 255, 255, 0.35)",
      "--text-primary": "#ffffff",
      "--text-secondary": "#cccccc",
      "--text-tertiary": "#999999",
      "--text-inverse": "#000000",
      "--text-link": "#66b3ff",
      "--accent-primary": "#3399ff",
      "--accent-primary-hover": "#66b3ff",
      "--accent-primary-glow": "rgba(51, 153, 255, 0.3)",
      "--accent-primary-muted": "rgba(51, 153, 255, 0.15)",
      "--accent-success": "#33ff66",
      "--accent-success-muted": "rgba(51, 255, 102, 0.15)",
      "--accent-warning": "#ffcc00",
      "--accent-warning-muted": "rgba(255, 204, 0, 0.15)",
      "--accent-danger": "#ff3333",
      "--accent-danger-muted": "rgba(255, 51, 51, 0.15)",
      "--accent-info": "#66ccff",
      "--accent-info-muted": "rgba(102, 204, 255, 0.15)",
      "--accent-purple": "#cc66ff",
      "--accent-purple-muted": "rgba(204, 102, 255, 0.15)",
    },
    typography: {
      fontSans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      fontMono: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
    },
  },
};

// Default theme ID
const DEFAULT_THEME_ID = "frost";

// All valid CSS variable token names that themes must provide
const THEME_TOKEN_NAMES = Object.keys(themes["deep-space"].colors);

export { themes, DEFAULT_THEME_ID, THEME_TOKEN_NAMES };
