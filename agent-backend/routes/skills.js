// agent-backend/routes/skills.js
// Skills — reusable instruction packs (skills/<name>/SKILL.md). Attached per
// session from the composer; the harness appends the attached skills' bodies
// to the system prompt, so the main agent and every sub-agent inherit them.

const { Router } = require("express");
const fs = require("fs");
const path = require("path");

const SKILLS_DIR = path.join(__dirname, "../../skills");
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Parse the frontmatter description + body out of a SKILL.md. */
function parseSkill(id) {
  const file = path.join(SKILLS_DIR, id, "SKILL.md");
  let raw = "";
  try { raw = fs.readFileSync(file, "utf-8"); } catch { return null; }

  let description = "";
  let body = raw;
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (fm) {
    const d = fm[1].match(/^description:\s*(.+)$/m);
    if (d) description = d[1].trim();
    body = fm[2];
  }
  return { id, description, body: body.trim() };
}

function listSkills() {
  let entries = [];
  try {
    entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory() && ID_RE.test(e.name));
  } catch { return []; }
  return entries
    .map(e => parseSkill(e.name))
    .filter(Boolean)
    .map(s => ({ id: s.id, description: s.description }));
}

/**
 * Combine the bodies of the given skill ids into one prompt fragment, ready to
 * append to the system prompt. Unknown/invalid ids are skipped.
 */
function resolveSkills(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return "";
  const parts = [];
  for (const id of ids) {
    if (!ID_RE.test(id)) continue;
    const skill = parseSkill(id);
    if (skill && skill.body) parts.push(skill.body);
  }
  if (parts.length === 0) return "";
  return "\n\n# Attached skills\n\n" + parts.join("\n\n---\n\n");
}

function createSkillsRouter() {
  const router = Router();

  router.get("/", (_req, res) => {
    try {
      res.json({ success: true, skills: listSkills() });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // Full content of one skill (description + body) for the editor.
  router.get("/:id", (req, res) => {
    const id = req.params.id;
    if (!ID_RE.test(id)) return res.status(400).json({ success: false, error: "invalid id" });
    const skill = parseSkill(id);
    if (!skill) return res.status(404).json({ success: false, error: "not found" });
    res.json({ success: true, ...skill });
  });

  // Create or update a skill: writes skills/<id>/SKILL.md with frontmatter.
  router.post("/", (req, res) => {
    const { id, description, body } = req.body || {};
    if (!id || !ID_RE.test(id)) {
      return res.status(400).json({ success: false, error: "id must match [a-z0-9-], max 64 chars" });
    }
    if (!body || typeof body !== "string" || !body.trim()) {
      return res.status(400).json({ success: false, error: "body is required" });
    }
    try {
      const dir = path.join(SKILLS_DIR, id);
      fs.mkdirSync(dir, { recursive: true });
      const desc = String(description || "").replace(/\r?\n/g, " ").trim();
      const md = `---\nname: ${id}\ndescription: ${desc}\n---\n\n${body.trim()}\n`;
      fs.writeFileSync(path.join(dir, "SKILL.md"), md, "utf-8");
      res.json({ success: true, skills: listSkills() });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  router.delete("/:id", (req, res) => {
    const id = req.params.id;
    if (!ID_RE.test(id)) return res.status(400).json({ success: false, error: "invalid id" });
    const dir = path.join(SKILLS_DIR, id);
    if (!fs.existsSync(dir)) return res.status(404).json({ success: false, error: "not found" });
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      res.json({ success: true, skills: listSkills() });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
}

module.exports = { createSkillsRouter, listSkills, resolveSkills };
