// agent-backend/routes/workspace.js
// GET /api/workspace/tree — file tree
// GET /api/workspace/file — file content with language detection
// GET /api/workspace/preview — rendered markdown/code HTML
// POST /api/workspace/open — open in system editor

const { Router } = require("express");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const { marked } = require("marked");
const workspacePaths = require("../workspace-paths");

// The explorer is scoped to the CURRENT session's own tree
// (~/.orbit/sessions/<id>/ → workspace/ · artifacts/ · tmp/), passed as ?session=.
// No session → the sessions base dir (lists all sessions, read-only). The display
// prefix "/workspace" maps to whichever root is in effect.
function rootFor(req) {
  const sid = req.query.session || (req.body && req.body.session);
  return sid ? workspacePaths.sessionRoot(sid) : workspacePaths.SESSIONS_DIR;
}

function resolvePath(queryPath, root) {
  if (!queryPath) return root;
  if (queryPath === "/workspace" || queryPath === "workspace") return root;
  if (queryPath.startsWith("/workspace/")) {
    return path.resolve(path.join(root, queryPath.substring("/workspace/".length)));
  }
  if (queryPath.startsWith("workspace/")) {
    return path.resolve(path.join(root, queryPath.substring("workspace/".length)));
  }
  // A bare relative path resolves under the session root, not the process cwd.
  if (!path.isAbsolute(queryPath)) return path.resolve(path.join(root, queryPath));
  return path.resolve(queryPath);
}

function createWorkspaceRouter() {
  const router = Router();

  // ── File Tree ───────────────────────────────────────────────────
  router.get("/tree", (req, res, next) => {
    try {
      const WORKSPACE_ROOT = rootFor(req);
      // Ensure the session tree exists so a fresh session shows its dirs, not 404.
      if (req.query.session) { try { workspacePaths.ensureSessionDirs(req.query.session); } catch {} }
      const resolved = resolvePath(req.query.path, WORKSPACE_ROOT);

      if (!resolved.startsWith(WORKSPACE_ROOT)) {
        return res.status(403).json({ success: false, message: "Access denied." });
      }

      if (!fs.existsSync(resolved)) {
        return res.status(404).json({ success: false, message: "Directory not found." });
      }

      const entries = fs.readdirSync(resolved, { withFileTypes: true });
      const tree = entries
        .filter(e => !e.name.startsWith(".") && e.name !== "node_modules")
        .map(e => ({
          name: e.name,
          type: e.isDirectory() ? "directory" : "file",
          path: path.join(resolved, e.name).replace(WORKSPACE_ROOT, "/workspace"),
          ...(e.isFile() ? {
            size: fs.statSync(path.join(resolved, e.name)).size,
            modified: fs.statSync(path.join(resolved, e.name)).mtime.toISOString(),
          } : {}),
        }))
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

      res.json({ tree, root: resolved.replace(WORKSPACE_ROOT, "/workspace") });
    } catch (err) { next(err); }
  });

  // ── File Content ────────────────────────────────────────────────
  router.get("/file", (req, res, next) => {
    try {
      const WORKSPACE_ROOT = rootFor(req);
      const filePath = resolvePath(req.query.path, WORKSPACE_ROOT);

      if (!filePath.startsWith(WORKSPACE_ROOT)) {
        return res.status(403).json({ success: false, message: "Access denied." });
      }
      
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        return res.status(404).json({ success: false, message: "File not found." });
      }

      // Raw bytes (e.g. images for the Preview panel's <img>). Path is already
      // validated to live under WORKSPACE_ROOT above.
      if (req.query.raw) {
        return res.sendFile(filePath);
      }

      const stats = fs.statSync(filePath);
      // Limit file size to 500KB for preview
      if (stats.size > 500 * 1024) {
        return res.status(413).json({ success: false, message: "File too large for preview (>500KB)." });
      }
      
      const content = fs.readFileSync(filePath, "utf-8");
      const ext = path.extname(filePath).toLowerCase();
      const languageMap = {
        ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript",
        ".ts": "typescript", ".jsx": "jsx", ".tsx": "tsx",
        ".json": "json", ".md": "markdown", ".mdx": "markdown",
        ".css": "css", ".scss": "scss", ".html": "html",
        ".py": "python", ".sh": "bash", ".bash": "bash",
        ".yml": "yaml", ".yaml": "yaml", ".xml": "xml",
        ".sql": "sql", ".graphql": "graphql",
        ".txt": "text", ".log": "text", ".env": "text",
      };
      
      res.json({
        content,
        language: languageMap[ext] || "text",
        size: stats.size,
        modified: stats.mtime.toISOString(),
        path: filePath.replace(WORKSPACE_ROOT, "/workspace"),
      });
    } catch (err) { next(err); }
  });

  // ── Preview (rendered HTML) ─────────────────────────────────────
  router.get("/preview", (req, res, next) => {
    try {
      const WORKSPACE_ROOT = rootFor(req);
      const filePath = resolvePath(req.query.path, WORKSPACE_ROOT);

      if (!filePath.startsWith(WORKSPACE_ROOT)) {
        return res.status(403).json({ success: false, message: "Access denied." });
      }
      
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        return res.status(404).json({ success: false, message: "File not found." });
      }
      
      const content = fs.readFileSync(filePath, "utf-8");
      const ext = path.extname(filePath).toLowerCase();
      
      let html = "";
      if (ext === ".md" || ext === ".mdx") {
        html = marked.parse(content);
      } else if (ext === ".json") {
        try {
          const parsed = JSON.parse(content);
          html = `<pre><code>${escapeHtml(JSON.stringify(parsed, null, 2))}</code></pre>`;
        } catch {
          html = `<pre><code>${escapeHtml(content)}</code></pre>`;
        }
      } else {
        html = `<pre><code>${escapeHtml(content)}</code></pre>`;
      }
      
      res.json({
        html,
        raw: content,
        language: ext.replace(".", ""),
        path: filePath.replace(WORKSPACE_ROOT, "/workspace"),
      });
    } catch (err) { next(err); }
  });

  // ── Open in System Editor ───────────────────────────────────────
  router.post("/open", (req, res, next) => {
    try {
      const WORKSPACE_ROOT = rootFor(req);
      const filePath = resolvePath(req.body.path, WORKSPACE_ROOT);

      if (!filePath.startsWith(WORKSPACE_ROOT)) {
        return res.status(403).json({ success: false, message: "Access denied." });
      }
      
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ success: false, message: "File not found." });
      }
      
      const platform = process.platform;
      const cmd = platform === "darwin"
        ? `open "${filePath}"`
        : platform === "win32"
          ? `start "" "${filePath}"`
          : `xdg-open "${filePath}"`;
      
      exec(cmd, (err) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json({ success: true, message: "Opened in default editor." });
      });
    } catch (err) { next(err); }
  });

  return router;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

module.exports = createWorkspaceRouter;
