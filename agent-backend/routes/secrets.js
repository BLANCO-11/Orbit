// agent-backend/routes/secrets.js
// Tenant-scoped secret store: datasource/tool credentials the agent's generated
// scripts read from the sandbox ENV, never from the prompt or transcript.
// Values are encrypted at rest (crypto-store, same as connection tokens) and are
// NEVER returned over the API — GET reports names + presence only.
//
//   GET    /api/secrets        — list this tenant's secret names (+ hasValue)
//   POST   /api/secrets        — set { name, value }  (upsert)
//   DELETE /api/secrets/:name  — remove a secret
//
// A secret NAME must be a valid env-var identifier (it becomes one at spawn).
// Secrets belong to the tenant of the presented credential; superadmin/dev
// (tenantId null) operate in the shared local bucket. Writes require member+.

const { Router } = require("express");
const { requireRole } = require("../middleware/auth");

// Env-var identifier: letter/underscore, then letters/digits/underscores.
const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_VALUE_BYTES = 64 * 1024; // 64 KiB — generous for tokens/keys/PEM blobs

function createSecretsRouter({ db, encrypt }) {
  const router = Router();

  const tenantOf = (req) => (req.auth && req.auth.tenantId) || null;

  router.get("/", async (req, res) => {
    res.json({ success: true, secrets: await db.listSecrets(tenantOf(req)) });
  });

  router.post("/", requireRole("admin", "member"), async (req, res) => {
    const name = String((req.body && req.body.name) || "").trim();
    const value = req.body && req.body.value;
    if (!VALID_NAME.test(name)) {
      return res.status(400).json({ success: false, error: "name must be a valid env-var identifier ([A-Za-z_][A-Za-z0-9_]*)" });
    }
    if (typeof value !== "string" || value.length === 0) {
      return res.status(400).json({ success: false, error: "value must be a non-empty string" });
    }
    if (Buffer.byteLength(value, "utf8") > MAX_VALUE_BYTES) {
      return res.status(413).json({ success: false, error: `value exceeds ${MAX_VALUE_BYTES} bytes` });
    }
    await db.setSecret({ tenantId: tenantOf(req), name, valueEnc: encrypt(value) });
    // Never echo the value back.
    res.json({ success: true, secret: { name, hasValue: true } });
  });

  router.delete("/:name", requireRole("admin", "member"), async (req, res) => {
    const removed = await db.deleteSecret(tenantOf(req), req.params.name);
    if (!removed) return res.status(404).json({ success: false, error: "no such secret" });
    res.json({ success: true });
  });

  return router;
}

module.exports = createSecretsRouter;
