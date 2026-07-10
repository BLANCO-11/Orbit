// agent-backend/services/plan-generator.js
// Hybrid plan generation via reasoning model

const { OpenAI } = require("openai");
const { stripTuiChars } = require("../harnesses/picode/parser");

const DEFAULT_PLAN_PROMPT = `You are a reasoning and planning assistant.
Given the following user request, generate a detailed step-by-step plan to achieve it.
You MUST format the output to look like a retro TUI (Terminal User Interface) console dashboard.
Use box-drawing characters (e.g. ┌, ─, ┐, │, ├, ┤, └) to frame the sections nicely, and include retro status badges like [WAITING], [TODO], [RUNNING], etc.
Make it fit for display in a monospace terminal box.
Do not use tools.
User request: `;

async function generatePlan(userPrompt, getConfig) {
  const config = getConfig();
  const apiKey = process.env.LITELLM_KEY;
  
  if (!apiKey) {
    console.error("[Plan Generator] LITELLM_KEY not set; skipping plan generation.");
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
