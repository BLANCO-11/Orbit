// agent-backend/harnesses/picode/orbit-provider.mjs
//
// pi provider extension (loaded per-spawn via `pi -e <this file>`). Registers a
// single NATIVE, OpenAI-compatible provider named "orbit" — no bespoke
// `pi-provider-litellm` extension required. pi speaks plain `/v1` HTTP to
// whatever `ORBIT_LLM_BASE_URL` points at:
//
//   • local (app-owned) pi → the app's internal LLM gateway
//     (http://127.0.0.1:<PORT>/llm/v1), authenticated with an app-local key.
//     The real upstream key stays in the app; the child only ever sees the
//     gateway key.
//   • remote (orbit-adapter) pi → the remote's OWN OpenAI-compatible upstream,
//     using that machine's own credentials (bring-your-own-LLM).
//
// Env read from the child process (set by PiCodeHarness.connect):
//   ORBIT_LLM_BASE_URL  — the /v1 base URL to talk to
//   ORBIT_LLM_KEY       — bearer key (gateway key locally; upstream key remotely)
//   ORBIT_LLM_MODEL     — the model id the app selected (always registered)
//
// Model METADATA: a standalone `-e` extension can't import pi's built-in model
// catalog (`@earendil-works/pi-ai` doesn't resolve outside pi's own tree), so we
// classify each model id with self-contained heuristics — reasoning capability,
// context window, modality — mirroring what the old litellm extension derived
// from the catalog. This runs identically for LOCAL and REMOTE pi, so effort/
// thinking behaviour is wired the same way on paired remote harnesses. The
// `compat` shape ({ supportsStore:false }, Anthropic cache markers for Claude
// routes) matches the proven-working config for LiteLLM-style gateways. If a
// /v1/models entry ever carries an `orbit` metadata block, we prefer it.

// Heuristic model classifier. Conservative on purpose: reasoning:true only for
// families that actually support extended thinking, so a first `hello` never
// fails from a bad reasoning param on a non-reasoning model.
function classify(id) {
  const s = String(id).toLowerCase();
  const claude = /claude|opus|sonnet|haiku/.test(s);
  const reasoning =
    /gpt-5/.test(s) ||
    /(^|[-/])o[1-4]($|[-])/.test(s) ||
    /reasoner|thinking|deepseek-r|(^|[-/])r1($|[-])/.test(s) ||
    /gemma-[4-9]/.test(s) ||
    claude ||
    /gemini-(?:2\.[5-9]|[3-9])/.test(s) ||
    /magistral|grok-[3-9]|qwq/.test(s);
  const multimodal =
    /gpt-4o|gpt-5|gemma-[4-9]|gemini|vision|vl(?:$|[-/])|llava|pixtral/.test(s) || claude;
  let contextWindow = 128000;
  if (/gpt-5/.test(s)) contextWindow = 400000;
  else if (/gemma-[4-9]|gemini/.test(s)) contextWindow = 262144;
  else if (claude) contextWindow = 200000;
  let maxTokens = reasoning ? 32768 : 16384;
  if (/gpt-5/.test(s)) maxTokens = 128000;
  const compat = { supportsStore: false };
  if (claude) compat.cacheControlFormat = "anthropic";
  return {
    reasoning,
    input: multimodal ? ["text", "image"] : ["text"],
    contextWindow,
    maxTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat,
  };
}

export default async function (pi) {
  const baseUrl = process.env.ORBIT_LLM_BASE_URL;
  const configuredModel = process.env.ORBIT_LLM_MODEL;
  if (!baseUrl) return; // nothing configured — pi starts with no orbit models

  // id → raw /v1/models entry (may be undefined for the configured model if
  // discovery fails). We always keep the configured model so `--model
  // orbit/<model>` resolves even when the upstream is slow/unreachable at spawn.
  const entries = new Map();
  if (configuredModel) entries.set(configuredModel, null);

  try {
    const res = await fetch(baseUrl.replace(/\/+$/, "") + "/models", {
      headers: process.env.ORBIT_LLM_KEY ? { authorization: "Bearer " + process.env.ORBIT_LLM_KEY } : {},
    });
    if (res.ok) {
      const payload = await res.json();
      for (const m of (payload.data || payload.models || [])) {
        const id = typeof m === "string" ? m : m && m.id;
        if (id) entries.set(id, typeof m === "object" ? m : null);
      }
    }
  } catch { /* keep just the configured model */ }

  if (!entries.size) return;

  const models = [...entries.entries()].map(([id, raw]) => {
    const meta = raw && raw.orbit ? raw.orbit : classify(id);
    return {
      id,
      name: (raw && raw.name) || id,
      reasoning: !!meta.reasoning,
      input: meta.input || ["text"],
      cost: meta.cost || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: meta.contextWindow || 128000,
      maxTokens: meta.maxTokens || 16384,
      ...(meta.thinkingLevelMap ? { thinkingLevelMap: meta.thinkingLevelMap } : {}),
      compat: meta.compat || { supportsStore: false },
    };
  });

  pi.registerProvider("orbit", {
    name: "Orbit",
    baseUrl,
    apiKey: "$ORBIT_LLM_KEY",
    api: "openai-completions",
    authHeader: true,
    models,
  });
}
