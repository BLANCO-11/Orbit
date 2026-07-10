// agent-backend/routes/prompts.js
// Prompt library — stored system prompts (prompts/*.md), selectable per
// session from the composer. Mode directives (plan/edit/yolo-mode.md) are
// appended ON TOP of the selected base prompt by the harness and are not
// themselves selectable.

const { Router } = require("express");
const fs = require("fs");
const path = require("path");

const PROMPTS_DIR = path.join(__dirname, "../../prompts");
const MODE_FILES = new Set(["plan-mode.md", "edit-mode.md", "yolo-mode.md"]);
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** First markdown heading, else the filename stem title-cased. */
function titleOf(content, stem) {
  const m = content.match(/^#\s+(.+)$/m);
  if (m) return m[1].trim().substring(0, 80);
  return stem.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** First non-empty, non-heading line as a short description. */
function descriptionOf(content) {
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (t && !t.startsWith("#") && !t.startsWith("---")) {
      return t.substring(0, 120);
    }
  }
  return "";
}

function listPrompts() {
  const files = fs.readdirSync(PROMPTS_DIR).filter(
    f => f.endsWith(".md") && !MODE_FILES.has(f)
  );
  return files.map(f => {
    const stem = f.replace(/\.md$/, "");
    let content = "";
    try { content = fs.readFileSync(path.join(PROMPTS_DIR, f), "utf-8"); } catch {}
    return {
      id: stem,
      label: titleOf(content, stem),
      description: descriptionOf(content),
      isDefault: stem === "standard",
    };
  });
}

/**
 * Resolve a prompt id to its file basename. Handles the legacy "fable-5"
 * alias and rejects anything that isn't a known library entry.
 */
function resolvePromptFile(promptId) {
  const id = promptId === "fable-5" ? "claude-fable-5" : (promptId || "standard");
  if (!ID_RE.test(id)) return "standard.md";
  const candidate = `${id}.md`;
  if (MODE_FILES.has(candidate)) return "standard.md";
  return fs.existsSync(path.join(PROMPTS_DIR, candidate)) ? candidate : "standard.md";
}

function createPromptsRouter() {
  const router = Router();

  router.get("/", (_req, res) => {
    try {
      res.json({ success: true, prompts: listPrompts() });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  router.post("/", (req, res) => {
    const { id, content } = req.body || {};
    if (!id || !ID_RE.test(id)) {
      return res.status(400).json({ success: false, error: "id must match [a-z0-9-], max 64 chars" });
    }
    if (MODE_FILES.has(`${id}.md`)) {
      return res.status(400).json({ success: false, error: "mode directives are managed separately" });
    }
    if (!content || typeof content !== "string" || !content.trim()) {
      return res.status(400).json({ success: false, error: "content is required" });
    }
    try {
      fs.writeFileSync(path.join(PROMPTS_DIR, `${id}.md`), content, "utf-8");
      res.json({ success: true, prompts: listPrompts() });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
}

module.exports = { createPromptsRouter, resolvePromptFile, listPrompts };
