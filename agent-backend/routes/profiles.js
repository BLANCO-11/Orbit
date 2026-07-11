// agent-backend/routes/profiles.js
// Session profiles — named, reusable bundles of the settings a session runs
// with: harness type, permission mode, effort, prompt, skills, tool policy,
// sandbox. A profile is the reusable default; the composer chips override it
// per session. Event channels (Phase 3) run a profile headlessly.
//
// GET    /api/profiles       — list
// POST   /api/profiles       — create/update (upsert)
// DELETE /api/profiles/:id   — delete

const { Router } = require("express");

const VALID_MODES = new Set(["chat", "plan", "edit", "yolo"]);
const VALID_EFFORT = new Set(["fast", "balanced", "deep"]);
const VALID_SANDBOX = new Set(["host", "container", "remote"]);

// Seeded on first run so the feature isn't an empty screen.
const DEFAULT_PROFILES = [
  {
    name: "Quick chat", description: "Fast answers, no tools",
    harnessType: "picode", mode: "chat", effort: "fast", promptId: "standard",
    skills: [], toolPolicy: { excluded: [] }, sandbox: "host",
  },
  {
    name: "Safe edit", description: "Reads free, writes gated, code-review on",
    harnessType: "picode", mode: "edit", effort: "balanced", promptId: "standard",
    skills: ["code-review"], toolPolicy: { excluded: [] }, sandbox: "host",
  },
  {
    name: "Deep research", description: "Reasoning model, Lightpanda only",
    harnessType: "picode", mode: "plan", effort: "deep", promptId: "standard",
    skills: [], toolPolicy: { excluded: ["web_search", "fetch_content", "get_search_content", "browser", "web"] }, sandbox: "host",
  },
];

function sanitize(body) {
  const p = {};
  if (body.id) p.id = String(body.id);
  p.name = String(body.name || "Untitled profile").slice(0, 80);
  if (body.description !== undefined) p.description = String(body.description).slice(0, 200);
  p.harnessType = String(body.harnessType || "picode");
  p.mode = VALID_MODES.has(body.mode) ? body.mode : "chat";
  p.effort = VALID_EFFORT.has(body.effort) ? body.effort : "balanced";
  p.promptId = String(body.promptId || "standard");
  p.skills = Array.isArray(body.skills) ? body.skills.filter((s) => typeof s === "string").slice(0, 50) : [];
  const excluded = body.toolPolicy && Array.isArray(body.toolPolicy.excluded)
    ? body.toolPolicy.excluded.filter((s) => typeof s === "string").slice(0, 200) : [];
  p.toolPolicy = { excluded };
  p.sandbox = VALID_SANDBOX.has(body.sandbox) ? body.sandbox : "host";
  return p;
}

function createProfilesRouter(db) {
  const router = Router();

  // Seed defaults once, lazily.
  try {
    if (db.countProfiles() === 0) {
      for (const p of DEFAULT_PROFILES) db.saveProfile(p);
    }
  } catch (e) {
    console.error("[Profiles] seed failed:", e.message);
  }

  router.get("/", (_req, res) => {
    res.json({ success: true, profiles: db.listProfiles() });
  });

  router.post("/", (req, res) => {
    try {
      const saved = db.saveProfile(sanitize(req.body || {}));
      res.json({ success: true, profile: saved, profiles: db.listProfiles() });
    } catch (e) {
      res.status(400).json({ success: false, error: e.message });
    }
  });

  router.delete("/:id", (req, res) => {
    db.deleteProfile(req.params.id);
    res.json({ success: true, profiles: db.listProfiles() });
  });

  return router;
}

module.exports = createProfilesRouter;
