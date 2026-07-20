// agent-backend/run-contract.js
// The result contract for a run (Gap 2). A run's terminal output is a typed,
// validated object the parent app can act on WITHOUT scraping the transcript.
//
// Two sources are merged:
//   1. Backend-synthesized baseline (always present, deterministic): status,
//      final assistant message, artifact listing, token/cost usage, exit info.
//   2. The agent-authored artifacts/RESULT.json (self-reported tests), validated
//      against a schema. Missing/invalid → status "needs_review" (never a silent
//      "succeeded"); valid + tests passed → "succeeded"; tests failed → "failed".
//
// Also owns the per-run artifact SNAPSHOT: at run end the live artifacts dir is
// copied to runs/<runId>/artifacts so v1's outputs survive when v2 rewrites the
// workspace.

const fs = require("fs");
const path = require("path");
const workspacePaths = require("./workspace-paths");

const TESTS_OUTPUT_CAP = 8 * 1024; // cap self-reported test output in the contract

const LANG_BY_EXT = {
  ".py": "python", ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".ts": "typescript", ".tsx": "typescript", ".jsx": "javascript", ".sh": "bash",
  ".rb": "ruby", ".go": "go", ".rs": "rust", ".java": "java", ".php": "php",
  ".md": "markdown", ".json": "json", ".yaml": "yaml", ".yml": "yaml",
  ".html": "html", ".css": "css", ".csv": "csv", ".txt": "text", ".sql": "sql",
};
const MIME_BY_EXT = {
  ".py": "text/x-python", ".js": "text/javascript", ".mjs": "text/javascript",
  ".ts": "text/x-typescript", ".sh": "text/x-shellscript", ".md": "text/markdown",
  ".json": "application/json", ".yaml": "text/yaml", ".yml": "text/yaml",
  ".html": "text/html", ".css": "text/css", ".csv": "text/csv", ".txt": "text/plain",
  ".sql": "application/sql",
};
// Files that are program source (used to pick a primaryArtifact when the agent
// doesn't name one).
const CODE_EXTS = new Set([".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".sh", ".rb", ".go", ".rs", ".java", ".php", ".sql"]);

function classifyFile(rel) {
  const ext = path.extname(rel).toLowerCase();
  return {
    language: LANG_BY_EXT[ext] || "text",
    mime: MIME_BY_EXT[ext] || "application/octet-stream",
    isCode: CODE_EXTS.has(ext),
  };
}

// Recursively list files under `dir`, returning contract artifact descriptors
// with a "/artifacts/…"-style logical path. Bounded so a runaway workspace can't
// blow up the contract.
function listArtifacts(dir, { maxFiles = 500, prefix = "/artifacts" } = {}) {
  const out = [];
  if (!dir || !fs.existsSync(dir)) return out;
  const walk = (abs, rel) => {
    if (out.length >= maxFiles) return;
    let entries = [];
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= maxFiles) return;
      const childAbs = path.join(abs, e.name);
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { walk(childAbs, childRel); continue; }
      if (!e.isFile()) continue;
      let bytes = 0;
      try { bytes = fs.statSync(childAbs).size; } catch {}
      const { language, mime, isCode } = classifyFile(childRel);
      out.push({ path: `${prefix}/${childRel}`, rel: childRel, language, mime, bytes, isCode });
    }
  };
  walk(dir, "");
  return out;
}

