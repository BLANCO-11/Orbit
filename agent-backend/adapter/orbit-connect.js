#!/usr/bin/env node
'use strict';
// orbit-connect.js — GENERIC, zero-dependency Orbit harness.
//
// Connect ANY machine to an Orbit runtime using whatever OpenAI-SDK-compatible
// model it already has — no pi, no extra agent, no `npm install`. It runs on a
// stock Node (18+; uses the built-in global `fetch` and `WebSocket`), so the
// whole thing is ONE self-contained file. The typical flow is literally:
//
//     curl -fsSL 'https://HOST/api/pair/bootstrap?code=ABC123' | node
//
// which serves this file with the pairing descriptor baked in. It pairs, then
// becomes a harness the Orbit console can drive — spawn/prompt/cancel come down
// the socket, and it streams back the SAME standardized events pi does, so the
// console can't tell it apart.
//
// The "brain" is the remote's OWN model (bring-your-own): set OPENAI_BASE_URL /
// OPENAI_API_KEY / OPENAI_MODEL (LLM_* also accepted). If the console sends LLM
// creds at spawn (e.g. a reachable Orbit gateway) and none are set locally,
// those are used as a fallback. The tools (read/write/edit/bash/ls) execute on
// THIS machine, in a per-session workspace, and are gated centrally by Orbit's
// policy engine exactly like pi's.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_RECONNECT = { backoffMs: [1000, 2000, 5000, 15000], maxJitterMs: 500 };
const DEFAULT_HEARTBEAT = { intervalMs: 30000 };
const MAX_TOOL_ITERATIONS = 30;   // per turn, anti-runaway
const MAX_TOOL_OUTPUT = 60000;    // chars returned to the model per tool call
const BASH_TIMEOUT_MS = 120000;

// Descriptor baked in by /api/pair/bootstrap (globalThis so a standalone run,
// where it's absent, doesn't ReferenceError).
const INJECTED = (typeof globalThis !== 'undefined' && globalThis.__ORBIT_DESCRIPTOR__) || null;

// ── args ──────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[key] = true;
    else { args[key] = next; i++; }
  }
  return args;
}

// ── credential persistence (map keyed by server host) ───────────────────────
function credentialsPath(args) {
  if (args.credentials) return args.credentials;
  const home = process.env.ORBIT_ADAPTER_HOME || path.join(os.homedir(), '.orbit');
  return path.join(home, 'adapter-credentials.json');
}
function loadStore(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; } }
function saveCredential(p, wsUrl, cred) {
  const store = loadStore(p);
  store[new URL(wsUrl).host] = { wsUrl, ...cred };
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(store, null, 2), { mode: 0o600 });
  try { fs.chmodSync(p, 0o600); } catch {}
}
function dropCredential(p, wsUrl) {
  const store = loadStore(p);
  try { delete store[new URL(wsUrl).host]; } catch {}
  try { fs.writeFileSync(p, JSON.stringify(store, null, 2), { mode: 0o600 }); } catch {}
}

// ── descriptor resolution (injected → connect URL → token → code → stored) ──
async function resolveDescriptor(args, credsPath, label) {
  if (INJECTED && INJECTED.wsUrl && INJECTED.token) {
    saveCredential(credsPath, INJECTED.wsUrl, {
      token: INJECTED.token, deviceId: INJECTED.device?.id, label: INJECTED.device?.label, scope: INJECTED.device?.scope,
    });
    return INJECTED;
  }
  const persist = args.persist !== false && args['no-persist'] !== true;
  if (typeof args.connect === 'string') {
    const res = await fetch(args.connect);
    if (!res.ok) throw new Error(`connect failed (HTTP ${res.status})`);
    const d = await res.json();
    if (persist) saveCredential(credsPath, d.wsUrl, { token: d.token, deviceId: d.device?.id, label: d.device?.label, scope: d.device?.scope });
    return d;
  }
  const server = typeof args.server === 'string' ? args.server : null;
  if (typeof args.token === 'string' && server) {
    const d = { protocolVersion: '1', wsUrl: `${server}/api/harness`, token: args.token, device: {}, heartbeat: DEFAULT_HEARTBEAT, reconnect: DEFAULT_RECONNECT };
    if (persist) saveCredential(credsPath, d.wsUrl, { token: args.token });
    return d;
  }
  if (typeof args.code === 'string' && server) {
    const httpBase = server.replace(/^ws/, 'http');
    const res = await fetch(`${httpBase}/api/pair/redeem`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: args.code.toUpperCase().trim(), label }),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.success) throw new Error(data.message || 'pairing failed');
    const dev = data.device;
    const d = { protocolVersion: '1', wsUrl: `${server}/api/harness`, token: dev.token, device: dev, heartbeat: DEFAULT_HEARTBEAT, reconnect: DEFAULT_RECONNECT };
    if (persist) saveCredential(credsPath, d.wsUrl, { token: dev.token, deviceId: dev.id, label: dev.label, scope: dev.scope });
    return d;
  }
  const store = loadStore(credsPath);
  const hosts = Object.keys(store);
  let stored = null;
  if (server) { try { stored = store[new URL(`${server}/api/harness`).host] || store[new URL(server).host]; } catch {} }
  else if (hosts.length === 1) stored = store[hosts[0]];
  if (stored && stored.token) {
    return { protocolVersion: '1', wsUrl: stored.wsUrl, token: stored.token, device: { id: stored.deviceId, label: stored.label, scope: stored.scope }, heartbeat: DEFAULT_HEARTBEAT, reconnect: DEFAULT_RECONNECT };
  }
  throw new Error('No credentials. Provide --connect <url>, or --server <url> with --code <code> or --token <token>.');
}

