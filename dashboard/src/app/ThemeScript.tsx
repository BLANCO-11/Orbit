// dashboard/src/app/ThemeScript.tsx
// Inline script to prevent FOUC — runs before React hydration.
// Sets the .dark class on <html> before any rendering.

export function ThemeScript() {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `
          (function() {
            try {
              var mode = localStorage.getItem('aegis-theme') || 'light';
              document.documentElement.classList.toggle('dark', mode === 'dark');
              document.documentElement.style.colorScheme = mode;
            } catch(e) {}
          })();
        `,
      }}
    />
  );
}
