'use client';

// Client-side storage for the active request credential. The same slot holds
// whatever the user signed in with — a local superadmin key, an SSO session
// token, or a device token from URL/OTP pairing (agent-backend/routes/devices.js).
// There is no build-time key fallback: login is explicit (see app/page.tsx
// LoginPage), so a keyed backend shows the login page instead of silently
// authenticating.

const DEVICE_TOKEN_KEY = 'orbit-device-token';

export function getDeviceToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(DEVICE_TOKEN_KEY);
}

export function setDeviceToken(token) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(DEVICE_TOKEN_KEY, token);
}

export function clearDeviceToken() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(DEVICE_TOKEN_KEY);
}

// The credential to attach to API/WS requests: whatever the user logged in with
// — a local superadmin key, an SSO session token, or a paired device token —
// all stored in the same slot (see setDeviceToken). No build-time key fallback:
// login is explicit, so when the backend requires auth the app shows the login
// page instead of silently authenticating from a bundled key. In dev-mode (no
// ORBIT_SUPERADMIN_KEY) the backend allows unauthenticated access, so a null
// credential still lands straight in.
export function getActiveCredential() {
  return getDeviceToken() || null;
}