// ── LLM config (bring-your-own; spawn-provided is a fallback) ────────────────
function resolveLlm(spawnLlm) {
  const e = process.env;
  const baseURL = e.OPENAI_BASE_URL || e.LLM_BASE_URL || e.OPENAI_API_BASE || (spawnLlm && spawnLlm.baseURL) || '';
  const apiKey = e.OPENAI_API_KEY || e.LLM_API_KEY || (spawnLlm && spawnLlm.apiKey) || '';
  const model = e.OPENAI_MODEL || e.LLM_MODEL || (spawnLlm && spawnLlm.model) || '';
  return { baseURL: baseURL.replace(/\/+$/, ''), apiKey, model };
}
function providerLabel(baseURL) { try { return new URL(baseURL).host; } catch { return 'openai-compatible'; } }

// ── tools (executed on THIS machine) ─────────────────────────────────────────
const TOOL_SCHEMAS = [
  { type: 'function', function: { name: 'read', description: 'Read a text file.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'write', description: 'Create or overwrite a text file.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
  { type: 'function', function: { name: 'edit', description: 'Replace the first occurrence of old_string with new_string in a file.', parameters: { type: 'object', properties: { path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } }, required: ['path', 'old_string', 'new_string'] } } },
  { type: 'function', function: { name: 'ls', description: 'List a directory.', parameters: { type: 'object', properties: { path: { type: 'string' } } } } },
  { type: 'function', function: { name: 'bash', description: 'Run a shell command in the session workspace.', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } } },
];

function clip(s) { s = String(s ?? ''); return s.length > MAX_TOOL_OUTPUT ? s.slice(0, MAX_TOOL_OUTPUT) + `\n…[truncated ${s.length - MAX_TOOL_OUTPUT} chars]` : s; }

function resolveInWorkspace(workspace, p) {
  if (!p) return workspace;
  return path.isAbsolute(p) ? p : path.join(workspace, p);
}

function runBash(command, cwd) {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const shell = isWin ? 'cmd' : (fs.existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh');
    const shellArgs = isWin ? ['/c', command] : ['-c', command];
    let out = '', done = false;
    const child = spawn(shell, shellArgs, { cwd });
    const timer = setTimeout(() => { if (!done) { done = true; try { child.kill('SIGKILL'); } catch {} resolve(clip(out) + `\n[timed out after ${BASH_TIMEOUT_MS}ms]`); } }, BASH_TIMEOUT_MS);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { out += d.toString(); });
    child.on('close', (code) => { if (done) return; done = true; clearTimeout(timer); resolve(clip(out) + (code ? `\n[exit ${code}]` : '')); });
    child.on('error', (e) => { if (done) return; done = true; clearTimeout(timer); resolve(`[failed to run: ${e.message}]`); });
  });
}

async function execTool(workspace, name, args) {
  try {
    if (name === 'read') return { result: clip(fs.readFileSync(resolveInWorkspace(workspace, args.path), 'utf8')), isError: false };
    if (name === 'write') { const t = resolveInWorkspace(workspace, args.path); fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, args.content ?? ''); return { result: `wrote ${Buffer.byteLength(args.content ?? '')} bytes to ${args.path}`, isError: false }; }
    if (name === 'edit') { const t = resolveInWorkspace(workspace, args.path); const cur = fs.readFileSync(t, 'utf8'); if (!cur.includes(args.old_string)) return { result: `old_string not found in ${args.path}`, isError: true }; fs.writeFileSync(t, cur.replace(args.old_string, args.new_string)); return { result: `edited ${args.path}`, isError: false }; }
    if (name === 'ls') { const t = resolveInWorkspace(workspace, args.path || '.'); return { result: clip(fs.readdirSync(t).join('\n')), isError: false }; }
    if (name === 'bash') return { result: await runBash(args.command, workspace), isError: false };
    return { result: `unknown tool: ${name}`, isError: true };
  } catch (e) {
    return { result: `error: ${e.message}`, isError: true };
  }
}

