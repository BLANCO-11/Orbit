// agent-backend/routes/admin.js
// Admin console API — tenants, API keys, members/roles, observability, SSO
// toggle. Mounted behind authMiddleware; each handler additionally gates on
// role via requireRole. RBAC degrades gracefully: superadmin sees everything
// across all tenants; a tenant-admin is scoped to its own tenant.
//
//   Tenants        GET/POST/PATCH/DELETE /api/admin/tenants       (superadmin)
//   API keys       GET/POST/DELETE       /api/admin/keys          (admin+)
//   Members        GET/PATCH             /api/admin/users         (admin+)
//   Observability  GET                   /api/admin/observability (admin+)
//   SSO settings   GET/PUT               /api/admin/sso           (superadmin)

const { Router } = require("express");
const { requireRole } = require("../middleware/auth");
const { loadConfig, saveConfig } = require("../config");

// A role an API key may carry. Superadmin is env-only and can never be minted
// as a key, so it's excluded here.
const ASSIGNABLE_ROLES = new Set(["admin", "member", "viewer"]);

// OIDC env presence — the actual secrets live in env, never in the DB/config.
function oidcEnv() {
  return {
    issuer: process.env.OIDC_ISSUER_URL || "",
    clientId: process.env.OIDC_CLIENT_ID || "",
    clientSecret: process.env.OIDC_CLIENT_SECRET || "",
    redirectUri: process.env.OIDC_REDIRECT_URI || "",
    scopes: process.env.OIDC_SCOPES || "openid email profile",
    adminEmails: process.env.OIDC_ADMIN_EMAILS || "",
    allowedDomains: process.env.OIDC_ALLOWED_DOMAINS || "",
  };
}
function oidcConfigured() {
  const e = oidcEnv();
  return !!(e.issuer && e.clientId && e.clientSecret);
}

