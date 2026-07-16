'use client';

import { useCallback, useEffect, useState } from 'react';

// The caller's identity, from GET /api/auth/whoami. In a local/household deploy
// (no ORBIT_SUPERADMIN_KEY) the backend runs in dev-mode and returns superadmin,
// so the whole RBAC layer stays invisible unless an operator opts into it.
export interface AuthIdentity {
  role: 'superadmin' | 'admin' | 'member' | 'viewer';
  tenantId: string | null;
  tenantName: string | null;
  email: string | null;
  devMode: boolean;
  isSuperadmin: boolean;
  isAdmin: boolean;
  ssoEnabled: boolean;
  ssoConfigured: boolean;
}

export interface UseAuthResult {
  auth: AuthIdentity | null;
  loading: boolean;
  authenticated: boolean;
  /** SSO available for the login screen (known even while unauthenticated). */
  ssoAvailable: boolean;
  refetch: () => void;
}

export function useAuth(): UseAuthResult {
  const [auth, setAuth] = useState<AuthIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [ssoAvailable, setSsoAvailable] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/auth/whoami')
      .then(async (r) => {
        if (r.ok) {
          const d = await r.json();
          if (d && d.success) {
            setAuth(d as AuthIdentity);
            setSsoAvailable(!!d.ssoEnabled);
            return;
          }
        }
        // Unauthenticated (a superadmin key is set but the browser has no valid
        // credential). Fall back to the public SSO-status probe so the login
        // screen knows whether to offer the SSO button.
        setAuth(null);
        try {
          const s = await fetch('/api/auth/sso/status').then((x) => x.json());
          setSsoAvailable(!!(s && s.enabled));
        } catch {
          setSsoAvailable(false);
        }
      })
      .catch(() => {
        setAuth(null);
        setSsoAvailable(false);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  return {
    auth,
    loading,
    authenticated: auth !== null,
    ssoAvailable,
    refetch: load,
  };
}