// ── the agent loop (one OpenAI-compatible chat session) ──────────────────────
function createSession(sessionId, spawnMsg, emit) {
  const home = process.env.ORBIT_ADAPTER_HOME || path.join(os.homedir(), '.orbit');
  const workspace = path.join(home, 'workspaces', sessionId);
  fs.mkdirSync(workspace, { recursive: true });

  const llm = resolveLlm(spawnMsg.llm);
  // System prompt: prefer the console-built prompt; else assemble from the
  // dynamic blocks the console DOES send (capabilities + policy), plus a small
  // default. The workspace block is added HERE (only this machine knows its path).
  let system = spawnMsg.systemPrompt || 'You are a capable coding agent. Use the provided tools (read, write, edit, ls, bash) to complete the user\'s task. Be concise.';
  if (!spawnMsg.systemPrompt && spawnMsg.capabilitiesBlock) system += '\n\n' + spawnMsg.capabilitiesBlock;
  system += `\n\n## Your workspace (this session)\nWork in \`${workspace}\` (your current directory). Relative paths land there. It is on the machine "${os.hostname()}".`;

  return {
    id: sessionId, workspace, llm,
    messages: [{ role: 'system', content: system }],
    aborted: false, abort: null,
    mode: spawnMsg.mode || 'chat',
  };
}

async function chatCompletion(session) {
  const { baseURL, apiKey, model } = session.llm;
  session.abort = new AbortController();
  const res = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify({ model, messages: session.messages, tools: TOOL_SCHEMAS, tool_choice: 'auto' }),
    signal: session.abort.signal,
  });
  if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(`LLM ${res.status}: ${t.slice(0, 300)}`); }
  return res.json();
}

async function runTurn(session, userText, emit) {
  session.aborted = false;
  session.messages.push({ role: 'user', content: userText });
  let accumulated = '';
  try {
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      if (session.aborted) break;
      const resp = await chatCompletion(session);
      if (resp.usage) {
        const u = resp.usage;
        emit('usage', { input: u.prompt_tokens || 0, output: u.completion_tokens || 0, reasoning: u.completion_tokens_details?.reasoning_tokens || 0, cacheRead: u.prompt_tokens_details?.cached_tokens || 0 });
      }
      const msg = (resp.choices && resp.choices[0] && resp.choices[0].message) || {};
      if (msg.content) { accumulated += msg.content; emit('text_delta', { delta: msg.content }); emit('accumulated_text', { text: accumulated }); }
      // Push the assistant message verbatim so tool_call ids line up on replay.
      session.messages.push({ role: 'assistant', content: msg.content || '', ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}) });
      if (msg.tool_calls && msg.tool_calls.length) {
        for (const tc of msg.tool_calls) {
          let args = {}; try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
          emit('tool_call_start', { id: tc.id, name: tc.function.name, arguments: args });
          const { result, isError } = await execTool(session.workspace, tc.function.name, args);
          emit('tool_call_end', { id: tc.id, name: tc.function.name, result, isError });
          session.messages.push({ role: 'tool', tool_call_id: tc.id, content: String(result) });
        }
        continue; // let the model react to tool results
      }
      break; // no tool calls → turn complete
    }
  } catch (e) {
    if (!session.aborted) emit('error', { message: e.message });
  }
  emit('agent_end', { accumulatedText: accumulated, accumulatedThinking: '' });
}

