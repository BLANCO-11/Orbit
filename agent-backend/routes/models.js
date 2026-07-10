// agent-backend/routes/models.js
// GET /api/models, POST /api/tts, GET /api/voices

const { Router } = require("express");
const { OpenAI } = require("openai");
const { Readable } = require("stream");

// Local pocket-tts provider — single source of truth (was duplicated across
// the TTS and voices routes).
const TTS_BASE_URL = process.env.LOCAL_TTS_URL || "http://127.0.0.1:6767";
const TTS_MODEL = process.env.LOCAL_TTS_MODEL || "pocket-tts";

function createModelsRouter(getConfig) {
  const router = Router();
  
  router.get("/", async (req, res, next) => {
    try {
      const config = getConfig();
      const openai = new OpenAI({
        baseURL: config.litellm.baseURL,
        apiKey: config.litellm.apiKey,
      });
      const modelsResponse = await openai.models.list();
      res.json(modelsResponse.data || []);
    } catch (error) {
      next(error);
    }
  });
  
  return router;
}

function createTtsRouter(getConfig) {
  const router = Router();
  
  router.post("/", async (req, res, next) => {
    const { text, voice } = req.body;
    if (!text) {
      return res.status(400).json({ success: false, message: "Text is required." });
    }

    const ttsKey = process.env.LOCAL_TTS_KEY;
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

function createVoicesRouter() {
  const router = Router();
  
  router.get("/", async (req, res, next) => {
    const ttsKey = process.env.LOCAL_TTS_KEY;
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
