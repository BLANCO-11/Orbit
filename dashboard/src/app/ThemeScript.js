'use client';

import { useEffect } from 'react';

/**
 * ThemeScript — Inline script to prevent FOUC (flash of unstyled content)
 * Runs before React hydration to set the correct theme class.
 *
 * Also re-applies on mount to ensure consistency with localStorage.
 */
export function ThemeScript() {
  useEffect(() => {
    const stored = localStorage.getItem('aegis-theme');
    const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
    const theme = stored === 'light' || stored === 'dark'
      ? stored
      : prefersLight ? 'light' : 'dark';

    const root = document.documentElement;
    root.classList.remove('dark', 'light');
    root.classList.add(theme);
  }, []);

  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `
          (function() {
            try {
              var theme = localStorage.getItem('aegis-theme');
              if (!theme) {
                theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
              }
              document.documentElement.classList.remove('dark', 'light');
              document.documentElement.classList.add(theme);
            } catch(e) {}
          })();
        `,
      }}
    />
  );
}
