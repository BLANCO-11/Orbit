// agent-backend/routes/notifications.js
// POST /api/notify — the one HTTP entrypoint for raising an alert. It validates
// the payload and hands it to the notification bus, which fans it out to the
// chosen sinks (web / desktop / channel). All sink logic (desktop notify-send,
// Discord/Slack webhooks, Telegram, WS broadcast) lives in the bus + server.js
// sink registrations — this route no longer talks to any transport directly.
//
// This is also the route the `orbit-notify` MCP tool calls, so the agent raises
// alerts through a first-class network tool instead of shelling out to curl.

const { Router } = require("express");

function createNotificationsRouter(notifyBus) {
  const router = Router();

  router.post("/", (req, res, next) => {
    try {
      const { title, message, body, severity, sinks } = req.body || {};
      // Accept either `message` (legacy shell util / webhook callers) or `body`.
      const result = notifyBus.notify({
        title: title || "Orbit Alert",
        body: body || message || "",
        severity: severity || "info",
        sinks: Array.isArray(sinks) && sinks.length ? sinks : undefined,
        source: "api",
      });
      res.json({ success: true, delivered: result.delivered });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = createNotificationsRouter;