// ── supervised connection ────────────────────────────────────────────────────
function connectSupervised(descriptor, { name, machine, credsPath, persisted }) {
  const backoff = descriptor.reconnect?.backoffMs || DEFAULT_RECONNECT.backoffMs;
  const maxJitter = descriptor.reconnect?.maxJitterMs || DEFAULT_RECONNECT.maxJitterMs;
  const heartbeatMs = descriptor.heartbeat?.intervalMs || DEFAULT_HEARTBEAT.intervalMs;
  const url = `${descriptor.wsUrl}?token=${encodeURIComponent(descriptor.token)}`;
  const sessions = new Map();
  let attempt = 0, stopped = false;

  function scheduleReconnect() {
    if (stopped) return;
    const base = backoff[Math.min(attempt, backoff.length - 1)];
    const delay = base + Math.floor(Math.random() * maxJitter);
    attempt++;
    console.log(`[orbit-connect] Reconnecting in ${Math.round(delay)}ms (attempt ${attempt})…`);
    setTimeout(connect, delay);
  }

  function connect() {
    if (stopped) return;
    const ws = new WebSocket(url);
    let heartbeat = null;
    const send = (obj) => { try { ws.send(JSON.stringify(obj)); } catch {} };

    ws.addEventListener('open', () => {
      attempt = 0;
      const llm = resolveLlm(null);
      console.log(`[orbit-connect] Connected to ${descriptor.wsUrl}. Registering as "${name}".`);
      send({
        type: 'register', name, machine,
        model: llm.model || '', provider: llm.baseURL ? providerLabel(llm.baseURL) : '',
        capabilities: ['chat', 'plan', 'edit', 'yolo', 'tools'],
      });
      heartbeat = setInterval(() => { try { ws.send(JSON.stringify({ type: 'ping' })); } catch {} }, heartbeatMs);
    });

    ws.addEventListener('message', async (ev) => {
      let msg; try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString()); } catch { return; }
      const sessionId = msg.sessionId;
      const emit = (event, data) => send({ type: 'event', sessionId, event, data });

      if (msg.type === 'registered') { console.log(`[orbit-connect] Registered as harness ${msg.harnessId}. Ready.`); return; }
      if (msg.type === 'list_tools') { send({ type: 'tools_list', reqId: msg.reqId, tools: TOOL_SCHEMAS.map((t) => ({ id: t.function.name, name: t.function.name, source: 'orbit-connect', description: t.function.description, enabledByDefault: true })) }); return; }
      if (msg.type === 'spawn') {
        const s = createSession(sessionId, msg, emit);
        if (!s.llm.baseURL || !s.llm.model) { emit('error', { message: 'No OpenAI-compatible model configured on this machine. Set OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL.' }); emit('agent_end', { accumulatedText: '' }); return; }
        sessions.set(sessionId, s);
        console.log(`[orbit-connect] Session ${sessionId} ready (model=${s.llm.model} via ${providerLabel(s.llm.baseURL)}).`);
        return;
      }
      if (msg.type === 'prompt') { const s = sessions.get(sessionId); if (s) await runTurn(s, msg.message, emit); return; }
      if (msg.type === 'cancel') { const s = sessions.get(sessionId); if (s) { s.aborted = true; try { s.abort?.abort(); } catch {} } return; }
      if (msg.type === 'disconnect') { const s = sessions.get(sessionId); if (s) { s.aborted = true; try { s.abort?.abort(); } catch {} sessions.delete(sessionId); } return; }
    });

    // A 401 on upgrade → token revoked/rotated. If it came from stored creds,
    // drop them and exit (retrying a dead token loops forever).
    ws.addEventListener('error', (e) => { console.error('[orbit-connect] socket error:', e?.message || 'error'); });
    ws.addEventListener('close', (ev) => {
      if (heartbeat) clearInterval(heartbeat);
      for (const s of sessions.values()) { s.aborted = true; try { s.abort?.abort(); } catch {} }
      sessions.clear();
      if (stopped) return;
      if (ev && ev.code === 4401 || ev?.reason === 'unauthorized') {
        console.error('[orbit-connect] Token rejected. Re-pair with a fresh code.');
        if (persisted) dropCredential(credsPath, descriptor.wsUrl);
        stopped = true; process.exit(1);
      }
      console.log('[orbit-connect] Disconnected.');
      scheduleReconnect();
    });
  }

  const shutdown = () => { stopped = true; process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  connect();
}

async function main() {
  if (typeof WebSocket === 'undefined') {
    console.error('[orbit-connect] This Node has no global WebSocket. Use Node 20+ (recommended 22+).');
    process.exit(1);
  }
  const args = parseArgs(process.argv.slice(2));
  const name = (typeof args.name === 'string' && args.name) || `${os.userInfo().username}@${os.hostname()}`;
  const machine = os.hostname();
  const credsPath = credentialsPath(args);
  const persisted = !INJECTED && !args.connect && !args.token && !args.code;

  let descriptor;
  try { descriptor = await resolveDescriptor(args, credsPath, name); }
  catch (e) { console.error(`[orbit-connect] ${e.message}`); process.exit(1); }

  const llm = resolveLlm(null);
  if (!llm.baseURL || !llm.model) {
    console.warn('[orbit-connect] No local model configured yet. Set OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL');
    console.warn('               (any OpenAI-SDK-compatible endpoint), or the console can supply one at spawn.');
  } else {
    console.log(`[orbit-connect] Model: ${llm.model} via ${providerLabel(llm.baseURL)}.`);
  }
  connectSupervised(descriptor, { name, machine, credsPath, persisted });
}

if (require.main === module) main();
module.exports = { createSession, runTurn, execTool, resolveLlm, TOOL_SCHEMAS };
