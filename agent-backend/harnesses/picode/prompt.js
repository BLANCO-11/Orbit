// agent-backend/harnesses/picode/prompt.js
//
// Shared system-prompt composer. Extracted from PiCodeHarness.connect() so the
// SAME prompt can be built for a LOCAL pi child (in-process) and for a REMOTE
// agent (built on the backend, sent down to a paired orbit-connect). The only
// machine-specific piece — the per-session workspace block — is passed in:
// local pi supplies its real session dirs; for a remote the backend omits it and
// the remote appends its own (it alone knows its paths). Everything else (base
// prompt by type, orbit-system, orbit-behavior, the live policy matrix, the
// capabilities manifest, the mode directive, attached skills) is portable and
// identical either way.

const fs = require("fs");
const path = require("path");

const promptsDir = path.join(__dirname, "../../../prompts");

/**
 * Render config.policyMatrix as a markdown table for the system prompt — the
 * SINGLE authoritative matrix, generated from the enforced config so it can
 * never disagree with what the backend actually gates (Workstream D1).
 */
function renderPolicyMatrix(config) {
  const matrix = config && config.policyMatrix;
  if (!matrix || typeof matrix !== "object") return "";
  const modes = ["chat", "plan", "edit", "yolo"];
  const rows = Object.entries(matrix).map(([cap, byMode]) => {
    const cells = modes.map((m) => String((byMode && byMode[m]) || "—").padEnd(5));
    return `| ${cap.padEnd(15)} | ${cells.join(" | ")} |`;
  });
  if (!rows.length) return "";
  return [
    "## Capability × mode policy (live)",
    "Authoritative, generated from the backend's enforced policy config:",
    "",
    `| ${"capability".padEnd(15)} | ${modes.map((m) => m.padEnd(5)).join(" | ")} |`,
    `|-${"-".repeat(15)}-|${modes.map(() => "-------").join("|")}|`,
    ...rows,
  ].join("\n");
}

/**
 * Compose the full system prompt. Order is canonical and must match what pi has
 * always received: base → orbit-system → orbit-behavior → policy matrix →
 * capabilities → [workspace] → mode directive → skills.
 *
 * @param {object}   opts
 * @param {object}   opts.config              security-config (for policyMatrix + skills default)
 * @param {string}   opts.systemPromptType    prompt-library id ('standard', 'claude-fable-5', …)
 * @param {string}   opts.mode                'chat' | 'plan' | 'edit' | 'yolo'
 * @param {string[]} [opts.skills]            attached skill ids
 * @param {string}   [opts.capabilitiesBlock] rendered "what's configured now" block
 * @param {string}   [opts.workspaceBlock]    per-session workspace block (omit for remote)
 */
function composeSystemPrompt({ config, systemPromptType, mode, skills, capabilitiesBlock, workspaceBlock } = {}) {
  const activePromptType = systemPromptType || (config && config.systemPromptType) || "standard";
  const { resolvePromptFile } = require("../../routes/prompts");
  const basePromptFile = resolvePromptFile(activePromptType);

  let modePromptFile = null;
  if (mode === "plan") modePromptFile = "plan-mode.md";
  else if (mode === "edit") modePromptFile = "edit-mode.md";
  else if (mode === "yolo") modePromptFile = "yolo-mode.md";

  const basePrompt = fs.readFileSync(path.join(promptsDir, basePromptFile), "utf-8");
  let combined = basePrompt;

  // Orbit's self-knowledge (WHAT it is) + operating manual (HOW to operate).
  try {
    combined += "\n\n" + fs.readFileSync(path.join(promptsDir, "orbit-system.md"), "utf-8");
  } catch (e) { console.error("[prompt] orbit-system.md not found:", e.message); }
  try {
    combined += "\n\n" + fs.readFileSync(path.join(promptsDir, "orbit-behavior.md"), "utf-8");
  } catch (e) { console.error("[prompt] orbit-behavior.md not found:", e.message); }

  // Live capability × mode matrix, generated FROM the enforced policy config.
  try {
    const matrix = renderPolicyMatrix(config);
    if (matrix) combined += "\n\n" + matrix;
  } catch { /* non-fatal */ }

  // Dynamic "what's configured right now" manifest (rendered by the caller).
  if (capabilitiesBlock) combined += "\n\n" + capabilitiesBlock;

  // Per-session workspace block — machine-specific; omitted for remotes.
  if (workspaceBlock) combined += "\n\n" + workspaceBlock;

  if (modePromptFile) {
    combined += "\n\n" + fs.readFileSync(path.join(promptsDir, modePromptFile), "utf-8");
  }

  // Attached skills (reusable instruction packs), inherited by sub-agents.
  try {
    const { resolveSkills } = require("../../routes/skills");
    const skillsText = resolveSkills(skills || (config && config.skills) || []);
    if (skillsText) combined += skillsText;
  } catch (e) { console.error("[prompt] skill resolution failed:", e.message); }

  return combined;
}

module.exports = { composeSystemPrompt, renderPolicyMatrix };
