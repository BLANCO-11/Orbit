'use client';

import { useState, useEffect, useCallback } from 'react';

const THEME_KEY = 'aegis-theme'; // 'light' | 'dark'
const DEFAULT_MODE = 'light';

/**
 * useTheme — light/dark mode, matching plain shadcn convention (a single
 * .dark class toggle, no bespoke multi-theme system).
 */
export function useTheme() {
  const [mode, setMode] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_MODE;
    return localStorage.getItem(THEME_KEY) || DEFAULT_MODE;
  });

  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const root = document.documentElement;
    root.classList.toggle('dark', mode === 'dark');
    root.style.colorScheme = mode;
    localStorage.setItem(THEME_KEY, mode);
  }, [mode]);

  const setTheme = useCallback((next) => {
    if (next === 'light' || next === 'dark') setMode(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setMode(prev => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  return {
    theme: { mode },
    mounted,
    setTheme,
    toggleTheme,
  };
}
