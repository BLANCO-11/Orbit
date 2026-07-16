// agent-backend/routes/auth-sso.js
// Enterprise SSO via OpenID Connect (Authorization Code + PKCE, confidential
// client). Mirrors the hand-rolled OAuth flow in routes/connections.js — no
// heavyweight passport/openid-client dependency; just `fetch` + `jose` for
// id_token verification.
//
//   GET  /api/auth/sso/login     — (public) redirect to the IdP  (state+PKCE+nonce)
//   GET  /api/auth/sso/callback  — (public) exchange code, verify id_token, mint session
//   POST /api/auth/logout        — (public) revoke the presented SSO session token
//   GET  /api/auth/whoami        — (authed) the caller's identity + SSO status
//
// The OIDC secrets live ONLY in env. The superadmin toggles SSO on/off from the
// Admin console (persisted in security-config.json under auth.sso.enabled); this
// router reads that toggle so a disabled SSO refuses the login route.

const { Router } = require("express");
const crypto = require("crypto");
const { loadConfig } = require("../config");
const { getSuperadminKey } = require("../middleware/auth");
const { oidcEnv, oidcConfigured } = require("./admin");

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// In-flight handshakes: state → { codeVerifier, nonce, createdAt }.
const pending = new Map();
function gcPending() {
  const now = Date.now();
  for (const [k, v] of pending) if (now - v.createdAt > 10 * 60_000) pending.delete(k);
}

// Cached OIDC discovery documents (issuer → { doc, fetchedAt }).
const discoveryCache = new Map();
async function getDiscovery(issuer) {
  const cached = discoveryCache.get(issuer);
  if (cached && Date.now() - cached.fetchedAt < 60 * 60_000) return cached.doc;
  const base = issuer.replace(/\/$/, "");
  const url = `${base}/.well-known/openid-configuration`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`discovery failed (${resp.status}) at ${url}`);
  const doc = await resp.json();
  discoveryCache.set(issuer, { doc, fetchedAt: Date.now() });
  return doc;
}

// Remote JWKS per jwks_uri (jose caches keys internally too).
const jwksCache = new Map();
function getJwks(jwksUri) {
  if (!jwksCache.has(jwksUri)) {
    const { createRemoteJWKSet } = require("jose");
    jwksCache.set(jwksUri, createRemoteJWKSet(new URL(jwksUri)));
  }
  return jwksCache.get(jwksUri);
}

function ssoEnabled() {
  const cfg = loadConfig();
  return !!(cfg.auth && cfg.auth.sso && cfg.auth.sso.enabled);
}