// Choose the run's primary artifact: the RESULT.json-named one if it resolves,
// else the largest code file, else the largest file, else null.
function pickPrimary(artifacts, namedRel) {
  const usable = artifacts.filter((a) => a.rel !== "RESULT.json");
  if (namedRel) {
    const norm = String(namedRel).replace(/^\.?\/*/, "").replace(/^artifacts\//, "");
    const hit = usable.find((a) => a.rel === norm || a.path === namedRel || a.rel.endsWith(norm));
    if (hit) return hit;
  }
  const code = usable.filter((a) => a.isCode).sort((a, b) => b.bytes - a.bytes);
  if (code.length) return code[0];
  const any = [...usable].sort((a, b) => b.bytes - a.bytes);
  return any[0] || null;
}

// ── RESULT.json schema validator (hand-rolled; no external dep) ───────
// Shape the script-gen skill must emit:
//   { ok:boolean, summary?:string,
//     tests:{ ran:boolean, passed:boolean, command?:string, output?:string },
//     primaryArtifact?:string }
function validateResultJson(raw) {
  const errors = [];
  let data = null;
  if (typeof raw === "string") {
    try { data = JSON.parse(raw); } catch (e) { return { valid: false, errors: [`not valid JSON: ${e.message}`], data: null }; }
  } else if (raw && typeof raw === "object") {
    data = raw;
  } else {
    return { valid: false, errors: ["RESULT.json missing"], data: null };
  }
  if (typeof data !== "object" || Array.isArray(data) || data === null) {
    return { valid: false, errors: ["top-level must be an object"], data: null };
  }
  if (typeof data.ok !== "boolean") errors.push("`ok` must be a boolean");
  if (data.summary !== undefined && typeof data.summary !== "string") errors.push("`summary` must be a string");
  if (data.primaryArtifact !== undefined && typeof data.primaryArtifact !== "string") errors.push("`primaryArtifact` must be a string");
  const t = data.tests;
  if (t === undefined || typeof t !== "object" || t === null || Array.isArray(t)) {
    errors.push("`tests` object is required");
  } else {
    if (typeof t.ran !== "boolean") errors.push("`tests.ran` must be a boolean");
    if (typeof t.passed !== "boolean") errors.push("`tests.passed` must be a boolean");
    if (t.command !== undefined && typeof t.command !== "string") errors.push("`tests.command` must be a string");
    if (t.output !== undefined && typeof t.output !== "string") errors.push("`tests.output` must be a string");
  }
  return { valid: errors.length === 0, errors, data };
}

// Read + validate the agent's RESULT.json from an artifacts dir.
function readResultJson(artifactsDir) {
  const p = path.join(artifactsDir, "RESULT.json");
  let raw = null;
  try { raw = fs.readFileSync(p, "utf-8"); } catch { /* absent */ }
  if (raw == null) return { present: false, valid: false, errors: ["RESULT.json not written"], data: null };
  const v = validateResultJson(raw);
  return { present: true, ...v };
}

// Copy the live artifacts dir → runs/<runId>/artifacts (full copy). Returns the
// snapshot dir, or null if there was nothing to snapshot.
function snapshotArtifacts(sessionId, runId) {
  const dirs = workspacePaths.sessionDirs(sessionId);
  const src = dirs.artifacts;
  if (!fs.existsSync(src)) return null;
  const destRoot = path.join(dirs.root, "runs", workspacePaths.safeId(runId), "artifacts");
  try {
    fs.mkdirSync(path.dirname(destRoot), { recursive: true });
    fs.cpSync(src, destRoot, { recursive: true });
    return destRoot;
  } catch (e) {
    console.error(`[run-contract] snapshot failed for ${runId}:`, e.message);
    return null;
  }
}

// Derive the terminal contract status from the lifecycle outcome + RESULT.json.
//   lifecycle: "completed" | "error" | "timeout" | "cancelled"
function deriveStatus(lifecycle, result) {
  if (lifecycle === "error") return "error";
  if (lifecycle === "timeout") return "timeout";
  if (lifecycle === "cancelled") return "error"; // caller-cancelled → not a success
  // lifecycle === "completed" (agent_end fired cleanly)
  if (!result.present || !result.valid) return "needs_review";
  if (result.data.ok === false) return "failed";
  if (result.data.tests && result.data.tests.ran && result.data.tests.passed === false) return "failed";
  return "succeeded";
}

// Build the full, typed contract. `usage` = { tokens, cost, toolCalls }.
function assembleContract({ runId, sessionId, seq, lifecycle, finalMessage, usage, error }) {
  const dirs = workspacePaths.sessionDirs(sessionId);
  const artifacts = listArtifacts(dirs.artifacts);
  const result = readResultJson(dirs.artifacts);
  const status = deriveStatus(lifecycle, result);

  const namedPrimary = result.valid && result.data && result.data.primaryArtifact;
  const primary = pickPrimary(artifacts, namedPrimary);

  // Tests: prefer the agent's self-report; absent → not-run.
  let tests = { ran: false, passed: false };
  if (result.valid && result.data.tests) {
    const t = result.data.tests;
    tests = {
      ran: !!t.ran, passed: !!t.passed,
      ...(t.command ? { command: String(t.command) } : {}),
      ...(t.output ? { output: String(t.output).slice(0, TESTS_OUTPUT_CAP) } : {}),
    };
  }

  const ok = status === "succeeded";
  const summary =
    (result.valid && result.data.summary) ||
    (finalMessage ? String(finalMessage).split("\n")[0].slice(0, 200) : "") ||
    `Run ${status}`;

  const publicArtifacts = artifacts.map((a) => ({ path: a.path, language: a.language, mime: a.mime, bytes: a.bytes }));

  return {
    runId, sessionId, seq,
    status, ok,
    summary,
    primaryArtifact: primary ? { path: primary.path, language: primary.language, bytes: primary.bytes } : null,
    artifacts: publicArtifacts,
    tests,
    usage: usage || { tokens: 0, cost: 0, toolCalls: 0 },
    finalMessage: finalMessage ? String(finalMessage).slice(0, 4000) : "",
    error: error || null,
    raw: {
      resultJsonPresent: result.present,
      resultJsonValid: result.valid,
      resultJsonErrors: result.valid ? [] : result.errors,
    },
  };
}

// The "still running" placeholder contract for a not-yet-terminal run.
function runningContract({ runId, sessionId, seq }) {
  return {
    runId, sessionId, seq,
    status: "running", ok: false, summary: "run in progress",
    primaryArtifact: null, artifacts: [], tests: { ran: false, passed: false },
    usage: { tokens: 0, cost: 0, toolCalls: 0 }, finalMessage: "", error: null,
    raw: { resultJsonPresent: false, resultJsonValid: false, resultJsonErrors: [] },
  };
}

module.exports = {
  assembleContract,
  runningContract,
  validateResultJson,
  readResultJson,
  snapshotArtifacts,
  deriveStatus,
  listArtifacts,
  pickPrimary,
};
