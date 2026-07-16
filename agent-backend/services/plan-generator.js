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

  const reasoningModel = (config && config.litellm && config.litellm.selectedReasoningModel) || "deepseek-v4-flash";
  const baseURL = (config && config.litellm && config.litellm.baseURL) || "http://127.0.0.1:5000/v1";
  
  const planPrompt = ((config && config.litellm && config.litellm.hybridPlanPrompt) || DEFAULT_PLAN_PROMPT) + userPrompt;
  
  try {
    const openai = new OpenAI({ baseURL, apiKey });
    const planCompletion = await openai.chat.completions.create({
      model: reasoningModel,
      messages: [{ role: "user", content: planPrompt }]
    });
    
    const rawPlan = planCompletion.choices[0].message.content;
    return stripTuiChars(rawPlan);
  } catch (err) {
    console.error("[Plan Generator] Plan generation failed:", err.message);
    return null;
  }
}

module.exports = { generatePlan, DEFAULT_PLAN_PROMPT };
