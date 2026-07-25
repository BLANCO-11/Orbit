// agent-backend/services/plan-generator.js
// Hybrid plan generation via reasoning model

const { OpenAI } = require("openai");
const { stripTuiChars } = require("../harnesses/picode/parser");
const env = require("../env-config");

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
  // getConfig() has already resolved env → config (config.getResolvedConfig),
  // including reasoningModel falling back to fastModel. No second fallback
  // chain here: this file used to carry its own, and it drifted.
  const llm = (config && config.llm) || {};

  if (!llm.apiKey) {
    console.error("[Plan Generator] No LLM API key configured; skipping plan generation.");
    return null;
  }

  // NO hardcoded model name — never a provider literal the gateway may reject
  // (the old "deepseek-v4-flash" → 401).
  const reasoningModel = llm.reasoningModel;
  if (!reasoningModel) {
    console.error("[Plan Generator] No reasoning model configured (set LLM_REASONING_MODEL or LLM_FAST_MODEL); skipping plan generation.");
    return null;
  }
  if (!llm.baseUrl) {
    console.error("[Plan Generator] No LLM base URL configured; skipping plan generation.");
    return null;
  }
  const { apiKey, baseUrl: baseURL } = llm;

  const planPrompt = (llm.hybridPlanPrompt || DEFAULT_PLAN_PROMPT) + userPrompt;
  
  try {
    // The pre-plan is a short UI reasoning preview (it does NOT drive generation —
    // the agent self-plans). So BOUND it: cap output + a hard client timeout so an
    // uncapped/slow completion can't run for ~60s. Overridable via env.
    const maxTokens = env.get("LLM_PLAN_MAX_TOKENS");
    const timeoutMs = env.get("LLM_PLAN_TIMEOUT_MS");
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
