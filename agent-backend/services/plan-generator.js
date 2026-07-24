// agent-backend/services/plan-generator.js
// Hybrid plan generation via reasoning model

const { OpenAI } = require("openai");
const { stripTuiChars } = require("../harnesses/picode/parser");

// A plain, structured plan is cheaper to generate and clearer to read than the
// old TUI box-art (which was decorative and then stripped anyway — Workstream
// B1). This text is shown as reasoning notes, not the canonical plan surface.
const DEFAULT_PLAN_PROMPT = `You are a concise planning assistant.
Given the following user request, outline a short step-by-step approach to achieve it.
Use a plain markdown numbered list — one verifiable step per line, no decoration.
Keep it tight: only the steps that matter, no preamble, no box-drawing characters.
Do not use tools.
User request: `;

async function generatePlan(userPrompt, getConfig) {
  const config = getConfig();
  // Prefer the resolved config key (which already folds in LLM_*/LITELLM_*/
  // OPENAI_* env fallbacks — Workstream F1), fall back to raw env.
  const apiKey = (config && config.litellm && config.litellm.apiKey) || process.env.LLM_API_KEY || process.env.LITELLM_KEY;

  if (!apiKey) {
    console.error("[Plan Generator] No LLM API key configured; skipping plan generation.");
    return null;
  }

  // NO hardcoded model name: use the runtime/parent-configured reasoning model,
  // else the normal model, else the LLM_MODEL / ORBIT_PLAN_MODEL env — never a
  // provider literal the gateway may reject (the old "deepseek-v4-flash" → 401).
  const reasoningModel =
    (config && config.litellm && config.litellm.selectedReasoningModel) ||
    (config && config.litellm && config.litellm.selectedNormalModel) ||
    process.env.ORBIT_PLAN_MODEL ||
    process.env.LLM_MODEL ||
    "";
  if (!reasoningModel) {
    console.error("[Plan Generator] No plan/reasoning model configured (set ORBIT_PLAN_MODEL or LLM_MODEL); skipping plan generation.");
    return null;
  }
  const baseURL = (config && config.litellm && config.litellm.baseURL) || process.env.LLM_BASE_URL || "";
  if (!baseURL) {
    console.error("[Plan Generator] No LLM base URL configured; skipping plan generation.");
    return null;
  }
  
  const planPrompt = ((config && config.litellm && config.litellm.hybridPlanPrompt) || DEFAULT_PLAN_PROMPT) + userPrompt;
  
  try {
    // The pre-plan is a short UI reasoning preview (it does NOT drive generation —
    // the agent self-plans). So BOUND it: cap output + a hard client timeout so an
    // uncapped/slow completion can't run for ~60s. Overridable via env.
    const maxTokens = Number(process.env.ORBIT_PLAN_MAX_TOKENS || 600);
    const timeoutMs = Number(process.env.ORBIT_PLAN_TIMEOUT_MS || 20000);
    const openai = new OpenAI({ baseURL, apiKey, timeout: timeoutMs, maxRetries: 0 });
    const planCompletion = await openai.chat.completions.create({
      model: reasoningModel,
      messages: [{ role: "user", content: planPrompt }],
      max_tokens: maxTokens,
      temperature: 0.3,
    });

    const rawPlan = planCompletion.choices[0].message.content;
    return stripTuiChars(rawPlan);
  } catch (err) {
    console.error("[Plan Generator] Plan generation failed:", err.message);
    return null;
  }
}

module.exports = { generatePlan, DEFAULT_PLAN_PROMPT };