// Map an authenticated email → RBAC role. Admin if listed in OIDC_ADMIN_EMAILS,
// or if this is the very first user (bootstrap). Otherwise leave undefined so
// upsertUser preserves an existing role / defaults new users to 'member'.
function roleForEmail(db, email) {
  const admins = (oidcEnv().adminEmails || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (admins.includes(String(email).toLowerCase())) return "admin";
  try { if (db.countUsers() === 0) return "admin"; } catch {}
  return undefined;
}

function domainAllowed(email) {
  const allowed = (oidcEnv().allowedDomains || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!allowed.length) return true;
  const domain = String(email).toLowerCase().split("@")[1] || "";
  return allowed.includes(domain);
}

// `authMiddleware` is injected so /whoami can live in the same /api/auth router
// while the SSO sub-paths stay public (browser-navigated, can't carry a header).
function createAuthSsoRouter({ db, getOrigin, authMiddleware }) {
  const router = Router();

  const redirectUri = () => oidcEnv().redirectUri || `${getOrigin()}/api/auth/sso/callback`;
  const dash = () => getOrigin();

  // ── GET /sso/status (public) ────────────────────────────────────
  // Lets the login screen decide whether to offer the SSO button BEFORE the
  // caller has any credential (so it can't use the authed /whoami).
  router.get("/sso/status", (req, res) => {
    res.json({ success: true, enabled: ssoEnabled(), configured: oidcConfigured(), provider: "oidc" });
  });

  // ── POST /local (public) ────────────────────────────────────────
  // Local superadmin sign-in: prove knowledge of ORBIT_SUPERADMIN_KEY. On
  // success the client stores that same value as its request credential (it
  // resolves to the superadmin identity in middleware/auth.js). Disabled in
  // dev-mode, where no key is set and the app is already unauthenticated-open.
  router.post("/local", (req, res) => {
    const key = getSuperadminKey();
    if (!key) {
      return res.status(400).json({ success: false, message: "Local login is disabled — no ORBIT_SUPERADMIN_KEY is set (dev-mode)." });
    }
    const password = (req.body && req.body.password) || "";
    // Length-independent compare to blunt trivial timing oracles.
    const a = Buffer.from(String(password));
    const b = Buffer.from(String(key));
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!ok) return res.status(401).json({ success: false, message: "Invalid superadmin key." });
    res.json({ success: true });
  });

  // ── GET /sso/login ──────────────────────────────────────────────
  router.get("/sso/login", async (req, res) => {
    if (!ssoEnabled()) return res.status(400).send("SSO is disabled. An administrator must enable it in the Admin console.");
    if (!oidcConfigured()) return res.status(400).send("SSO is not configured. Set OIDC_ISSUER_URL, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET.");
    try {
      const e = oidcEnv();
      const disco = await getDiscovery(e.issuer);
      gcPending();
      const state = b64url(crypto.randomBytes(16));
      const nonce = b64url(crypto.randomBytes(16));
      const verifier = b64url(crypto.randomBytes(32));
      pending.set(state, { codeVerifier: verifier, nonce, createdAt: Date.now() });
      const params = new URLSearchParams({
        client_id: e.clientId,
        redirect_uri: redirectUri(),
        response_type: "code",
        scope: e.scopes || "openid email profile",
        state,
        nonce,
        code_challenge: b64url(crypto.createHash("sha256").update(verifier).digest()),
        code_challenge_method: "S256",
      });
      res.redirect(`${disco.authorization_endpoint}?${params.toString()}`);
    } catch (err) {
      console.error("[SSO] login failed:", err.message);
      res.redirect(`${dash()}/?sso_error=${encodeURIComponent(err.message)}`);
    }
  });

  // ── GET /sso/callback ───────────────────────────────────────────
  router.get("/sso/callback", async (req, res) => {
    const { code, state, error, error_description } = req.query;
    if (error) return res.redirect(`${dash()}/?sso_error=${encodeURIComponent(error_description || error)}`);
    const entry = state && pending.get(state);
    if (!entry) return res.redirect(`${dash()}/?sso_error=invalid_state`);
    pending.delete(state);

    try {
      const e = oidcEnv();
      const disco = await getDiscovery(e.issuer);

      // 1. Exchange the code for tokens (confidential client + PKCE verifier).
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code: String(code),
        redirect_uri: redirectUri(),
        client_id: e.clientId,
        client_secret: e.clientSecret,
        code_verifier: entry.codeVerifier,
      });
      const resp = await fetch(disco.token_endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body,
      });
      const data = await resp.json().catch(() => ({}));
      if (!data.id_token) throw new Error(data.error_description || data.error || "no id_token in token response");

      // 2. Verify the id_token against the IdP's JWKS (issuer + audience + nonce).
      const { jwtVerify } = require("jose");
      const { payload } = await jwtVerify(data.id_token, getJwks(disco.jwks_uri), {
        issuer: disco.issuer,
        audience: e.clientId,
      });
      if (entry.nonce && payload.nonce && payload.nonce !== entry.nonce) {
        throw new Error("nonce mismatch");
      }

      const email = String(payload.email || payload.preferred_username || "").toLowerCase();
      if (!email) throw new Error("no email/preferred_username claim in id_token");
      if (!domainAllowed(email)) throw new Error(`domain not allowed for ${email}`);

      // 3. Provision/refresh the user and mint an Orbit session token.
      const user = db.upsertUser({ email, sub: payload.sub, role: roleForEmail(db, email) });
      const { token } = db.createSsoSession(user.id);

      // 4. Hand the session token to the SPA via a query param — page.tsx stores
      //    it in the shared credential slot and strips the param. No new route.
      res.redirect(`${dash()}/?ssoToken=${encodeURIComponent(token)}`);
    } catch (err) {
      console.error("[SSO] callback failed:", err.message);
      res.redirect(`${dash()}/?sso_error=${encodeURIComponent(err.message)}`);
    }
  });

  // ── POST /logout ────────────────────────────────────────────────
  router.post("/logout", (req, res) => {
    const token =
      req.headers["x-api-key"] ||
      (req.headers["authorization"] || "").replace("Bearer ", "") ||
      (req.body && req.body.token) || "";
    try { db.revokeSsoSession(token); } catch {}
    res.json({ success: true });
  });

  // ── GET /whoami (authed) ────────────────────────────────────────
  router.get("/whoami", authMiddleware, (req, res) => {
    const a = req.auth || {};
    let tenantName = null;
    if (a.tenantId) { try { tenantName = db.getTenant(a.tenantId)?.name || null; } catch {} }
    res.json({
      success: true,
      role: a.role || "member",
      tenantId: a.tenantId || null,
      tenantName,
      email: a.email || null,
      devMode: !!a.devMode,
      isSuperadmin: a.role === "superadmin",
      isAdmin: a.role === "superadmin" || a.role === "admin",
      ssoEnabled: ssoEnabled(),
      ssoConfigured: oidcConfigured(),
    });
  });

  return router;
}

module.exports = createAuthSsoRouter;
module.exports.ssoEnabled = ssoEnabled;
