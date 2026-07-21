// agent-backend/templates.js
//
// Per-tenant "output-constraint" templates. A template answers "WHAT may the
// runtime produce, and within what rules" — allowed languages, allowed/denied
// packages, implementation-structure rules + free-form conventions — plus an
// optional workspace scaffold materialized into the session's workspace/ at
// creation. This is DISTINCT from a profile (which answers "HOW the runtime
// runs": mode/effort/sandbox/prompt/skills).
//
// A template compiles into TWO things at runtime:
//   1. compileTemplatePrompt() → a markdown block appended to the system prompt
//      (the "sub-prompt system") so the agent knows the constraints.
//   2. materializeScaffold()   → a tenant-defined starter layout inside
//      workspace/ (the "custom workspace" — the canonical three-dir tree is
//      unchanged; only the CONTENTS of workspace/ at t=0 are tenant-controlled).
//
// Enforcement stance (per design): guidance + post-generation VERIFY (see
// template-verify.js), NOT a hard runtime block.

const fs = require("fs");
const path = require("path");

const MAX_SCAFFOLD_FILES = 50;
const MAX_SCAFFOLD_FILE_BYTES = 256 * 1024; // 256 KiB per seeded file
const KNOWN_LANGS = ["python", "node", "javascript", "typescript", "bash", "go", "ruby", "java", "rust"];

function arrOfStr(v, cap) {
  return Array.isArray(v) ? v.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim()).slice(0, cap) : [];
}

// Validate + coerce a template `def_json` document. Forgiving (clamps/normalizes
// like the profile sanitizer) — throws only on structurally-unusable input.
function validateTemplateDef(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("template def must be a JSON object");
  }
  const def = {};
  if (raw.name !== undefined) def.name = String(raw.name).slice(0, 120);
  if (raw.description !== undefined) def.description = String(raw.description).slice(0, 500);

  // languages: { allowed: [..], default: "python" }
  if (raw.languages && typeof raw.languages === "object") {
    const allowed = arrOfStr(raw.languages.allowed, 20).map((l) => l.toLowerCase());
    const def0 = raw.languages.default ? String(raw.languages.default).toLowerCase() : (allowed[0] || "");
    def.languages = { allowed, default: def0 };
  }

  // packages: { <lang>: { allowed:[..], denied:[..] } }
  if (raw.packages && typeof raw.packages === "object") {
    const pkgs = {};
    for (const [lang, spec] of Object.entries(raw.packages)) {
      if (!spec || typeof spec !== "object") continue;
      pkgs[String(lang).toLowerCase()] = {
        allowed: arrOfStr(spec.allowed, 500),
        denied: arrOfStr(spec.denied, 500),
      };
    }
    def.packages = pkgs;
  }

  // structure: { rules: [..] }
  if (raw.structure && typeof raw.structure === "object") {
    def.structure = { rules: arrOfStr(raw.structure.rules, 100).map((r) => r.slice(0, 300)) };
  }

  if (raw.conventions !== undefined) def.conventions = String(raw.conventions).slice(0, 20000);

  // scaffold: { dirs: [..], files: [{path, content}] }
  if (raw.scaffold && typeof raw.scaffold === "object") {
    const dirs = arrOfStr(raw.scaffold.dirs, MAX_SCAFFOLD_FILES).map((d) => d.slice(0, 256));
    const files = Array.isArray(raw.scaffold.files)
      ? raw.scaffold.files
          .filter((f) => f && typeof f === "object" && typeof f.path === "string")
          .slice(0, MAX_SCAFFOLD_FILES)
          .map((f) => ({ path: String(f.path).slice(0, 256), content: String(f.content == null ? "" : f.content) }))
          .filter((f) => Buffer.byteLength(f.content, "utf8") <= MAX_SCAFFOLD_FILE_BYTES)
      : [];
    def.scaffold = { dirs, files };
  }

  // verify: { enforceLanguages, enforcePackages, enforceStructure } — flags for
  // the post-gen checker; all default false (audit-only, never hard-block today).
  if (raw.verify && typeof raw.verify === "object") {
    def.verify = {
      enforceLanguages: !!raw.verify.enforceLanguages,
      enforcePackages: !!raw.verify.enforcePackages,
      enforceStructure: !!raw.verify.enforceStructure,
    };
  }
  return def;
}

