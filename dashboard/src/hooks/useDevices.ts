'use client';

import { useState, useCallback, useEffect } from 'react';

/**
 * useDevices — paired-device list + URL/OTP pairing flow (see
 * agent-backend/routes/devices.js). Used by the Settings panel's
 * "Paired Devices" section.
 */
export function useDevices() {
  const [devices, setDevices] = useState([]);
  const [pairing, setPairing] = useState(null); // { code, expiresAt, pairingUrl } | null

  const fetchDevices = useCallback(() => {
    fetch('/api/devices')
      .then(res => res.json())
      .then(data => { if (data.success) setDevices(data.devices); })
      .catch(() => {});
  }, []);

  useEffect(() => { fetchDevices(); }, [fetchDevices]);

  const startPairing = useCallback((label, scope = 'full') => {
    fetch('/api/pair/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: label || 'New device', scope }),
    })
      .then(res => res.json())
      .then(data => { if (data.success) setPairing(data); })
      .catch(() => {});
  }, []);

  const clearPairing = useCallback(() => setPairing(null), []);

  const renameDevice = useCallback((id, label) => {
    fetch(`/api/devices/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label }),
    }).then(fetchDevices).catch(() => {});
  }, [fetchDevices]);

  const revokeDevice = useCallback((id) => {
    fetch(`/api/devices/${id}`, { method: 'DELETE' }).then(fetchDevices).catch(() => {});
  }, [fetchDevices]);

  return { devices, pairing, startPairing, clearPairing, renameDevice, revokeDevice, refreshDevices: fetchDevices };
}
