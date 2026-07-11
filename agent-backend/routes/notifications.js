// agent-backend/routes/notifications.js
// POST /api/notify — desktop + Discord + Slack + WebSocket broadcast

const { Router } = require("express");
const { exec } = require("child_process");
const WebSocket = require("ws");

function createNotificationsRouter(getConfig, wss) {
  const router = Router();
  
  router.post("/", (req, res, next) => {
    try {
      const { title, message, severity } = req.body;
      const config = getConfig();
      
      console.log(`[Notification API] [${(severity || "info").toUpperCase()}] ${title}: ${message}`);
      
      // 1. Desktop Notification via notify-send
      const escapedTitle = (title || "Orbit Alert").replace(/"/g, '\\"');
      const escapedMsg = (message || "").replace(/"/g, '\\"');
      const urgency = severity === "error" ? "critical" : severity === "warning" ? "normal" : "low";
      
      exec(`notify-send -u ${urgency} "${escapedTitle}" "${escapedMsg}"`, (err) => {
        if (err) console.error("Desktop notify-send failed:", err.message);
      });

      // 2. Discord Webhook
      if (config && config.notifications && config.notifications.discordWebhook) {
        fetch(config.notifications.discordWebhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: `**[${(severity || "info").toUpperCase()}] ${escapedTitle}**\n${escapedMsg}`
          })
        }).catch(e => console.error("Discord webhook delivery failed:", e.message));
      }

      // 3. Slack Webhook
      if (config && config.notifications && config.notifications.slackWebhook) {
        fetch(config.notifications.slackWebhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `*[${(severity || "info").toUpperCase()}] ${escapedTitle}*\n${escapedMsg}`
          })
        }).catch(e => console.error("Slack webhook delivery failed:", e.message));
      }

      // 4. Broadcast to all WebSocket clients
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            type: "log",
            content: `[Proactive Notify] [${(severity || "info").toUpperCase()}]: ${title} - ${message}`,
            isSystem: true
          }));
        }
      });

      res.json({ success: true, message: "Notification dispatched successfully" });
    } catch (err) {
      next(err);
    }
  });
  
  return router;
}

module.exports = createNotificationsRouter;