function createAdminRouter(db, { getOrigin } = {}) {
  const router = Router();

  // The tenant a caller is allowed to act within: superadmin → whatever it asks
  // for (or all when unset); anyone else → pinned to their own tenant.
  const scopeTenant = (req, requested) => {
    if (req.auth.role === "superadmin") return requested !== undefined ? requested : null;
    return req.auth.tenantId || null;
  };

  // ── Tenants (superadmin only) ──────────────────────────────────────
  router.get("/tenants", requireRole("superadmin"), (req, res) => {
    res.json({ success: true, tenants: db.listTenants() });
  });

  router.post("/tenants", requireRole("superadmin"), (req, res) => {
    const name = (req.body && req.body.name || "").trim();
    if (!name) return res.status(400).json({ success: false, message: "Tenant name is required." });
    res.json({ success: true, tenant: db.createTenant(name) });
  });

  router.patch("/tenants/:id", requireRole("superadmin"), (req, res) => {
    const t = db.getTenant(req.params.id);
    if (!t) return res.status(404).json({ success: false, message: "Tenant not found." });
    const { name, status, ssoEnabled } = req.body || {};
    const updated = db.updateTenant(req.params.id, { name, status, ssoEnabled });
    res.json({ success: true, tenant: updated });
  });

  router.delete("/tenants/:id", requireRole("superadmin"), (req, res) => {
    db.deleteTenant(req.params.id);
    res.json({ success: true });
  });

  // ── API keys (admin+) ──────────────────────────────────────────────
  router.get("/keys", requireRole("admin"), (req, res) => {
    const tenantId = scopeTenant(req, req.query.tenantId);
    res.json({ success: true, keys: db.listApiKeys(tenantId || undefined) });
  });

  router.post("/keys", requireRole("admin"), (req, res) => {
    const { label, role, scope } = req.body || {};
    const requestedRole = (role || "member").toLowerCase();
    if (!ASSIGNABLE_ROLES.has(requestedRole)) {
      return res.status(400).json({ success: false, message: `role must be one of: ${[...ASSIGNABLE_ROLES].join(", ")}.` });
    }
    // A tenant-admin can only mint keys inside its own tenant and no higher than
    // its own role; superadmin may target any tenant.
    const tenantId = scopeTenant(req, req.body && req.body.tenantId);
    if (req.auth.role !== "superadmin" && requestedRole === "admin" && req.auth.role !== "admin") {
      return res.status(403).json({ success: false, message: "Insufficient role to mint an admin key." });
    }
    const created = db.createApiKey({
      tenantId: tenantId || null,
      label,
      role: requestedRole,
      scope,
      createdBy: req.auth.keyId || req.auth.userId || (req.auth.role === "superadmin" ? "superadmin" : null),
    });
    // `key` (raw secret) is returned here and NOWHERE else — the client must
    // capture it now; only the hash is stored.
    res.json({ success: true, key: created });
  });

  router.delete("/keys/:id", requireRole("admin"), (req, res) => {
    const key = db.getApiKey(req.params.id);
    if (!key) return res.status(404).json({ success: false, message: "Key not found." });
    if (req.auth.role !== "superadmin" && key.tenantId !== req.auth.tenantId) {
      return res.status(403).json({ success: false, message: "Cannot revoke a key outside your tenant." });
    }
    db.revokeApiKey(req.params.id);
    res.json({ success: true });
  });

  // ── Members & roles (admin+) ───────────────────────────────────────
  router.get("/users", requireRole("admin"), (req, res) => {
    const tenantId = scopeTenant(req, req.query.tenantId);
    res.json({ success: true, users: db.listUsers(tenantId || undefined) });
  });

  router.patch("/users/:id", requireRole("admin"), (req, res) => {
    const role = (req.body && req.body.role || "").toLowerCase();
    if (!ASSIGNABLE_ROLES.has(role)) {
      return res.status(400).json({ success: false, message: `role must be one of: ${[...ASSIGNABLE_ROLES].join(", ")}.` });
    }
    const user = db.getUser(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found." });
    if (req.auth.role !== "superadmin" && user.tenantId !== req.auth.tenantId) {
      return res.status(403).json({ success: false, message: "Cannot modify a user outside your tenant." });
    }
    db.setUserRole(req.params.id, role);
    res.json({ success: true, user: db.getUser(req.params.id) });
  });

  // ── Observability (admin+) ─────────────────────────────────────────
  // Aggregate usage from persisted session metrics, bucketed by tenant. Foundation
  // pass: sessions are tagged with tenant_id but not isolated, so untagged
  // sessions land in the "untagged" bucket. Superadmin sees all; admin its own.
  router.get("/observability", requireRole("admin"), (req, res) => {
    const scope = req.auth.role === "superadmin" ? null : (req.auth.tenantId || null);
    let sessions = [];
    try { sessions = db.getAllSessions(); } catch { sessions = []; }

    const buckets = new Map(); // tenantId|"untagged" → aggregate
    const bucketFor = (tid) => {
      const key = tid || "untagged";
      if (!buckets.has(key)) buckets.set(key, { tenantId: tid || null, sessions: 0, toolCalls: 0, tokens: 0, cost: 0 });
      return buckets.get(key);
    };

    let totals = { sessions: 0, toolCalls: 0, tokens: 0, cost: 0 };
    for (const s of sessions) {
      if (scope && s.tenantId !== scope) continue;
      const m = s.metrics || {};
      const toolCalls = (m.toolCalls && m.toolCalls.total) || 0;
      const tokens = (m.tokens && (m.tokens.estimated === false && m.tokens.reported ? m.tokens.reported.total : m.tokens.total)) || 0;
      const cost = m.cost || 0;
      const b = bucketFor(s.tenantId);
      b.sessions++; b.toolCalls += toolCalls; b.tokens += tokens; b.cost += cost;
      totals.sessions++; totals.toolCalls += toolCalls; totals.tokens += tokens; totals.cost += cost;
    }

    // Key & tenant inventory (scoped) rounds out the picture.
    const tenants = req.auth.role === "superadmin" ? db.listTenants() : [];
    const keys = db.listApiKeys(scope || undefined);
    const devices = (db.listDevices && db.listDevices()) || [];

    res.json({
      success: true,
      scope: scope || "all",
      totals,
      byTenant: [...buckets.values()].sort((a, b) => b.tokens - a.tokens),
      counts: {
        tenants: tenants.length,
        apiKeys: keys.filter((k) => !k.revoked).length,
        apiKeysRevoked: keys.filter((k) => k.revoked).length,
        devices: devices.length,
      },
    });
  });

  // ── SSO settings (superadmin only) ─────────────────────────────────
  // The OIDC secrets stay in env; only the on/off toggle persists (in
  // security-config.json under config.auth.sso.enabled).
  router.get("/sso", requireRole("superadmin"), (req, res) => {
    const cfg = loadConfig();
    const enabled = !!(cfg.auth && cfg.auth.sso && cfg.auth.sso.enabled);
    const e = oidcEnv();
    const origin = (getOrigin && getOrigin()) || "";
    res.json({
      success: true,
      sso: {
        enabled,
        configured: oidcConfigured(),
        provider: "oidc",
        issuer: e.issuer || null,
        // What the operator must register with their IdP as the redirect URI.
        redirectUri: e.redirectUri || (origin ? `${origin}/api/auth/sso/callback` : "/api/auth/sso/callback"),
        env: {
          OIDC_ISSUER_URL: !!e.issuer,
          OIDC_CLIENT_ID: !!e.clientId,
          OIDC_CLIENT_SECRET: !!e.clientSecret,
          OIDC_REDIRECT_URI: !!e.redirectUri,
          OIDC_SCOPES: e.scopes,
          OIDC_ADMIN_EMAILS: !!e.adminEmails,
          OIDC_ALLOWED_DOMAINS: !!e.allowedDomains,
        },
      },
    });
  });

  router.put("/sso", requireRole("superadmin"), (req, res) => {
    const enabled = !!(req.body && req.body.enabled);
    if (enabled && !oidcConfigured()) {
      return res.status(400).json({
        success: false,
        message: "Cannot enable SSO — set OIDC_ISSUER_URL, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET in the environment first.",
      });
    }
    const cfg = loadConfig();
    cfg.auth = cfg.auth || {};
    cfg.auth.sso = { ...(cfg.auth.sso || {}), enabled, provider: "oidc" };
    saveConfig(cfg);
    res.json({ success: true, sso: { enabled } });
  });

  return router;
}

module.exports = createAdminRouter;
module.exports.oidcEnv = oidcEnv;
module.exports.oidcConfigured = oidcConfigured;
