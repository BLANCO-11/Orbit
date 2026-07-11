// agent-backend/ws/headless-socket.js
// A WebSocket-shaped sink that lets a session run with no dashboard attached
// (e.g. triggered by an event channel). It looks enough like a `ws` for
// handleStartTask + the harness event emitter to drive it unchanged: it has
// `readyState`, `send()`, and accepts the ad-hoc properties they set
// (activeSessionId, currentPrompt, device).
//
// Instead of streaming to a browser, it reconstructs the session transcript
// from the outgoing messages (mirroring the frontend reducer) and persists it
// to the session store on completion, so a headless run shows up in the
// session list and replays in the timeline like any human-driven session.

class HeadlessSocket {
  constructor(sessionId, db, { title, source, onDone, notify } = {}) {
    this.readyState = 1; // OPEN — the helpers gate on this
    this.device = null;
    this.activeSessionId = sessionId;
    this._sessionId = sessionId;
    this._db = db;
    this._title = title || "Channel run";
    this._source = source || "channel";
    this._onDone = onDone;
    this._notify = notify;
    this._messages = [];
    this._assistant = null;
    this._logs = [];
    this._executionPlan = "";
    this._done = false;
  }

  addUserMessage(text) {
    this._messages.push({ role: "user", content: text });
  }

  _ensureAssistant() {
    const last = this._messages[this._messages.length - 1];
    if (last && last.role === "assistant") { this._assistant = last; return; }
    this._assistant = { role: "assistant", content: "" };
    this._messages.push(this._assistant);
  }

  send(str) {
    let d;
    try { d = JSON.parse(str); } catch { return; }
    switch (d.type) {
      case "message":
        if (d.role === "assistant") { this._ensureAssistant(); this._assistant.content = d.content || ""; }
        break;
      case "tool_start":
        this._ensureAssistant();
        (this._assistant.tools ||= []).push({ id: d.toolCallId, name: d.name, arguments: d.arguments || {}, status: "running" });
        break;
      case "tool_end": {
        const t = this._assistant?.tools?.find((x) => x.id === d.toolCallId);
        if (t) { t.result = d.result; t.status = "done"; t.latencyMs = d.latencyMs; }
        break;
      }
      case "plan":
      case "reasoning_update":
        this._executionPlan = d.content || this._executionPlan;
        break;
      case "log":
        this._logs.push({ text: d.content, isSystem: d.isSystem, timestamp: new Date().toISOString() });
        break;
      case "status":
        if ((d.status === "done" || d.status === "error") && !this._done) this._persist(d.status);
        break;
    }
  }

  _persist(status) {
    this._done = true;
    try {
      const existing = this._db.getSession(this._sessionId) || {};
      this._db.saveSession({
        ...existing,
        id: this._sessionId,
        title: this._title,
        messages: this._messages,
        logs: this._logs,
        executionPlan: this._executionPlan,
        mode: existing.mode || "",
        timestamp: Date.now(),
      });
    } catch (e) {
      console.error(`[Headless] persist failed for ${this._sessionId}:`, e.message);
    }
    const summary = (this._assistant?.content || "").replace(/<tts>[\s\S]*?<\/tts>/gi, "").trim().slice(0, 240);
    if (this._notify) {
      try { this._notify({ title: `Channel: ${this._title}`, body: summary || `Run ${status}`, severity: status === "error" ? "error" : "info" }); } catch {}
    }
    if (this._onDone) { try { this._onDone(status, this._sessionId); } catch {} }
  }
}

module.exports = HeadlessSocket;
