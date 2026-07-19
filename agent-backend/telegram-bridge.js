// agent-backend/telegram-bridge.js
//
// Two-way Telegram integration, driven by the bot token stored under the
// "telegram" connection (Services → connect by login).
//
//  Inbound  — long-polls getUpdates; an AUTHORIZED chat's message runs the agent
//             and the reply is sent back. Unknown chats are refused and must
//             pair first: they send `/pair <code>`, where <code> is shown only
//             in the Orbit console (GET /api/telegram/status). This is the
//             security gate — a public bot means anyone can find it, so nobody
//             drives your agent until you authorize their chat.
//  Outbound — notify() pushes a message to every authorized chat; wired to the
//             app's notification bus so task-done / build-failed alerts (and
//             anything via ./orbit-notify) also reach Telegram.
//
// The token is read fresh each poll cycle, so setting/clearing it in the UI is
// picked up without a restart. Authorized chats + pairing code + poll offset
// live in the connection's `meta`, so they survive restarts.

const API = "https://api.telegram.org";

function createTelegramBridge({ db, decrypt, dispatch, log = console }) {
  let running = false;
  let stopped = false;
  let botUsername = null;
  let lastTokenSig = null;

  // ── connection meta (authorized chats, pairing code, offset) ──
  // The db layer is async, so all of these are async too.
  async function meta() {
    const c = await db.getConnection("telegram");
    return c ? { conn: c, meta: c.meta || {} } : null;
  }
  async function saveMeta(patch) {
    const cur = await db.getConnection("telegram");
    if (!cur) return;
    await db.saveConnection({ ...cur, meta: { ...(cur.meta || {}), ...patch } });
  }
  async function token() {
    const m = await meta();
    if (!m || !m.conn.accessTokenEnc) return null;
    try { return decrypt(m.conn.accessTokenEnc); } catch { return null; }
  }
  // A 6-digit code the operator reads from the console to authorize a chat.
  async function pairingCode() {
    const m = await meta();
    if (!m) return null;
    if (m.meta.pairingCode) return m.meta.pairingCode;
    // Derive deterministically from the secret-encrypted token so it's stable
    // without needing Math.random (kept out of this codebase). Persist it.
    const enc = m.conn.accessTokenEnc || "";
    let h = 0;
    for (let i = 0; i < enc.length; i++) h = (h * 31 + enc.charCodeAt(i)) % 1000000;
    const code = String(h).padStart(6, "0");
    await saveMeta({ pairingCode: code });
    return code;
  }
  async function allowedChats() {
    const m = await meta();
    return new Set((m?.meta.allowedChats || []).map(String));
  }
  async function authorize(chatId) {
    const set = await allowedChats();
    set.add(String(chatId));
    await saveMeta({ allowedChats: [...set] });
  }

  // ── Telegram API ──
  async function tg(method, body) {
    const t = await token();
    if (!t) throw new Error("no telegram token");
    const res = await fetch(`${API}/bot${t}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) throw new Error(data.description || `telegram ${method} failed`);
    return data.result;
  }

  async function sendMessage(chatId, text) {
    // Telegram caps messages at 4096 chars.
    const body = (text || "").slice(0, 4000) || "(empty)";
    try { await tg("sendMessage", { chat_id: chatId, text: body }); }
    catch (e) { log.error?.(`[Telegram] send failed: ${e.message}`); }
  }

  // Push to every authorized chat (outbound alerts).
  async function notify(text) {
    if (!(await token())) return;
    for (const chatId of await allowedChats()) await sendMessage(chatId, text);
  }

  // ── inbound message handling (pure-ish: pass sink for testing) ──
  async function handleUpdate(update, sink = { send: sendMessage, run: dispatch }) {
    const msg = update.message || update.edited_message;
    if (!msg || !msg.text) return;
    const chatId = msg.chat.id;
    const text = msg.text.trim();

    if (!(await allowedChats()).has(String(chatId))) {
      if (text.startsWith("/pair")) {
        const given = text.split(/\s+/)[1];
        if (given && given === (await pairingCode())) {
          await authorize(chatId);
          await sink.send(chatId, "✅ Paired. You can now chat with Orbit from here.");
        } else {
          await sink.send(chatId, "❌ Wrong or missing code. Open the Orbit console to get your pairing code, then send: /pair <code>");
        }
      } else {
        await sink.send(chatId, "🔒 This chat isn't authorized to drive Orbit. Send /pair <code> — the code is shown in the Orbit console.");
      }
      return;
    }

    // Authorized.
    if (text === "/start") { await sink.send(chatId, "Orbit is connected. Send me anything and I'll run it."); return; }
    // Run the agent in the conservative default (chat) mode; the policy matrix
    // still governs every tool. Reply with the final answer.
    try {
      const { output, status } = await sink.run({ device: "local", prompt: text, mode: "chat", source: "telegram", titlePrefix: "📱" });
      await sink.send(chatId, output || `(no output · ${status || "done"})`);
    } catch (e) {
      await sink.send(chatId, `⚠️ Orbit couldn't run that: ${e.message}`);
    }
  }

  // ── long-poll loop ──
  // Always running; idles when there's no token and re-validates whenever the
  // token first appears or changes, so setting it in the UI is picked up with
  // no restart.
  async function pollLoop() {
    let offset = Number((await meta())?.meta.pollOffset || 0) || 0;
    while (!stopped) {
      const t = await token();
      if (!t) { botUsername = null; lastTokenSig = null; await sleep(4000); continue; }
      if (t !== lastTokenSig) {
        try {
          await getMe();
          lastTokenSig = t;
          const pc = await pairingCode();
          log.log?.(`[Telegram] bridge online as @${botUsername}. Pairing code: ${pc} — send "/pair ${pc}" from your Telegram to authorize.`);
        } catch (e) {
          log.error?.(`[Telegram] token invalid or unreachable: ${e.message}`);
          await sleep(5000);
          continue;
        }
      }
      try {
        const updates = await tg("getUpdates", { offset, timeout: 30 });
        for (const u of updates) {
          offset = u.update_id + 1;
          try { await handleUpdate(u); } catch (e) { log.error?.(`[Telegram] handle failed: ${e.message}`); }
        }
        if (updates.length) await saveMeta({ pollOffset: offset });
      } catch (e) {
        log.error?.(`[Telegram] poll error: ${e.message}`);
        await sleep(5000); // back off on transient/network errors
      }
    }
    running = false;
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  // Validate the token (read-only) and return the bot's @username.
  async function getMe() {
    const me = await tg("getMe", {});
    botUsername = me.username;
    return me;
  }

  async function start() {
    if (running) return;
    if (process.env.TELEGRAM_DISABLE === "1") { log.log?.("[Telegram] bridge disabled via TELEGRAM_DISABLE=1."); return; }
    stopped = false;
    running = true;
    if (!(await token())) log.log?.("[Telegram] no bot token set yet — bridge idle, will pick up when you add one.");
    pollLoop();
  }

  function stop() { stopped = true; }

  async function status() {
    const m = await meta();
    return {
      configured: Boolean(await token()),
      running,
      botUsername,
      pairingCode: m ? await pairingCode() : null,
      allowedChats: [...(await allowedChats())],
    };
  }

  return { start, stop, status, notify, handleUpdate, getMe, sendMessage };
}

module.exports = createTelegramBridge;
