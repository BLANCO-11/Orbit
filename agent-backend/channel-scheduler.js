// agent-backend/channel-scheduler.js
// Fires schedule-type event channels locally — no inbound exposure needed,
// which is the local-first-friendly way to run recurring agent work. Checks
// every minute: interval channels run every N minutes since last trigger;
// daily channels run once when the wall clock reaches HH:MM.

function startScheduler({ db, runProfileHeadless }) {
  const firedToday = new Set(); // `${channelId}@${YYYY-MM-DD} ${HH:MM}` guard for daily

  const tick = async () => {
    let channels;
    try { channels = db.listChannels(); } catch { return; }
    const now = Date.now();
    const d = new Date();
    const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    const dayKey = d.toISOString().slice(0, 10);

    for (const ch of channels) {
      if (ch.type !== "schedule" || !ch.enabled) continue;
      let due = false;
      if (ch.intervalMinutes) {
        const last = ch.lastTriggered || 0;
        if (now - last >= ch.intervalMinutes * 60_000) due = true;
      }
      if (ch.dailyAt && ch.dailyAt === hhmm) {
        const guard = `${ch.id}@${dayKey} ${hhmm}`;
        if (!firedToday.has(guard)) { firedToday.add(guard); due = true; }
      }
      if (!due) continue;
      try {
        db.touchChannelTriggered(ch.id);
        const prompt = ch.promptTemplate || "Run the scheduled task.";
        await runProfileHeadless({ profileId: ch.profileId, prompt, title: ch.name, source: `channel:${ch.id}` });
        console.log(`[Scheduler] Fired channel "${ch.name}" (${ch.id}).`);
      } catch (e) {
        console.error(`[Scheduler] channel ${ch.id} failed:`, e.message);
      }
    }
    // Keep the daily guard from growing unbounded.
    if (firedToday.size > 500) firedToday.clear();
  };

  const timer = setInterval(tick, 60_000);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = { startScheduler };
