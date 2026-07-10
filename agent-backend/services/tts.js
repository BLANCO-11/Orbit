// agent-backend/services/tts.js
// TTS summary generation via LiteLLM

async function generateIntelligentSpeech(query, responseText, getConfig) {
  try {
    const apiKey = process.env.LITELLM_KEY;
    if (!apiKey) {
      console.error("[Intelligent TTS] LITELLM_KEY not set; skipping summary generation.");
      return null;
    }
    const config = getConfig();
    const baseURL = (config && config.litellm && config.litellm.baseURL) || "http://127.0.0.1:5000/v1";
    const model = (config && config.litellm && config.litellm.selectedNormalModel) || "litellm/deepseek-v4-flash";

    console.log(`[Intelligent TTS] Requesting summary from LiteLLM: ${model}...`);
    
    const response = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: "system",
            content: "You are a concise voice assistant. Summarize what the agent completed in one simple, natural sentence to answer the user's query. Avoid any markdown formatting, bullet points, headers, or code blocks. Speak directly and conversationally."
          },
          {
            role: "user",
            content: `User query: "${query}"\n\nAgent response:\n${responseText}`
          }
        ],
        max_tokens: 80,
        temperature: 0.3
      })
    });

    if (!response.ok) {
      throw new Error(`LiteLLM returned status ${response.status}`);
    }

    const data = await response.json();
    const summary = data.choices[0].message.content.trim();
    console.log(`[Intelligent TTS] Generated summary: "${summary}"`);
    return summary;
  } catch (err) {
    console.error("[Intelligent TTS] Summary generation failed:", err.message);
    return null;
  }
}

module.exports = { generateIntelligentSpeech };
