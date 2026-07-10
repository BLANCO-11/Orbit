// dashboard/src/app/ThemeScript.tsx
// Inline script to prevent FOUC — runs before React hydration.
// Sets the correct theme class on <html> before any rendering.

export function ThemeScript() {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `
          (function() {
            try {
              var id = localStorage.getItem('aegis-active-theme') || 'frost';
              // Map theme ID to mode class
              var darkThemes = ['deep-space','forest','ocean','high-contrast'];
              var isDark = darkThemes.indexOf(id) !== -1;
              // Custom themes: check stored definition
              if (isDark === false) {
                try {
                  var custom = JSON.parse(localStorage.getItem('aegis-custom-themes') || '{}');
                  if (custom[id]) isDark = custom[id].mode === 'dark';
                } catch(e) {}
              }
              document.documentElement.classList.remove('dark', 'light');
              document.documentElement.classList.add(isDark ? 'dark' : 'light');
            } catch(e) {}
          })();
        `,
      }}
    />
  );
}
