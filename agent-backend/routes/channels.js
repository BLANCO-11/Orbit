// agent-backend/routes/channels.js
// Event channels — inbound triggers that run a profile headlessly, then surface
// the run in the console's session list. Two trigger types:
//   - webhook:  POST /api/channels/:id/webhook (verified), prompt built from
//               a template over the event payload.
//   - schedule: fired by channel-scheduler.js (interval or daily time).
// This keeps the console local-first: schedules need no inbound exposure;
// webhooks are opt-in and only work if the console is reachable.
//
// GET/POST /api/channels, DELETE /api/channels/:id, POST /:id/webhook, POST /:id/test

const { Router } = require("express");
const crypto = require("crypto");

const VALID_TYPE = new Set(["webhook", "schedule"]);
const VALID_VERIFY = new Set(["none", "bearer", "github", "slack"]);

/** Render {{a.b.c}} placeholders in a template from the event payload. */
function renderTemplate(template, payload) {
  if (!template) return "";
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) => {
    const val = path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), payload);
    if (val == null) return "";
    return typeof val === "string" ? val : JSON.stringify(val);
  });
}

/** Verify a webhook request per the channel's scheme. Returns true if allowed. */
function verifyWebhook(channel, req) {
  const scheme = channel.verify || "none";
  const secret = channel.secret || "";
  if (scheme === "none") return true;
  if (scheme === "bearer") {
    const provided = (req.headers["authorization"] || "").replace(/^Bearer\s+/i, "");
    return Boolean(secret) && provided === secret;
  }
  const raw = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
  if (scheme === "github") {
    const sig = req.headers["x-hub-signature-256"] || "";
    const expected = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
    try { return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); }
    catch { return false; }
  }
  if (scheme === "slack") {
    const ts = req.headers["x-slack-request-timestamp"] || "";
    const sig = req.headers["x-slack-signature"] || "";
    if (!ts || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false; // replay window
    const base = `v0:${ts}:${raw.toString("utf8")}`;
    const expected = "v0=" + crypto.createHmac("sha256", secret).update(base).digest("hex");
    try { return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); }
    catch { return false; }
  }
  return false;
}

function sanitize(body) {
  const c = {};
  if (body.id) c.id = String(body.id);
  c.name = String(body.name || "Untitled channel").slice(0, 80);
  c.type = VALID_TYPE.has(body.type) ? body.type : "schedule";
  c.profileId = body.profileId ? String(body.profileId) : null;
  c.promptTemplate = String(body.promptTemplate || "").slice(0, 4000);
  c.enabled = body.enabled !== false;
  // webhook
  c.verify = VALID_VERIFY.has(body.verify) ? body.verify : "none";
  c.secret = body.secret ? String(body.secret).slice(0, 200) : "";
  // schedule
  c.intervalMinutes = Number.isFinite(body.intervalMinutes) ? Math.max(1, Math.floor(body.intervalMinutes)) : null;
  c.dailyAt = /^\d{2}:\d{2}$/.test(body.dailyAt || "") ? body.dailyAt : null;
  return c;
}

function publicView(c, origin) {
  const { secret, ...rest } = c;
  return {
    ...rest,
    hasSecret: Boolean(secret),
    webhookUrl: c.type === "webhook" ? `${origin}/api/channels/${c.id}/webhook` : null,
  };
}

function createChannelsRouter({ db, runProfileHeadless, getOrigin }) {
  const router = Router();

  router.get("/", (_req, res) => {
    const origin = getOrigin();
    res.json({ success: true, channels: db.listChannels().map((c) => publicView(c, origin)) });
  });

  router.post("/", (req, res) => {
    try {
      const saved = db.saveChannel(sanitize(req.body || {}));
      const origin = getOrigin();
      res.json({ success: true, channel: publicView(saved, origin), channels: db.listChannels().map((c) => publicView(c, origin)) });
    } catch (e) {
      res.status(400).json({ success: false, error: e.message });
    }
  });

  router.delete("/:id", (req, res) => {
    db.deleteChannel(req.params.id);
    const origin = getOrigin();
    res.json({ success: true, channels: db.listChannels().map((c) => publicView(c, origin)) });
  });

  // Manual test-fire (authenticated via the same middleware as other routes).
  router.post("/:id/test", async (req, res) => {
    const channel = db.getChannel(req.params.id);
    if (!channel) return res.status(404).json({ success: false, error: "channel not found" });
    const prompt = renderTemplate(channel.promptTemplate, req.body?.payload || {}) || channel.promptTemplate || "Run.";
    const { sessionId } = await runProfileHeadless({ profileId: channel.profileId, prompt, title: `${channel.name} (test)`, source: `channel:${channel.id}` });
    db.touchChannelTriggered(channel.id);
    res.json({ success: true, sessionId });
  });

  // Public webhook receiver — NOT behind auth middleware (external senders).
  // Mounted separately in server.js so it can skip auth. Verified per-channel.
  router.post("/:id/webhook", async (req, res) => {
    const channel = db.getChannel(req.params.id);
    if (!channel || channel.type !== "webhook" || !channel.enabled) {
      return res.status(404).json({ success: false, error: "no such active webhook channel" });
    }
    if (!verifyWebhook(channel, req)) {
      return res.status(401).json({ success: false, error: "signature verification failed" });
    }
    const prompt = renderTemplate(channel.promptTemplate, req.body || {}) || "Handle the incoming event.";
    const { sessionId } = await runProfileHeadless({ profileId: channel.profileId, prompt, title: channel.name, source: `channel:${channel.id}` });
    db.touchChannelTriggered(channel.id);
    res.json({ success: true, sessionId });
  });

  return router;
}

module.exports = createChannelsRouter;
module.exports.renderTemplate = renderTemplate;
