'use client';

import { useState, useEffect, useCallback } from 'react';

const THEME_KEY = 'orbit-theme'; // 'light' | 'dark'
const PALETTE_KEY = 'orbit-palette'; // one of PALETTES ids
const SYNC_EVENT = 'orbit-theme-sync';
const DEFAULT_MODE = 'light';
const DEFAULT_PALETTE = 'moss';

/**
 * Palette catalog. `light`/`dark` carry the swatch colors the picker
 * renders — the real tokens live in globals.css under
 * :root[data-palette="…"] blocks. Keep both in sync when adding a palette.
 */
export const PALETTES = [
  {
    id: 'moss',
    label: 'Moss',
    tagline: 'Olive on warm linen — the Orbit default',
    light: { bg: '#f6f4ee', surface: '#fdfcf8', accent: '#5f7a4e' },
    dark: { bg: '#131312', surface: '#1c1c1a', accent: '#93ac80' },
  },
  {
    id: 'terracotta',
    label: 'Terracotta',
    tagline: 'Baked clay, warm and bold',
    light: { bg: '#f6f4ee', surface: '#fdfcf8', accent: '#b45a38' },
    dark: { bg: '#131312', surface: '#1c1c1a', accent: '#d79070' },
  },
  {
    id: 'dusk',
    label: 'Dusk',
    tagline: 'Muted indigo, ink on paper',
    light: { bg: '#f6f4ee', surface: '#fdfcf8', accent: '#57539e' },
    dark: { bg: '#131312', surface: '#1c1c1a', accent: '#a29ddb' },
  },
  {
    id: 'sand',
    label: 'Sand',
    tagline: 'Bronze on dune, the warmest room',
    light: { bg: '#f6f1e4', surface: '#fdf9ee', accent: '#8d6e33' },
    dark: { bg: '#161511', surface: '#201f18', accent: '#c7a565' },
  },
  {
    id: 'slate',
    label: 'Slate',
    tagline: 'Cool stone and steel, zero warmth',
    light: { bg: '#f3f4f6', surface: '#ffffff', accent: '#46698c' },
    dark: { bg: '#101214', surface: '#191c20', accent: '#8fb3d1' },
  },
  {
    id: 'ink',
    label: 'Ink',
    tagline: 'Monochrome on linen, the most minimal',
    light: { bg: '#f6f4ee', surface: '#fdfcf8', accent: '#26241f' },
    dark: { bg: '#131312', surface: '#1c1c1a', accent: '#e6e2d9' },
  },
];

const PALETTE_IDS = new Set(PALETTES.map((p) => p.id));

/**
 * useTheme — light/dark mode plus a switchable palette preset.
 * Mode is a .dark class toggle (shadcn convention); the palette is a
 * data-palette attribute on <html>. Multiple hook instances (header
 * toggle, settings picker) stay in sync via a window event.
 */
export function useTheme() {
  const [mode, setMode] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_MODE;
    return localStorage.getItem(THEME_KEY) || DEFAULT_MODE;
  });

  const [palette, setPaletteState] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_PALETTE;
    return localStorage.getItem(PALETTE_KEY) || DEFAULT_PALETTE;
  });

  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const root = document.documentElement;
    root.classList.toggle('dark', mode === 'dark');
    root.style.colorScheme = mode;
    root.setAttribute('data-palette', palette);
    localStorage.setItem(THEME_KEY, mode);
    localStorage.setItem(PALETTE_KEY, palette);
    window.dispatchEvent(new Event(SYNC_EVENT));
  }, [mode, palette]);

  // Re-read storage when another hook instance (or another tab) changes it.
  // Same-value setState bails out, so the echo from our own dispatch is free.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sync = () => {
      setMode(localStorage.getItem(THEME_KEY) || DEFAULT_MODE);
      setPaletteState(localStorage.getItem(PALETTE_KEY) || DEFAULT_PALETTE);
    };
    window.addEventListener(SYNC_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(SYNC_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const setTheme = useCallback((next) => {
    if (next === 'light' || next === 'dark') setMode(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setMode(prev => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const setPalette = useCallback((next) => {
    if (PALETTE_IDS.has(next)) setPaletteState(next);
  }, []);

  return {
    theme: { mode, palette },
    mounted,
    setTheme,
    toggleTheme,
    setPalette,
    palettes: PALETTES,
  };
}
