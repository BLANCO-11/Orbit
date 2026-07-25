// agent-backend/services/tts.js
// TTS summary generation via the configured LLM.

async function generateIntelligentSpeech(query, responseText, getConfig) {
  try {
    const config = getConfig();
    // getConfig() resolves env → config once (config.getResolvedConfig); this
    // used to re-implement the env fallback chain here, and drifted.
    const llm = (config && config.llm) || {};
    const apiKey = llm.apiKey;
    if (!apiKey) {
      console.error("[Intelligent TTS] No LLM API key configured; skipping summary generation.");
      return null;
    }
    // No hardcoded baseURL or model. Both were provider guesses — a dead
    // 127.0.0.1:5000 address and "litellm/deepseek-v4-flash", which 401s on any
    // gateway that doesn't serve it. Missing config now says so.
    const baseURL = llm.baseUrl;
    const model = llm.fastModel;
    if (!baseURL || !model) {
      console.error("[Intelligent TTS] No LLM endpoint/model configured; skipping summary generation.");
      return null;
    }

    console.log(`[Intelligent TTS] Requesting summary from ${model}...`);

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
      throw new Error(`LLM upstream returned status ${response.status}`);
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
