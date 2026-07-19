// agent-backend/middleware/auth.js
// Authentication + RBAC. A presented credential is resolved to an identity
// (`req.auth = { role, tenantId, keyId?, userId?, deviceId? }`) in priority
// order:
//   1. superadmin env key         → { role: 'superadmin' }        (the operator)
//   2. paired device token        → role from the device scope    (Fleet devices)
//   3. tenant API key             → row's role + tenant           (multi-tenant)
//   4. SSO browser session token  → user's role + tenant          (enterprise login)
//   5. no superadmin key set      → dev-mode: allow as superadmin (household/local)
//
// RBAC degrades gracefully: a single-user deploy sets nothing and everything
// works (case 5, or one env key = case 1). Tenants/keys/SSO only matter once an
// operator opts into them. Secrets never come from security-config.json (which
// is writable via an API route and must not be able to reset its own guard).

// Map a device pairing scope → an RBAC role. Devices are operator-paired, so a
// full-scope device acts as an admin; restricted scopes are members/viewers.
function roleForDeviceScope(scope) {
  if (scope === "read_only") return "viewer";
  if (scope === "chat_voice") return "member";
  return "admin";
}

function getSuperadminKey() {
  // ORBIT_SUPERADMIN_KEY is the current name. ORBIT_API_KEY (pre-multi-tenant)
  // and AEGIS_API_KEY (pre-rebrand) are kept as fallbacks so existing .env
  // files keep working unchanged.
  return (
    process.env.ORBIT_SUPERADMIN_KEY ||
    process.env.ORBIT_API_KEY ||
    process.env.AEGIS_API_KEY ||
    null
  );
}

// Legacy alias — some call sites/tests import getSharedApiKey. Same value.
function getSharedApiKey() {
  return getSuperadminKey();
}

// Resolve the presented credential to an identity, or null if unauthenticated.
// Attaches nothing itself — the caller sets req.auth from the return value.
async function resolveIdentity(req, db) {
  const provided =
    req.headers["x-api-key"] ||
    (req.headers["authorization"] || "").replace("Bearer ", "");

  const superadminKey = getSuperadminKey();

  // 1. Superadmin env key (constant-time-ish exact match).
  if (superadminKey && provided && provided === superadminKey) {
    return { role: "superadmin", tenantId: null };
  }

  if (db && provided) {
    // 2. Paired device token.
    const device = await db.getDeviceByToken(provided);
    if (device) {
      await db.touchDeviceLastSeen(device.id);
      return {
        role: roleForDeviceScope(device.scope),
        tenantId: device.tenantId || null,
        deviceId: device.id,
        scope: device.scope,
      };
    }

    // 3. Tenant API key.
    const apiKey = await db.getApiKeyByToken(provided);
    if (apiKey) {
      await db.touchApiKeyUsed(apiKey.id);
      return {
        role: apiKey.role,
        tenantId: apiKey.tenantId || null,
        keyId: apiKey.id,
        scope: apiKey.scope,
      };
    }

    // 4. SSO browser session token.
    const sso = await db.getSsoSessionByToken(provided);
    if (sso && sso.user) {
      return {
        role: sso.user.role,
        tenantId: sso.user.tenantId || null,
        userId: sso.user.id,
        email: sso.user.email,
        username: sso.user.username || null,
      };
    }
  }

  // 5. No superadmin key configured and no matching credential: dev-mode.
  // Allow through as superadmin so a local/household setup is fully usable with
  // zero config (matches the pre-multi-tenant unauthenticated behavior).
  if (!superadminKey) {
    return { role: "superadmin", tenantId: null, devMode: true };
  }

  return null;
}

// Back-compat boolean check used by a couple of call sites (WS handshake).
async function checkApiKey(req, db) {
  return (await resolveIdentity(req, db)) !== null;
}

function createAuthMiddleware(db) {
  return async function authMiddleware(req, res, next) {
    let identity;
    try {
      identity = await resolveIdentity(req, db);
    } catch (e) {
      // A DB error while authenticating fails CLOSED (never silently allow).
      console.error("[auth] resolveIdentity failed:", e.message);
      return res.status(500).json({ success: false, message: "Authentication backend error." });
    }
    if (!identity) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="Orbit"');
      return res.status(401).json({ success: false, message: "Unauthorized: invalid or missing API key." });
    }
    req.auth = identity;
    next();
  };
}

// Route guard: require the caller's role to be one of `roles`. superadmin always
// passes. Mount AFTER authMiddleware (which sets req.auth). Returns 403 on fail.
function requireRole(...roles) {
  const allowed = new Set(roles);
  return function roleGuard(req, res, next) {
    const role = req.auth && req.auth.role;
    if (role === "superadmin" || allowed.has(role)) return next();
    return res.status(403).json({ success: false, message: `Forbidden: requires role ${roles.join(" or ")}.` });
  };
}

module.exports = createAuthMiddleware;
module.exports.getSuperadminKey = getSuperadminKey;
module.exports.getSharedApiKey = getSharedApiKey;
module.exports.checkApiKey = checkApiKey;
module.exports.resolveIdentity = resolveIdentity;
module.exports.requireRole = requireRole;
module.exports.roleForDeviceScope = roleForDeviceScope;
