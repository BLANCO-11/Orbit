'use client';

// Attaches the shared API key (see agent-backend/middleware/auth.js) to same-origin
// /api/* fetch calls, so the many scattered `fetch('/api/...')` call sites across the
// app don't each need to remember to send it. No-op unless NEXT_PUBLIC_AEGIS_API_KEY
// is set, matching the backend's default unauthenticated dev-mode behavior.

let patched = false;

export function installApiAuthFetch() {
  if (patched || typeof window === 'undefined') return;
  patched = true;

  const key = process.env.NEXT_PUBLIC_AEGIS_API_KEY;
  if (!key) return;

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    if (url && url.startsWith('/api/')) {
      const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
      headers.set('x-api-key', key);
      return originalFetch(input, { ...init, headers });
    }
    return originalFetch(input, init);
  };
}
