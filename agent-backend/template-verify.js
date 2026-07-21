// agent-backend/template-verify.js
//
// Post-generation compliance check for a tenant output-constraint template.
// Runs at run finalization (after the agent stops, before the contract is
// assembled). It inspects the generated files and reports whether they honor
// the template's allowed languages + allowed/denied packages.
//
// STANCE (per design): AUDIT-ONLY. This NEVER blocks or fails a run on its own;
// it emits a `templateCompliance` block into the run contract for the parent app
// to inspect. (The template's `verify.enforce*` flags are surfaced but do not
// hard-block today.)

const fs = require("fs");
const path = require("path");
const workspacePaths = require("./workspace-paths");

const MAX_FILES = 200;
const MAX_FILE_BYTES = 512 * 1024;

const LANG_BY_EXT = {
  ".py": "python", ".js": "node", ".mjs": "node", ".cjs": "node",
  ".ts": "node", ".tsx": "node", ".jsx": "node",
  ".sh": "bash", ".bash": "bash", ".go": "go", ".rb": "ruby",
  ".java": "java", ".rs": "rust",
};

// Small built-in module allowlists so "allowed packages" checks don't flag the
// standard library. Not exhaustive — deliberately conservative (audit-only).
const PY_STDLIB = new Set([
  "os", "sys", "re", "json", "math", "time", "datetime", "random", "collections",
  "itertools", "functools", "typing", "pathlib", "subprocess", "shutil", "glob",
  "argparse", "logging", "urllib", "http", "socket", "ssl", "hashlib", "base64",
  "csv", "io", "tempfile", "traceback", "asyncio", "threading", "unittest", "abc",
  "dataclasses", "enum", "decimal", "statistics", "uuid", "copy", "string",
]);
const NODE_BUILTIN = new Set([
  "fs", "path", "os", "http", "https", "url", "crypto", "util", "events", "stream",
  "child_process", "readline", "zlib", "assert", "buffer", "process", "net", "tls",
  "dns", "querystring", "string_decoder", "timers", "async_hooks", "worker_threads",
]);

function walk(dir, out, budget) {
  if (budget.n >= MAX_FILES) return;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (budget.n >= MAX_FILES) return;
    if (e.name === ".pi" || e.name === "node_modules" || e.name === ".git") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out, budget);
    else if (e.isFile()) { out.push(full); budget.n++; }
  }
}

function pyImports(text) {
  const mods = new Set();
  const re = /^\s*(?:import\s+([A-Za-z0-9_.]+)|from\s+([A-Za-z0-9_.]+)\s+import)/gm;
  let m;
  while ((m = re.exec(text))) {
    const raw = (m[1] || m[2] || "").split(".")[0];
    if (raw) mods.add(raw);
  }
  return mods;
}

function nodeImports(text) {
  const mods = new Set();
  const req = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  const imp = /import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  for (const re of [req, imp]) {
    let m;
    while ((m = re.exec(text))) {
      let name = m[1];
      if (name.startsWith(".") || name.startsWith("/")) continue; // local import
      if (name.startsWith("node:")) name = name.slice(5);
      // scoped pkg @scope/name → keep @scope/name; else first path segment
      const top = name.startsWith("@") ? name.split("/").slice(0, 2).join("/") : name.split("/")[0];
      mods.add(top);
    }
  }
  return mods;
}

// Verify generated files in a session against a template. Returns a
// `templateCompliance` object, or null when there is nothing to check.
function verifyTemplateCompliance(sessionId, template) {
  if (!template || !template.def) return null;
  const d = template.def;
  const hasLangRule = d.languages && Array.isArray(d.languages.allowed) && d.languages.allowed.length;
  const hasPkgRule = d.packages && Object.keys(d.packages).length;
  if (!hasLangRule && !hasPkgRule) return null;

  const dirs = workspacePaths.sessionDirs(sessionId);
  const files = [];
  const budget = { n: 0 };
  walk(dirs.workspace, files, budget);
  walk(dirs.artifacts, files, budget);

  const violations = [];
  const langsSeen = new Set();
  const allowedLangs = hasLangRule ? new Set(d.languages.allowed) : null;

  for (const full of files) {
    const ext = path.extname(full).toLowerCase();
    const lang = LANG_BY_EXT[ext];
    if (!lang) continue;
    langsSeen.add(lang);
    const rel = path.relative(dirs.root, full);

    // Language allow-list.
    if (allowedLangs && !allowedLangs.has(lang)) {
      violations.push({ rule: "languages.allowed", detail: `used ${lang} (not in allow-list: ${d.languages.allowed.join(", ")})`, file: rel });
    }

    // Package checks.
    if (hasPkgRule) {
      const spec = d.packages[lang];
      if (spec) {
        let text = "";
        try {
          if (fs.statSync(full).size <= MAX_FILE_BYTES) text = fs.readFileSync(full, "utf8");
        } catch {}
        if (text) {
          const mods = lang === "python" ? pyImports(text) : (lang === "node" ? nodeImports(text) : new Set());
          const builtin = lang === "python" ? PY_STDLIB : NODE_BUILTIN;
          const denied = new Set(spec.denied || []);
          const allowed = (spec.allowed && spec.allowed.length) ? new Set(spec.allowed) : null;
          for (const mod of mods) {
            if (denied.has(mod)) {
              violations.push({ rule: "packages.denied", detail: `imports forbidden package '${mod}'`, file: rel });
            } else if (allowed && !allowed.has(mod) && !builtin.has(mod)) {
              violations.push({ rule: "packages.allowed", detail: `imports '${mod}' not in the ${lang} allow-list`, file: rel });
            }
          }
        }
      }
    }
  }

  return {
    templateId: template.id,
    ok: violations.length === 0,
    violations: violations.slice(0, 100),
    checked: { files: files.length, languages: Array.from(langsSeen) },
    enforced: false, // audit-only; never hard-blocks the run today
  };
}

module.exports = { verifyTemplateCompliance };
