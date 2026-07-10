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
  return router;
}

module.exports = { createSkillsRouter, listSkills, resolveSkills };
