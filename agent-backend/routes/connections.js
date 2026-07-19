// agent-backend/routes/connections.js
// Service connections: the "Connect <service>" flow. Two routers:
//   - connectionsRouter (authed): list, set-token, disconnect.
//   - oauthRouter (public, browser-navigated): /oauth/:provider/start + callback.
//
// OAuth is Authorization-Code + PKCE. On success the token is encrypted, stored,
// and — if the provider has an MCP mapping — injected into that MCP connector so
// the agent can act on the service. Local-first: the redirect URI is the
// dashboard origin, which most providers allow as http://localhost, so no
// tunnel is needed for the login flow.

const { Router } = require("express");
const crypto = require("crypto");
const { getProvider, isConfigured, listProviders } = require("../providers");

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// Pending OAuth handshakes: state → { provider, codeVerifier, createdAt }.
const pending = new Map();
function gcPending() {
  const now = Date.now();
  for (const [k, v] of pending) if (now - v.createdAt > 10 * 60_000) pending.delete(k);
}

function createConnectionsRouters({ db, mcpRegistry, encrypt, decrypt, getOrigin }) {
  const redirectUri = () => `${getOrigin()}/api/oauth/callback`;

  // Inject a connected service's token into its MCP connector so the agent can
  // use it. No-op for providers without an MCP mapping.
  async function wireMcp(p, accessToken) {
    if (!p.mcp || !accessToken) return;
    try {
      await mcpRegistry.add(p.mcp.name, {
        command: p.mcp.command, args: p.mcp.args,
        env: { [p.mcp.tokenEnv]: accessToken },
      });
    } catch (e) {
      console.error(`[Connections] MCP wire failed for ${p.id}:`, e.message);
    }
  }

  // ── Authed API ────────────────────────────────────────────────────
  const connectionsRouter = Router();

  connectionsRouter.get("/", async (_req, res) => {
    const connected = new Set((await db.listConnections()).map((c) => c.provider));
    const providers = listProviders().map((p) => ({ ...p, connected: connected.has(p.id) }));
    res.json({ success: true, providers });
  });

  // Set a token for a token-kind provider (e.g. Telegram bot token).
  connectionsRouter.post("/:provider/token", async (req, res) => {
    const p = getProvider(req.params.provider);
    if (!p || p.kind !== "token") return res.status(400).json({ success: false, error: "not a token provider" });
    const token = (req.body && req.body.token || "").trim();
    if (!token) return res.status(400).json({ success: false, error: "token required" });
    await db.saveConnection({ provider: p.id, kind: "token", scopes: [], accessTokenEnc: encrypt(token), meta: {} });
    await wireMcp(p, token);
    res.json({ success: true });
  });

  connectionsRouter.delete("/:provider", async (req, res) => {
    const p = getProvider(req.params.provider);
    await db.deleteConnection(req.params.provider);
    if (p?.mcp) { try { await mcpRegistry.remove(p.mcp.name); } catch {} }
    res.json({ success: true });
  });

  // ── Public OAuth (browser-navigated) ──────────────────────────────
  const oauthRouter = Router();

  oauthRouter.get("/:provider/start", (req, res) => {
    const p = getProvider(req.params.provider);
    if (!p || p.kind !== "oauth") return res.status(404).send("Unknown OAuth provider.");
    if (!isConfigured(p)) {
      return res.status(400).send(`${p.name} isn't configured. Set ${p.clientIdEnv} and ${p.clientSecretEnv} (register an app at ${p.setupUrl}).`);
    }
    gcPending();
    const state = b64url(crypto.randomBytes(16));
    const entry = { provider: p.id, createdAt: Date.now() };
    const params = new URLSearchParams({
      client_id: process.env[p.clientIdEnv],
      redirect_uri: redirectUri(),
      response_type: "code",
      scope: (p.scopes || []).join(" "),
      state,
    });
    if (p.pkce) {
      const verifier = b64url(crypto.randomBytes(32));
      entry.codeVerifier = verifier;
      params.set("code_challenge", b64url(crypto.createHash("sha256").update(verifier).digest()));
      params.set("code_challenge_method", "S256");
    }
    for (const [k, v] of Object.entries(p.extraAuthParams || {})) params.set(k, v);
    pending.set(state, entry);
    res.redirect(`${p.authorizeUrl}?${params.toString()}`);
  });

  oauthRouter.get("/callback", async (req, res) => {
    const { code, state, error } = req.query;
    const dash = getOrigin();
    if (error) return res.redirect(`${dash}/?connect_error=${encodeURIComponent(error)}`);
    const entry = state && pending.get(state);
    if (!entry) return res.redirect(`${dash}/?connect_error=invalid_state`);
    pending.delete(state);
    const p = getProvider(entry.provider);
    if (!p) return res.redirect(`${dash}/?connect_error=unknown_provider`);

    try {
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code: String(code),
        redirect_uri: redirectUri(),
        client_id: process.env[p.clientIdEnv],
        client_secret: process.env[p.clientSecretEnv],
      });
      if (entry.codeVerifier) body.set("code_verifier", entry.codeVerifier);
      const headers = { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" };
      if (p.tokenAuth === "basic") {
        headers["Authorization"] = "Basic " + Buffer.from(`${process.env[p.clientIdEnv]}:${process.env[p.clientSecretEnv]}`).toString("base64");
        body.delete("client_id"); body.delete("client_secret");
      }
      const resp = await fetch(p.tokenUrl, { method: "POST", headers, body });
      const data = await resp.json().catch(() => ({}));
      const accessToken = data.access_token || data.accessToken;
      if (!accessToken) throw new Error(data.error_description || data.error || "no access_token in response");

      await db.saveConnection({
        provider: p.id, kind: "oauth",
        scopes: (data.scope ? String(data.scope).split(/[ ,]/).filter(Boolean) : p.scopes) || [],
        accessTokenEnc: encrypt(accessToken),
        refreshTokenEnc: encrypt(data.refresh_token || ""),
        expiresAt: data.expires_in ? Date.now() + Number(data.expires_in) * 1000 : null,
        meta: {},
      });
      await wireMcp(p, accessToken);
      res.redirect(`${dash}/?connected=${p.id}`);
    } catch (e) {
      console.error(`[OAuth] ${p.id} token exchange failed:`, e.message);
      res.redirect(`${dash}/?connect_error=${encodeURIComponent(e.message)}`);
    }
  });

  return { connectionsRouter, oauthRouter };
}

module.exports = createConnectionsRouters;
