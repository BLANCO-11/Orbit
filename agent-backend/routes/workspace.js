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
const db = require("../db");

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

// The explorer's display path (/workspace, /workspace/sub) → a workspace-relative
// path for the remote connector's fs RPC.
function relFromQueryPath(qp) {
  if (!qp || qp === "/workspace" || qp === "workspace") return "";
  if (qp.startsWith("/workspace/")) return qp.substring("/workspace/".length);
  if (qp.startsWith("workspace/")) return qp.substring("workspace/".length);
  return String(qp).replace(/^\/+/, "");
}

const LANGUAGE_MAP = {
  ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".ts": "typescript", ".jsx": "jsx", ".tsx": "tsx",
  ".json": "json", ".md": "markdown", ".mdx": "markdown",
  ".css": "css", ".scss": "scss", ".html": "html",
  ".py": "python", ".sh": "bash", ".bash": "bash",
  ".yml": "yaml", ".yaml": "yaml", ".xml": "xml",
  ".sql": "sql", ".graphql": "graphql",
  ".txt": "text", ".log": "text", ".env": "text",
};

// When the session's selected agent is a connected REMOTE harness, its workspace
// lives on that machine — route list/read to the connector over the socket
// (harnessRegistry.requestFs) instead of the local filesystem. The harness id is
// taken from the explicit ?harnessId (so switching agents in the UI is honored
// immediately), else from the session's persisted composer.harnessId — so the
// explorer follows the session's primary agent with no client plumbing. Returns
// the remote harness id to route to, or null for the local filesystem path.
async function remoteHarnessFor(req, harnessRegistry) {
  if (!harnessRegistry || !harnessRegistry.get) return null;
  const session = req.query.session || (req.body && req.body.session);
  let hid = req.query.harnessId || (req.body && req.body.harnessId);
  if (!hid && session) {
    try { hid = (await db.getSession(session))?.harnessId; } catch {}
  }
  if (!hid || hid === "local") return null;
  return harnessRegistry.get(hid) ? hid : null;
}

function createWorkspaceRouter(harnessRegistry) {
  const router = Router();

  // ── File Tree ───────────────────────────────────────────────────
  router.get("/tree", async (req, res, next) => {
    try {
      // Remote agent → list over the connector socket (its workspace, its machine).
      const remoteId = await remoteHarnessFor(req, harnessRegistry);
      if (remoteId) {
        const rel = relFromQueryPath(req.query.path);
        const r = await harnessRegistry.requestFs(remoteId, { op: "list", sessionId: req.query.session, path: rel });
        if (!r || !r.ok) {
          const code = r && r.error === "harness not connected" ? 503 : 502;
          return res.status(code).json({ success: false, message: (r && r.error) || "remote list failed" });
        }
        const base = rel ? `/workspace/${rel}` : "/workspace";
        const tree = (r.entries || [])
          .map((e) => ({
            name: e.name,
            type: e.type,
            path: `${base}/${e.name}`.replace(/\/{2,}/g, "/"),
            ...(e.type === "file" ? { size: e.size, modified: e.modified } : {}),
          }))
          .sort((a, b) => (a.type !== b.type ? (a.type === "directory" ? -1 : 1) : a.name.localeCompare(b.name)));
        return res.json({ tree, root: base, remote: true });
      }

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

      // Denylist rather than hiding every dotfile — agent-written config/plan
      // dotfiles (e.g. .env examples, .pi/) should be visible in the explorer.
      const HIDDEN = new Set([".git", "node_modules", ".DS_Store"]);
      const entries = fs.readdirSync(resolved, { withFileTypes: true });
      const tree = entries
        .filter(e => !HIDDEN.has(e.name))
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
  router.get("/file", async (req, res, next) => {
    try {
      // Remote agent → read over the connector socket. (Text only; the connector
      // returns utf8, so raw/binary — e.g. images — isn't supported remotely yet.)
      const remoteId = await remoteHarnessFor(req, harnessRegistry);
      if (remoteId) {
        if (req.query.raw) return res.status(415).json({ success: false, message: "Raw/binary preview isn't supported for remote agents." });
        const rel = relFromQueryPath(req.query.path);
        const r = await harnessRegistry.requestFs(remoteId, { op: "read", sessionId: req.query.session, path: rel });
        if (!r || !r.ok) {
          const code = r && r.error === "harness not connected" ? 503 : (r && /too large/.test(r.error || "") ? 413 : 404);
          return res.status(code).json({ success: false, message: (r && r.error) || "remote read failed" });
        }
        const ext = path.extname(rel).toLowerCase();
        return res.json({ content: r.content, language: LANGUAGE_MAP[ext] || "text", size: r.size, modified: r.modified, path: `/workspace/${rel}`, remote: true });
      }

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
