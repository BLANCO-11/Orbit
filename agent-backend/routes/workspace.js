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

const WORKSPACE_ROOT = path.resolve(__dirname, "../../workspace");

function createWorkspaceRouter() {
  const router = Router();

  // ── File Tree ───────────────────────────────────────────────────
  router.get("/tree", (req, res, next) => {
    try {
      const dirPath = req.query.path || WORKSPACE_ROOT;
      const resolved = path.resolve(dirPath);
      
      if (!resolved.startsWith(WORKSPACE_ROOT)) {
        return res.status(403).json({ success: false, message: "Access denied." });
      }
      
      if (!fs.existsSync(resolved)) {
        return res.status(404).json({ success: false, message: "Directory not found." });
      }
      
      const entries = fs.readdirSync(resolved, { withFileTypes: true });
      const tree = entries
        .filter(e => !e.name.startsWith(".") && e.name !== "node_modules" && e.name !== "screenshots" && e.name !== "temp")
        .map(e => ({
          name: e.name,
          type: e.isDirectory() ? "directory" : "file",
          path: path.join(dirPath, e.name).replace(WORKSPACE_ROOT, "/workspace"),
          ...(e.isFile() ? {
            size: fs.statSync(path.join(resolved, e.name)).size,
            modified: fs.statSync(path.join(resolved, e.name)).mtime.toISOString(),
          } : {}),
        }))
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      
      res.json({ tree, root: dirPath.replace(WORKSPACE_ROOT, "/workspace") });
    } catch (err) { next(err); }
  });

  // ── File Content ────────────────────────────────────────────────
  router.get("/file", (req, res, next) => {
    try {
      const filePath = path.resolve(req.query.path || "");
      
      if (!filePath.startsWith(WORKSPACE_ROOT)) {
        return res.status(403).json({ success: false, message: "Access denied." });
      }
      
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        return res.status(404).json({ success: false, message: "File not found." });
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
      const filePath = path.resolve(req.query.path || "");
      
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
      const filePath = path.resolve(req.body.path || "");
      
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
