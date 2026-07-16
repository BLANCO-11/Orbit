// dashboard/src/app/ThemeScript.tsx
// Inline script to prevent FOUC — runs before React hydration.
// Sets the .dark class and data-palette attribute on <html> before any rendering.

export function ThemeScript() {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `
          (function() {
            try {
              var mode = localStorage.getItem('orbit-theme') || 'light';
              var palette = localStorage.getItem('orbit-palette') || 'moss';
              document.documentElement.classList.toggle('dark', mode === 'dark');
              document.documentElement.style.colorScheme = mode;
              document.documentElement.setAttribute('data-palette', palette);
            } catch(e) {}
          })();
        `,
      }}
    />
  );
}
