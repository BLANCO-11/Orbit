'use client';

import { useState, useEffect, useCallback } from 'react';
import { themes as builtinThemes, DEFAULT_THEME_ID, THEME_TOKEN_NAMES } from '@/lib/themes';

const ACTIVE_THEME_KEY = 'aegis-active-theme';
const CUSTOM_THEMES_KEY = 'aegis-custom-themes';
const LEGACY_KEY = 'aegis-theme'; // migration from old key

/**
 * useTheme — Full theme management hook.
 *
 * Supports:
 *  - Built-in themes (6 included)
 *  - Custom themes (created, edited, saved in localStorage)
 *  - Light/dark mode toggle
 *  - Applying theme to :root
 *  - Legacy migration from old 'aegis-theme' key
 */
export function useTheme() {
  // ── Load active theme ID ──
  const [activeThemeId, setActiveThemeIdState] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_THEME_ID;
    const stored = localStorage.getItem(ACTIVE_THEME_KEY);
    if (stored && getAllThemes()[stored]) return stored;
    // Legacy migration
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy === 'light') return 'frost';
    return DEFAULT_THEME_ID;
  });

  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // ── Current active theme object ──
  const theme = getAllThemes()[activeThemeId] || builtinThemes[DEFAULT_THEME_ID];

  // ── Apply theme to :root ──
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const root = document.documentElement;

    // Apply all color tokens
    Object.entries(theme.colors as Record<string, string>).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });

    // Apply typography
    if (theme.typography) {
      root.style.setProperty('--font-sans', theme.typography.fontSans);
      root.style.setProperty('--font-mono', theme.typography.fontMono);
    }

    // Set mode class
    if (theme.mode === 'light') {
      root.classList.add('light');
      root.classList.remove('dark');
    } else {
      root.classList.add('dark');
      root.classList.remove('light');
    }

    // Persist active theme ID
    localStorage.setItem(ACTIVE_THEME_KEY, activeThemeId);
    // Clean up legacy key
    localStorage.removeItem(LEGACY_KEY);
  }, [theme, activeThemeId]);

  // ── Theme switching ──
  const setTheme = useCallback((themeId) => {
    if (getAllThemes()[themeId]) {
      setActiveThemeIdState(themeId);
    }
  }, []);

  // Toggle between dark and light built-in themes.
  // Note: 'deep-space' (not DEFAULT_THEME_ID) is hardcoded as the dark target —
  // DEFAULT_THEME_ID is 'frost' (light) since that's the app default, so it can't
  // also stand in for "the default dark theme" here.
  const toggleTheme = useCallback(() => {
    setActiveThemeIdState(prev => {
      const current = getAllThemes()[prev];
      if (!current) return DEFAULT_THEME_ID;
      if (current.mode === 'dark') return 'frost'; // switch to light
      return 'deep-space'; // switch to dark
    });
  }, []);

  // ── Custom theme CRUD ──
  const createCustomTheme = useCallback((name, mode, colors) => {
    const id = 'custom-' + Date.now();
    const custom = { id, name, mode, isBuiltin: false, colors, typography: theme.typography };
    const customThemes = getCustomThemes();
    customThemes[id] = custom;
    localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(customThemes));
    setActiveThemeIdState(id);
    return custom;
  }, [theme.typography]);

  const updateCustomTheme = useCallback((id, updates) => {
    const customThemes = getCustomThemes();
    if (customThemes[id]) {
      customThemes[id] = { ...customThemes[id], ...updates };
      localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(customThemes));
      // Force re-render if updating the active theme
      if (id === activeThemeId) {
        setActiveThemeIdState(id); // triggers re-apply
      }
    }
  }, [activeThemeId]);

  const deleteCustomTheme = useCallback((id) => {
    const customThemes = getCustomThemes();
    delete customThemes[id];
    localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(customThemes));
    if (id === activeThemeId) {
      setActiveThemeIdState(DEFAULT_THEME_ID);
    }
  }, [activeThemeId]);

  return {
    theme,
    themes: getAllThemes(),
    activeThemeId,
    mounted,
    setTheme,
    toggleTheme,
    createCustomTheme,
    updateCustomTheme,
    deleteCustomTheme,
  };
}

// ── Helpers ──────────────────────────────────────────────────────

function getCustomThemes() {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(CUSTOM_THEMES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function getAllThemes() {
  return { ...builtinThemes, ...getCustomThemes() };
}
