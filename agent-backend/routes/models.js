// agent-backend/routes/models.js
// GET /api/models, POST /api/tts, GET /api/voices

const { Router } = require("express");
const { OpenAI } = require("openai");
const { Readable } = require("stream");

// Local pocket-tts provider — single source of truth (was duplicated across
// the TTS and voices routes).
const TTS_BASE_URL = process.env.LOCAL_TTS_URL || "http://127.0.0.1:6767";
const TTS_MODEL = process.env.LOCAL_TTS_MODEL || "pocket-tts";

// TTS is OPTIONAL: available only when a key is configured — via env
// (LOCAL_TTS_KEY) or in-app Settings (config.tts.apiKey). The voice UI is hidden
// entirely when this is empty.
function resolveTtsKey(getConfig) {
  try { return process.env.LOCAL_TTS_KEY || (getConfig && getConfig().tts && getConfig().tts.apiKey) || ""; }
  catch { return process.env.LOCAL_TTS_KEY || ""; }
}
function resolveTtsUrl(getConfig) {
  try { return process.env.LOCAL_TTS_URL || (getConfig && getConfig().tts && getConfig().tts.url) || TTS_BASE_URL; }
  catch { return TTS_BASE_URL; }
}

const DEFAULT_MODELS = [
  // OpenAI
  { id: "gpt-4o" },
  { id: "gpt-4o-mini" },
  { id: "o1-mini" },
  { id: "o1-preview" },
  // Anthropic / Claude
  { id: "claude-3-5-sonnet" },
  { id: "claude-3-5-haiku" },
  // DeepSeek
  { id: "deepseek-chat" },
  { id: "deepseek-reasoner" },
  // Google Gemini
  { id: "gemini-1.5-flash" },
  { id: "gemini-1.5-pro" },
  { id: "gemini-2.0-flash" }
];

function createModelsRouter(getConfig) {
  const router = Router();
  
  router.get("/", async (req, res, next) => {
    try {
      const config = getConfig();
      const baseURL = config?.litellm?.baseURL || process.env.LITELLM_BASE_URL || "";
      const apiKey = config?.litellm?.apiKey || process.env.LITELLM_KEY || process.env.OPENAI_API_KEY || "";

      let fetchedModels = [];
      if (baseURL) {
        try {
          const openai = new OpenAI({
            baseURL,
            apiKey: apiKey || "none", // openai package requires a non-empty key
          });
          const modelsResponse = await openai.models.list();
          if (modelsResponse && modelsResponse.data) {
            fetchedModels = modelsResponse.data;
          }
        } catch (err) {
          console.warn("[Models API] Could not fetch models from endpoint:", err.message);
        }
      }

      // Merge fetched models with default models, avoiding duplicates
      const seen = new Set();
      const merged = [];

      for (const m of fetchedModels) {
        if (m && m.id && !seen.has(m.id)) {
          seen.add(m.id);
          merged.push({ id: m.id });
        }
      }

      for (const m of DEFAULT_MODELS) {
        if (!seen.has(m.id)) {
          seen.add(m.id);
          merged.push(m);
        }
      }

      res.json(merged);
    } catch (error) {
      res.json(DEFAULT_MODELS);
    }
  });
  
  return router;
}

function createTtsRouter(getConfig) {
  const router = Router();

  // Availability probe — the dashboard hides all voice UI when this is false.
  router.get("/status", (req, res) => {
    res.json({ success: true, available: !!resolveTtsKey(getConfig) });
  });

  router.post("/", async (req, res, next) => {
    const { text, voice } = req.body;
    if (!text) {
      return res.status(400).json({ success: false, message: "Text is required." });
    }

    const ttsKey = resolveTtsKey(getConfig);
    if (!ttsKey) {
      return res.status(500).json({ success: false, message: "LOCAL_TTS_KEY not found in environment." });
    }

    try {
      const response = await fetch(`${TTS_BASE_URL}/v1/audio/speech`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${ttsKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: TTS_MODEL,
          input: text,
          voice: voice || "alba",
          response_format: "mp3"
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        return res.status(response.status).json({ success: false, message: `TTS service error: ${errText}` });
      }

      // Pipe the upstream audio stream straight through instead of buffering
      // the whole clip — the client starts receiving bytes as they generate,
      // shaving a full clip's worth of latency per sentence.
      res.setHeader("Content-Type", "audio/mpeg");
      if (response.body) {
        Readable.fromWeb(response.body).pipe(res);
      } else {
        const buffer = Buffer.from(await response.arrayBuffer());
        res.send(buffer);
      }
    } catch (error) {
      next(error);
    }
  });
  
  return router;
}

function createVoicesRouter(getConfig) {
  const router = Router();
  
  router.get("/", async (req, res, next) => {
    const ttsKey = resolveTtsKey(getConfig);
    if (!ttsKey) return res.json([]);

    try {
      const response = await fetch(`${TTS_BASE_URL}/v1/voices`, {
        method: "GET",
        headers: { "Authorization": `Bearer ${ttsKey}` }
      });

      if (!response.ok) return res.json([]);
      const data = await response.json();
      res.json(data.voices || []);
    } catch (error) {
      console.error("Failed to fetch voices from local TTS:", error.message);
      res.json([]);
    }
  });
  
  return router;
}

module.exports = { createModelsRouter, createTtsRouter, createVoicesRouter };
