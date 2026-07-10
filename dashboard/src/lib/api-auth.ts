'use client';

import { getActiveCredential } from './device-auth';

// Attaches the active credential (a paired device token, or the shared
// NEXT_PUBLIC_AEGIS_API_KEY build-time key as a fallback — see
// lib/device-auth.ts) to same-origin /api/* fetch calls, so the many
// scattered `fetch('/api/...')` call sites across the app don't each need
// to remember to send it. Re-reads the credential per request (not just
// once at install time) since pairing can happen without a page reload.
// No-op when no credential is available, matching the backend's default
// unauthenticated dev-mode behavior.

let patched = false;

export function installApiAuthFetch() {
  if (patched || typeof window === 'undefined') return;
  patched = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    const credential = getActiveCredential();
    if (url && url.startsWith('/api/') && credential) {
      const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
      headers.set('x-api-key', credential);
      return originalFetch(input, { ...init, headers });
    }
    return originalFetch(input, init);
  };
}
