'use client';

// Client-side storage for the device token obtained via URL/OTP pairing
// (see agent-backend/routes/devices.js). Falls back to the build-time
// NEXT_PUBLIC_AEGIS_API_KEY shared-secret (lib/api-auth.ts) for simple
// single-device setups that haven't paired anything.

const DEVICE_TOKEN_KEY = 'aegis-device-token';

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

// The credential to attach to API/WS requests — a paired device token if
// one exists, otherwise the shared build-time key (may be undefined, in
// which case the backend's own dev-mode fallback applies).
export function getActiveCredential() {
  return getDeviceToken() || process.env.NEXT_PUBLIC_AEGIS_API_KEY || null;
}
