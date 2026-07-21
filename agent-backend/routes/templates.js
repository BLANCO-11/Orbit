// agent-backend/routes/templates.js
// Tenant-scoped runtime TEMPLATES — the output-constraint layer (allowed
// languages/packages, structure rules, conventions, optional workspace
// scaffold). Distinct from profiles (which set HOW a run executes). A run or
// profile references a template by `templateId`; it is compiled into the system
// prompt at spawn and checked after generation (non-blocking).
//
//   GET    /api/templates          — list this tenant's templates
//   GET    /api/templates/:id      — full def
//   POST   /api/templates          — create/update { id?, name, def }        (member+)
//   DELETE /api/templates/:id      — delete                                  (member+)
//   POST   /api/templates/:id/sync — refresh def from the template's source_url (member+)
//
// Templates belong to the tenant of the presented credential; superadmin/dev
// (tenantId null) operate in the shared local bucket.

const { Router } = require("express");
const { requireRole } = require("../middleware/auth");
const { validateTemplateDef } = require("../templates");

const VALID_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const slugify = (s) =>
  String(s || "").toLowerCase().trim().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "template";

function createTemplatesRouter({ db }) {
  const router = Router();
  const tenantOf = (req) => (req.auth && req.auth.tenantId) || null;

  router.get("/", async (req, res) => {
    res.json({ success: true, templates: await db.listTemplatesForTenant(tenantOf(req)) });
  });

  router.get("/:id", async (req, res) => {
    const t = await db.getTemplate(tenantOf(req), req.params.id);
    if (!t) return res.status(404).json({ success: false, error: "no such template" });
    res.json({ success: true, template: t });
  });

  router.post("/", requireRole("admin", "member"), async (req, res) => {
    try {
      const body = req.body || {};
      const id = body.id ? slugify(body.id) : slugify(body.name);
      if (!VALID_ID.test(id)) return res.status(400).json({ success: false, error: "invalid template id" });
      const def = validateTemplateDef(body.def || {});
      const name = String(body.name || def.name || id).slice(0, 120);
      const sourceUrl = body.sourceUrl ? String(body.sourceUrl).slice(0, 2048) : "";
      const saved = await db.upsertTemplate({ tenantId: tenantOf(req), id, name, def, sourceUrl });
      res.json({ success: true, template: saved, templates: await db.listTemplatesForTenant(tenantOf(req)) });
    } catch (e) {
      res.status(400).json({ success: false, error: e.message });
    }
  });

  router.delete("/:id", requireRole("admin", "member"), async (req, res) => {
    const removed = await db.deleteTemplate(tenantOf(req), req.params.id);
    if (!removed) return res.status(404).json({ success: false, error: "no such template" });
    res.json({ success: true, templates: await db.listTemplatesForTenant(tenantOf(req)) });
  });

  // Refresh a template's def from its registered source_url (a tenant repo/URL
  // returning the def JSON). Fetch failure is NON-FATAL: the last-known DB copy
  // is kept and the error reported.
  router.post("/:id/sync", requireRole("admin", "member"), async (req, res) => {
    const t = await db.getTemplate(tenantOf(req), req.params.id);
    if (!t) return res.status(404).json({ success: false, error: "no such template" });
    const url = (req.body && req.body.sourceUrl) || t.sourceUrl;
    if (!url) return res.status(400).json({ success: false, error: "template has no source_url" });
    try {
      const resp = await fetch(url, { headers: { Accept: "application/json, text/plain" }, redirect: "follow" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const etag = resp.headers.get("etag") || "";
      const text = await resp.text();
      let parsed;
      try { parsed = JSON.parse(text); } catch { throw new Error("source did not return valid JSON"); }
      // Accept either a bare def or an envelope { name?, def }.
      const rawDef = parsed && parsed.def && typeof parsed.def === "object" ? parsed.def : parsed;
      const def = validateTemplateDef(rawDef);
      const name = String((parsed && parsed.name) || t.name).slice(0, 120);
      const saved = await db.upsertTemplate({
        tenantId: tenantOf(req), id: t.id, name, def,
        sourceUrl: String(url).slice(0, 2048), sourceEtag: etag, fetchedAt: Date.now(),
      });
      res.json({ success: true, template: saved });
    } catch (e) {
      // Non-fatal: report the failure, leave the stored def intact.
      res.status(502).json({ success: false, error: `sync failed: ${e.message}`, template: t });
    }
  });

  return router;
}

module.exports = createTemplatesRouter;
