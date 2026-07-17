// agent-backend/llm-gateway.js
//
// Internal OpenAI-compatible LLM gateway for LOCAL, app-spawned agents (pi,
// OpenCode). One place the app owns the upstream LLM:
//   • the REAL upstream key never enters a harness child process — the child
//     only ever holds an app-local gateway key (see picode/index.js childEnv);
//   • a single outbound hop to the upstream, so only the app needs upstream
//     reachability (fixes "chat doesn't work in Docker" for the network case);
//   • one config point for baseURL/model, and a hook for authoritative,
//     tenant-level token metering (per-session metering stays on the harness
//     `usage` event path, which already reports real provider usage).
//
// Local harnesses point at http://127.0.0.1:<PORT>/llm/v1 with the app-local
// key. Remote (paired) harnesses do NOT use this — they bring their own LLM.
//
// This is a thin pass-through, not a router: v1 has no multi-provider
// failover/aliasing (a documented non-goal). It forwards to the single
// configured OpenAI-compatible upstream (getConfig().litellm.baseURL + apiKey),
// streams SSE transparently, and serves /v1/models.

const { Router } = require("express");

/**
 * @param {object} deps
 * @param {() => object} deps.getConfig        — resolves { litellm: { baseURL, apiKey } }
 * @param {string}       deps.gatewayKey        — app-local bearer key the child must present
 * @param {(u: {sessionId?: string|null, tenantId?: string|null, model?: string, usage: object}) => void} [deps.onUsage]
 *        — called with real provider usage once a response completes; wire to
 *          per-tenant accounting. Optional, non-fatal.
 */
function createLlmGateway({ getConfig, gatewayKey, onUsage } = {}) {
  const router = Router();

  function upstream() {
    let baseURL = "";
    let apiKey = "";
    try {
      const l = (getConfig && getConfig().litellm) || {};
      baseURL = (l.baseURL || "").replace(/\/+$/, "");
      apiKey = l.apiKey || "";
    } catch {}
    return { baseURL, apiKey };
  }

  // App-local auth. The gateway is bound to loopback with the backend, but we
  // still require the key so a compromised child can't be trivially impersonated
  // and so the contract ("child holds only the gateway key") is enforced.
  router.use((req, res, next) => {
    if (!gatewayKey) return next(); // no key configured → open (dev only)
    const hdr = req.get("authorization") || "";
    const bearer = hdr.replace(/^Bearer\s+/i, "").trim();
    const alt = req.get("x-api-key") || "";
    if (bearer === gatewayKey || alt === gatewayKey) return next();
    return res.status(401).json({ error: { message: "invalid gateway key", type: "invalid_request_error" } });
  });

  // GET /llm/v1/models — proxy the upstream model list (pi's provider extension
  // discovers models here; also handy for the UI/model picker).
  router.get("/models", async (req, res) => {
    const { baseURL, apiKey } = upstream();
    if (!baseURL) return res.status(502).json({ error: { message: "no LLM upstream configured", type: "server_error" } });
    try {
      const r = await fetch(`${baseURL}/models`, {
        headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      });
      const text = await r.text();
      res.status(r.status).type(r.headers.get("content-type") || "application/json").send(text);
    } catch (e) {
      res.status(502).json({ error: { message: `upstream unreachable: ${e.message}`, type: "server_error" } });
    }
  });

  // POST /llm/v1/chat/completions — the main path. Streams SSE through
  // transparently; sniffs the terminal `usage` for metering.
  router.post("/chat/completions", (req, res) => forward(req, res, "/chat/completions"));
  // Legacy completions + embeddings: transparent passthrough (no usage sniff
  // needed for chat metering, but keep the surface complete).
  router.post("/completions", (req, res) => forward(req, res, "/completions"));
  router.post("/embeddings", (req, res) => forward(req, res, "/embeddings"));

  async function forward(req, res, upstreamPath) {
    const { baseURL, apiKey } = upstream();
    if (!baseURL || !apiKey) {
      return res.status(502).json({
        error: { message: "no LLM upstream configured (set an endpoint + key in .env or Settings)", type: "server_error" },
      });
    }
    const sessionId = req.get("x-orbit-session") || null;
    const tenantId = req.get("x-orbit-tenant") || null;

    const body = (req.body && typeof req.body === "object") ? { ...req.body } : {};
    const streaming = body.stream === true;
    // Ask the upstream to include usage in the final stream chunk so we can meter
    // real tokens even on streamed responses.
    if (streaming) body.stream_options = { include_usage: true, ...(body.stream_options || {}) };

    let upstreamRes;
    try {
      upstreamRes = await fetch(`${baseURL}${upstreamPath}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      });
    } catch (e) {
      return res.status(502).json({ error: { message: `upstream unreachable: ${e.message}`, type: "server_error" } });
    }

    res.status(upstreamRes.status);
    const ct = upstreamRes.headers.get("content-type");
    if (ct) res.type(ct);

    if (!upstreamRes.body) {
      const text = await upstreamRes.text().catch(() => "");
      // Non-stream: try to meter usage from the parsed body.
      try { meter(JSON.parse(text), { sessionId, tenantId, model: body.model }); } catch {}
      return res.send(text);
    }

    // Passthrough: forward every byte as it arrives, buffering only enough text
    // to pull the terminal usage object out of the SSE tail (or the whole JSON
    // for a non-streamed response).
    let tail = "";
    const decoder = new TextDecoder();
    try {
      for await (const chunk of upstreamRes.body) {
        res.write(Buffer.from(chunk));
        if (onUsage) {
          tail += decoder.decode(chunk, { stream: true });
          if (tail.length > 65536) tail = tail.slice(-65536); // cap the buffer
        }
      }
    } catch (e) {
      // Client or upstream dropped mid-stream — end gracefully.
    } finally {
      res.end();
    }

    if (onUsage && tail) {
      try {
        if (streaming) {
          // Scan SSE `data:` events for the last one carrying `usage`.
          const events = tail.split(/\n\n/).map((b) => b.trim()).filter(Boolean);
          for (let i = events.length - 1; i >= 0; i--) {
            const line = events[i].split("\n").find((l) => l.startsWith("data:"));
            if (!line) continue;
            const payload = line.slice(5).trim();
            if (payload === "[DONE]") continue;
            try {
              const obj = JSON.parse(payload);
              if (obj && obj.usage) { meter(obj, { sessionId, tenantId, model: body.model }); break; }
            } catch {}
          }
        } else {
          meter(JSON.parse(tail), { sessionId, tenantId, model: body.model });
        }
      } catch {}
    }
  }

  // Normalize OpenAI usage → the app's usage shape and hand off to onUsage.
  function meter(obj, { sessionId, tenantId, model }) {
    const u = obj && obj.usage;
    if (!u || !onUsage) return;
    const usage = {
      input: u.prompt_tokens ?? u.input_tokens ?? 0,
      output: u.completion_tokens ?? u.output_tokens ?? 0,
      reasoning: u.completion_tokens_details?.reasoning_tokens ?? 0,
      cacheRead: u.prompt_tokens_details?.cached_tokens ?? 0,
    };
    if (!usage.input && !usage.output && !usage.reasoning) return;
    try { onUsage({ sessionId, tenantId, model: obj.model || model, usage }); } catch {}
  }

  return router;
}

module.exports = createLlmGateway;
