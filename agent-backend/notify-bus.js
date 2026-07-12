// agent-backend/notify-bus.js
//
// One notification bus, N typed sinks. Every alert flows through notify(event);
// each event names the sinks it wants. This replaces the old design where a
// single broadcastNotification() blindly fanned every alert to BOTH the web
// dashboard AND Telegram — which meant channel chatter polluted the in-app bell
// and vice-versa.
//
// Sinks are tagged by origin so callers (and the notify tool) choose where an
// alert lands:
//   - "web"      → dashboard NotificationCenter/toasts (WS type:"notification")
//   - "desktop"  → host notify-send popup
//   - "channel"  → Telegram + Discord/Slack webhooks (things off the web app)
//
// A caller that omits sinks gets "web" only (the safe default for internal
// system events like a background run finishing). The agent-facing notify tool
// asks for channel/web explicitly.

function createNotifyBus({ log = console } = {}) {
  /** @type {Record<string, (event: object) => void>} */
  const sinks = {};

  function registerSink(name, fn) {
    if (typeof fn === "function") sinks[name] = fn;
  }

  /**
   * @param {object} event
   * @param {string} event.title
   * @param {string} [event.body]
   * @param {"info"|"warning"|"error"} [event.severity]
   * @param {string[]} [event.sinks]   which sinks to hit; defaults to ["web"]
   * @param {string} [event.source]    free-form origin tag (e.g. "agent", "channel")
   */
  function notify(event = {}) {
    const {
      title = "Orbit",
      body = "",
      severity = "info",
      sinks: targets = ["web"],
      source,
    } = event;

    const chosen = (Array.isArray(targets) && targets.length ? targets : ["web"]);
    const normalized = { title, body, severity, source, timestamp: new Date().toISOString() };

    log.log?.(`[Notify→${chosen.join(",")}] ${severity}: ${title}${body ? ` — ${body}` : ""}`);

    for (const name of chosen) {
      const sink = sinks[name];
      if (!sink) {
        log.warn?.(`[Notify] no sink registered for "${name}" — dropped`);
        continue;
      }
      try {
        sink(normalized);
      } catch (e) {
        log.error?.(`[Notify] sink "${name}" failed: ${e.message}`);
      }
    }
    return { delivered: chosen.filter((n) => sinks[n]) };
  }

  return { registerSink, notify, sinks };
}

module.exports = createNotifyBus;