// Compile a template row → a markdown system-prompt fragment (the sub-prompt).
// Returns "" when the template contributes no constraints.
function compileTemplatePrompt(template) {
  if (!template || !template.def) return "";
  const d = template.def;
  const lines = [];
  const title = template.name || (d && d.name) || template.id || "tenant template";
  lines.push(`## Output constraints (template: ${title})`);
  lines.push("The output you produce MUST conform to the following tenant constraints. Treat these as hard requirements; a run that violates them is flagged.");

  if (d.languages && d.languages.allowed && d.languages.allowed.length) {
    const dflt = d.languages.default ? ` (default: ${d.languages.default})` : "";
    lines.push(`- Allowed languages: ${d.languages.allowed.join(", ")}${dflt}. Do not use any other language.`);
  }
  if (d.packages && Object.keys(d.packages).length) {
    for (const [lang, spec] of Object.entries(d.packages)) {
      if (spec.allowed && spec.allowed.length) lines.push(`- Allowed ${lang} packages: ${spec.allowed.join(", ")}. Prefer these; avoid others.`);
      if (spec.denied && spec.denied.length) lines.push(`- Forbidden ${lang} packages: ${spec.denied.join(", ")}. Never use these.`);
    }
  }
  if (d.structure && d.structure.rules && d.structure.rules.length) {
    lines.push("- Structure rules:");
    for (const r of d.structure.rules) lines.push(`  - ${r}`);
  }
  if (d.conventions && d.conventions.trim()) {
    lines.push("");
    lines.push(d.conventions.trim());
  }
  return lines.join("\n");
}

// True if `rel` stays inside the base dir (no absolute paths, no `..` escape).
function isSafeRel(rel) {
  if (!rel || typeof rel !== "string") return false;
  if (path.isAbsolute(rel)) return false;
  const norm = path.normalize(rel);
  return !norm.startsWith("..") && !norm.split(path.sep).includes("..");
}

// Materialize a template's scaffold INTO workspaceDir. Only intended to run when
// the workspace is empty (caller decides) — never clobbers existing files.
// Returns { dirs, files, skipped } counts. Best-effort; never throws.
function materializeScaffold(workspaceDir, scaffold) {
  const out = { dirs: 0, files: 0, skipped: 0 };
  if (!scaffold || typeof scaffold !== "object") return out;
  try {
    for (const d of Array.isArray(scaffold.dirs) ? scaffold.dirs.slice(0, MAX_SCAFFOLD_FILES) : []) {
      if (!isSafeRel(d)) { out.skipped++; continue; }
      try { fs.mkdirSync(path.join(workspaceDir, d), { recursive: true }); out.dirs++; } catch { out.skipped++; }
    }
    for (const f of Array.isArray(scaffold.files) ? scaffold.files.slice(0, MAX_SCAFFOLD_FILES) : []) {
      if (!f || !isSafeRel(f.path)) { out.skipped++; continue; }
      const abs = path.join(workspaceDir, f.path);
      if (fs.existsSync(abs)) { out.skipped++; continue; } // never clobber
      const content = String(f.content == null ? "" : f.content);
      if (Buffer.byteLength(content, "utf8") > MAX_SCAFFOLD_FILE_BYTES) { out.skipped++; continue; }
      try {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, "utf8");
        out.files++;
      } catch { out.skipped++; }
    }
  } catch (e) { /* best-effort */ }
  return out;
}

module.exports = {
  validateTemplateDef,
  compileTemplatePrompt,
  materializeScaffold,
  isSafeRel,
  KNOWN_LANGS,
  MAX_SCAFFOLD_FILES,
};
