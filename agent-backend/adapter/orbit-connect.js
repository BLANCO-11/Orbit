#!/usr/bin/env node
'use strict';
// orbit-connect.js — zero-dependency, AGENT-AGNOSTIC Orbit connector.
//
// Connect ANY machine's already-installed agent to an Orbit runtime — no
// `npm install`, one self-contained file, stock Node (20+; built-in global
// `fetch` + `WebSocket`). Typical flow:
//
//     curl -fsSL 'https://HOST/api/pair/bootstrap?code=ABC123' | node
//
// which serves this file with the pairing descriptor baked in. It pairs, then
// becomes a harness the Orbit console drives — spawn/prompt/cancel come down the
// socket, standardized events stream back — indistinguishable from local pi.
//
// AGENT MODEL (see the "agent adapters" section):
//   • Orbit is the ORCHESTRATING brain — it sends a plan/context/task.
//   • The remote runs its OWN agent, which does its OWN inference with its OWN
//     provider/auth and executes its OWN tools. Orbit never supplies inference.
//   • A per-agent ADAPTER is a pure relay/translator: it converts the agent's
//     native wire format ⇄ Orbit's standardized events. It drives no tools and
//     holds no LLM. Adapters auto-detect by PATH. Built in: pi + Claude Code
//     (rich, persistent JSON-lines events), OpenCode / Codex / Gemini CLI / Aider
//     (per-turn text streaming), and a `custom` adapter driven by ORBIT_AGENT_CMD
//     for anything else.
//   • A box with no recognized agent is NOT a harness and won't connect — unless
//     you explicitly force the built-in generic OpenAI tool loop with
//     ORBIT_CONNECT_AGENT=generic (that escape-hatch path DOES need its own
//     OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL and runs a minimal
//     read/write/edit/bash/ls loop on this machine).

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

// Tools that create/modify files or run commands. Non-`full` device scopes and
// the central policy's excludeTools can strip these — defense-in-depth, since a
// remote executes tools locally (Orbit's tool_call_start gate can observe but
// can't veto mid-turn, so the connector must also refuse).
const MUTATING_TOOLS = new Set(['write', 'edit', 'bash']);

// Compute the tools this session may NOT use, from the device scope (set at pair
// time) + the excludeTools the console sends per spawn.
function computeExcluded(scope, excludeTools) {
  const excluded = new Set();
  if (Array.isArray(excludeTools)) for (const t of excludeTools) if (typeof t === 'string') excluded.add(t);
  // read_only / chat_voice devices may read + converse but never mutate.
  if (scope === 'read_only' || scope === 'chat_voice') for (const t of MUTATING_TOOLS) excluded.add(t);
  return excluded;
}

function clip(s) { s = String(s ?? ''); return s.length > MAX_TOOL_OUTPUT ? s.slice(0, MAX_TOOL_OUTPUT) + `\n…[truncated ${s.length - MAX_TOOL_OUTPUT} chars]` : s; }

function resolveInWorkspace(workspace, p) {
  if (!p) return workspace;
  return path.isAbsolute(p) ? p : path.join(workspace, p);
}

// Kill a child AND its descendants. The shell forks grandchildren (sleep, curl,
// …) that would otherwise (a) keep running after we "cancel" and (b) hold the
// stdout pipe open so we'd never see 'close'. Spawning detached makes the shell a
// process-group leader; signalling the negative pid hits the whole group. Windows
// has no equivalent, so fall back to the bare child there.
function killTree(child, signal) {
  if (!child || !child.pid) return;
  if (process.platform === 'win32') {
    // Windows has no process groups; taskkill /T kills the whole tree by parentage.
    try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); }
    catch { try { child.kill(signal); } catch {} }
    return;
  }
  try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch {} }
}

function runBash(command, cwd, onChild) {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const shell = isWin ? 'cmd' : (fs.existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh');
    const shellArgs = isWin ? ['/c', command] : ['-c', command];
    let out = '', done = false;
    // detached → own process group, so killTree() can take down grandchildren.
    const child = spawn(shell, shellArgs, { cwd, detached: !isWin, windowsHide: true });
    if (onChild) try { onChild(child); } catch {}
    const finish = (s) => { if (done) return; done = true; clearTimeout(timer); if (onChild) try { onChild(null); } catch {} resolve(s); };
    const timer = setTimeout(() => { if (!done) { killTree(child, 'SIGKILL'); finish(clip(out) + `\n[timed out after ${BASH_TIMEOUT_MS}ms]`); } }, BASH_TIMEOUT_MS);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { out += d.toString(); });
    child.on('close', (code) => finish(clip(out) + (code ? `\n[exit ${code}]` : '')));
    child.on('error', (e) => finish(`[failed to run: ${e.message}]`));
  });
}

async function execTool(workspace, name, args, onChild) {
  try {
    if (name === 'read') return { result: clip(fs.readFileSync(resolveInWorkspace(workspace, args.path), 'utf8')), isError: false };
    if (name === 'write') { const t = resolveInWorkspace(workspace, args.path); fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, args.content ?? ''); return { result: `wrote ${Buffer.byteLength(args.content ?? '')} bytes to ${args.path}`, isError: false }; }
    if (name === 'edit') { const t = resolveInWorkspace(workspace, args.path); const cur = fs.readFileSync(t, 'utf8'); if (!cur.includes(args.old_string)) return { result: `old_string not found in ${args.path}`, isError: true }; fs.writeFileSync(t, cur.replace(args.old_string, args.new_string)); return { result: `edited ${args.path}`, isError: false }; }
    if (name === 'ls') { const t = resolveInWorkspace(workspace, args.path || '.'); return { result: clip(fs.readdirSync(t).join('\n')), isError: false }; }
    if (name === 'bash') return { result: await runBash(args.command, workspace, onChild), isError: false };
    return { result: `unknown tool: ${name}`, isError: true };
  } catch (e) {
    return { result: `error: ${e.message}`, isError: true };
  }
}

// ── the agent loop (one OpenAI-compatible chat session) ──────────────────────
function createSession(sessionId, spawnMsg, emit, scope) {
  const home = process.env.ORBIT_ADAPTER_HOME || path.join(os.homedir(), '.orbit');
  const workspace = path.join(home, 'workspaces', sessionId);
  fs.mkdirSync(workspace, { recursive: true });

  const llm = resolveLlm(spawnMsg.llm);
  const excluded = computeExcluded(scope, spawnMsg.excludeTools);
  const tools = TOOL_SCHEMAS.filter((t) => !excluded.has(t.function.name));
  // System prompt: prefer the console-built prompt; else assemble from the
  // dynamic blocks the console DOES send (capabilities + policy), plus a small
  // default. The workspace block is added HERE (only this machine knows its path).
  let system = spawnMsg.systemPrompt || 'You are a capable coding agent. Use the provided tools (read, write, edit, ls, bash) to complete the user\'s task. Be concise.';
  if (!spawnMsg.systemPrompt && spawnMsg.capabilitiesBlock) system += '\n\n' + spawnMsg.capabilitiesBlock;
  system += `\n\n## Your workspace (this session)\nWork in \`${workspace}\` (your current directory). Relative paths land there. It is on the machine "${os.hostname()}".`;

  return {
    id: sessionId, workspace, llm,
    messages: [{ role: 'system', content: system }],
    aborted: false, abort: null, activeChild: null,
    mode: spawnMsg.mode || 'chat',
    excluded, tools,
  };
}

async function chatCompletion(session) {
  const { baseURL, apiKey, model } = session.llm;
  session.abort = new AbortController();
  const res = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify({ model, messages: session.messages, tools: session.tools || TOOL_SCHEMAS, tool_choice: 'auto' }),
    signal: session.abort.signal,
  });
  if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(`LLM ${res.status}: ${t.slice(0, 300)}`); }
  return res.json();
}

// Abort a session's in-flight turn: stop the loop, abort the LLM fetch, and kill
// any tool child still running (a long `bash` won't die just from aborting the
// fetch). Leaves the session usable for the next prompt (graceful turn-abort).
function abortSession(session) {
  if (!session) return;
  session.aborted = true;
  try { session.abort?.abort(); } catch {}
  if (session.activeChild) { killTree(session.activeChild, 'SIGKILL'); session.activeChild = null; }
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
          let result, isError;
          if (session.excluded && session.excluded.has(tc.function.name)) {
            // Refused locally even if the model tried it — the scope/policy that
            // stripped the tool from the schema is enforced here too.
            result = `Tool "${tc.function.name}" is disabled by policy for this device/session.`;
            isError = true;
          } else {
            ({ result, isError } = await execTool(session.workspace, tc.function.name, args, (c) => { session.activeChild = c; }));
          }
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

// ── agent adapters ───────────────────────────────────────────────────────────
// An adapter connects Orbit to ONE kind of already-installed agent (pi, Claude
// Code, OpenCode, …). It is a PURE RELAY/TRANSLATOR: Orbit's request goes in, the
// agent runs it with ITS OWN brain + ITS OWN tools, and the adapter only
// translates the agent's native wire format ⇄ Orbit's standardized events. The
// adapter NEVER executes tools itself (that's the agent's job) and never supplies
// an LLM (the agent uses its own provider/auth).
//
// Each adapter exposes: detect() (is this agent on the box?), capabilities (for
// register), describe() (read-only model/provider for Fleet), tools() (for the
// tools_list probe), and create(sessionId, spawnMsg, emit, scope) → a session
// with { prompt(text), cancel(), dispose() }. Adding a new agent = adding one
// adapter here; nothing else changes. resolveAdapter() auto-picks by PATH.
//
// The `generic` adapter (the built-in OpenAI tool loop above) is NOT auto-
// selected — a box with no real agent isn't a harness. It's available only when
// explicitly forced (ORBIT_CONNECT_AGENT=generic), as an escape hatch.

// Resolve a command to its ABSOLUTE path via PATH, or null. We spawn the agent
// with `cwd: <session workspace>`, so we must NOT rely on spawn's own PATH lookup
// — a relative PATH entry (e.g. `node_modules/.bin`) would re-resolve against the
// workspace and miss, giving a spurious ENOENT even though detection passed.
// Returning an absolute path and spawning THAT makes it cwd-independent.
function whichCommand(cmd) {
  const isWin = process.platform === 'win32';
  const exts = isWin ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  const dirs = (process.env.PATH || '').split(isWin ? ';' : ':');
  for (const dir of dirs) {
    if (!dir) continue;
    const candidates = [];
    for (const ext of exts) {
      candidates.push(cmd + ext);
      if (isWin) candidates.push(cmd + ext.toLowerCase());
    }
    for (const c of candidates) {
      const abs = path.resolve(dir, c); // absolute, so cwd at spawn can't matter
      try { if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs; } catch {}
    }
  }
  return null;
}

function commandExists(cmd) { return !!whichCommand(cmd); }

// Cross-platform, cwd-safe spawn for ANY native agent binary — the shared spawn
// primitive every adapter (pi, and future claude/opencode/…) must use so OS
// handling lives in ONE place:
//   • resolves `binName` to an ABSOLUTE path (the session-workspace cwd can't
//     shadow PATH lookup → fixes spurious ENOENT on relative PATH entries);
//   • POSIX: detached → own process group so killTree() takes down the agent's
//     whole tool subtree; Windows: no detach (killTree uses taskkill /T), hide
//     the console, and run .cmd/.bat shims (npm installs) through a shell.
// Returns { child, resolvedBin }.
function spawnNativeAgent(binName, args, { cwd } = {}) {
  const isWin = process.platform === 'win32';
  const abs = whichCommand(binName) || binName; // bare name → let spawn surface ENOENT
  const isCmd = isWin && /\.(cmd|bat)$/i.test(abs);
  const child = spawn(abs, args, {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: !isWin,
    windowsHide: true,
    shell: isCmd,
  });
  return { child, resolvedBin: abs };
}

function stripAnsi(s) { return String(s || '').replace(/\x1b\[[0-9;]*m/g, ''); }

function sessionWorkspace(sessionId) {
  const home = process.env.ORBIT_ADAPTER_HOME || path.join(os.homedir(), '.orbit');
  const workspace = path.join(home, 'workspaces', sessionId);
  fs.mkdirSync(workspace, { recursive: true });
  return workspace;
}

function workspaceNote(workspace) {
  return `\n\n## Your workspace (this session)\nWork in \`${workspace}\` (your current directory). Relative paths land there. This machine is "${os.hostname()}".`;
}

// ── Engine A: persistent JSON-lines agent ────────────────────────────────────
// For agents that run as ONE long-lived process speaking newline-delimited JSON
// on stdio (pi rpc, Claude Code stream-json). Shared plumbing — spawn, line
// buffering, prompt/cancel encoding, lifecycle — so each such agent is just a
// small `cfg`: { bin, buildArgs, map(item,emit,st), encodePrompt, encodeCancel }.
// The agent runs its OWN brain + OWN tools; `map` only translates its native
// events into Orbit's standardized ones. st = { acc, accThinking, turnActive }.
function createJsonlSession(sessionId, spawnMsg, emit, scope, cfg) {
  const workspace = sessionWorkspace(sessionId);
  const system = (spawnMsg.systemPrompt || 'You are a capable coding agent.') + workspaceNote(workspace);
  const excluded = computeExcluded(scope, spawnMsg.excludeTools);
  const args = cfg.buildArgs({ sessionId, system, excluded, workspace });
  const { child } = spawnNativeAgent(cfg.bin, args, { cwd: workspace });
  const st = { acc: '', accThinking: '', buf: '', turnActive: false };

  child.stdout.on('data', (d) => {
    st.buf += d.toString();
    const lines = st.buf.split('\n'); st.buf = lines.pop();
    for (const line of lines) { if (!line.trim()) continue; let item; try { item = JSON.parse(line); } catch { continue; } try { cfg.map(item, emit, st); } catch {} }
  });
  child.stderr.on('data', (d) => { const t = d.toString().trim(); if (t) emit('stderr', { text: t }); });
  child.on('error', (e) => { emit('error', { message: `${cfg.bin} failed to start: ${e.message}` }); if (st.turnActive) { st.turnActive = false; emit('agent_end', { accumulatedText: '' }); } });
  // If the process dies mid-turn, close out the turn so the console isn't stuck.
  child.on('close', () => { if (st.turnActive) { st.turnActive = false; emit('agent_end', { accumulatedText: st.acc, accumulatedThinking: st.accThinking }); } });

  return {
    prompt: (text) => { st.turnActive = true; try { child.stdin.write(cfg.encodePrompt(text)); } catch (e) { emit('error', { message: e.message }); st.turnActive = false; emit('agent_end', { accumulatedText: st.acc }); } },
    cancel: () => { if (cfg.encodeCancel) { try { child.stdin.write(cfg.encodeCancel()); } catch {} } else { killTree(child, 'SIGKILL'); } },
    dispose: () => { killTree(child, 'SIGTERM'); setTimeout(() => killTree(child, 'SIGKILL'), 1500); },
  };
}

// ── Engine B: per-turn text agent ────────────────────────────────────────────
// For agents whose headless mode is "take a prompt, stream text, exit" (opencode
// run, gemini -p, codex exec, aider --message, or any ORBIT_AGENT_CMD). One
// process PER turn; stdout is relayed as text (no granular tool/usage events —
// those agents don't emit a machine-readable stream). The agent still runs its
// own brain + tools; we just can't see inside. Stateless across turns.
function createTextSession(sessionId, spawnMsg, emit, scope, cfg) {
  const workspace = sessionWorkspace(sessionId);
  const system = spawnMsg.systemPrompt || '';
  const excluded = computeExcluded(scope, spawnMsg.excludeTools);
  let current = null;
  return {
    prompt: (text) => new Promise((resolve) => {
      let acc = '', done = false, child;
      const end = () => { if (done) return; done = true; current = null; emit('agent_end', { accumulatedText: acc }); resolve(); };
      try { ({ child } = spawnNativeAgent(cfg.bin, cfg.buildArgs({ prompt: text, system, workspace, excluded, sessionId }), { cwd: workspace })); }
      catch (e) { emit('error', { message: `${cfg.bin} failed: ${e.message}` }); return end(); }
      current = child;
      if (cfg.stdinPrompt) { try { child.stdin.write(text); child.stdin.end(); } catch {} }
      child.stdout.on('data', (d) => { const s = stripAnsi(d.toString()); acc += s; emit('text_delta', { delta: s }); emit('accumulated_text', { text: acc }); });
      child.stderr.on('data', (d) => { const t = d.toString().trim(); if (t) emit('stderr', { text: t }); });
      child.on('error', (e) => { emit('error', { message: `${cfg.bin} failed: ${e.message}` }); end(); });
      child.on('close', () => end());
    }),
    cancel: () => { if (current) killTree(current, 'SIGKILL'); },
    dispose: () => { if (current) killTree(current, 'SIGKILL'); },
  };
}

// ── pi: persistent rpc (rich events) ─────────────────────────────────────────
function piMap(item, emit, st) {
  const usage = item.usage || item.message?.usage || item.assistantMessageEvent?.usage || null;
  if (usage) { const u = usage; const input = u.input ?? u.input_tokens ?? u.prompt_tokens ?? 0, output = u.output ?? u.output_tokens ?? u.completion_tokens ?? 0, reasoning = u.reasoning ?? u.reasoning_tokens ?? u.completion_tokens_details?.reasoning_tokens ?? 0, cacheRead = u.cache_read ?? u.cacheRead ?? u.cache_read_input_tokens ?? 0; if (input || output || reasoning) emit('usage', { input, output, reasoning, cacheRead, subagentId: item.subagentId || null }); }
  if (item.type === 'message_update') {
    const ev = item.assistantMessageEvent || {};
    if (ev.type === 'text_delta') { st.acc += ev.delta; emit('text_delta', { delta: ev.delta }); emit('accumulated_text', { text: st.acc }); }
    else if (ev.type === 'thinking_delta') { st.accThinking += ev.delta; emit('thinking_delta', { delta: ev.delta }); emit('accumulated_thinking', { text: stripAnsi(st.accThinking) }); }
    return;
  }
  if (item.type === 'tool_call_start' || item.type === 'tool_execution_start') { const tc = item.toolCall || item; emit('tool_call_start', { id: tc.id || tc.toolCallId, name: tc.name || tc.toolName || '', arguments: tc.arguments || {}, subagentId: item.subagentId || null }); return; }
  if (item.type === 'tool_call_end' || item.type === 'tool_execution_end') { const tc = item.toolCall || item; emit('tool_call_end', { id: tc.id || tc.toolCallId, name: tc.name || tc.toolName || '', result: item.result || null, isError: item.isError === true || tc.isError === true, subagentId: item.subagentId || null }); return; }
  if (item.type === 'subagent_update') { if (item.reasoning) emit('subagent_reasoning', { subagentId: item.subagentId, delta: item.reasoning, tokens: item.tokens || 0 }); if (item.status) emit('subagent_status', { subagentId: item.subagentId, status: item.status }); return; }
  if (item.type === 'agent_end') { st.turnActive = false; emit('agent_end', { accumulatedText: st.acc, accumulatedThinking: st.accThinking }); st.acc = ''; st.accThinking = ''; return; }
  emit(item.type, item);
}
function createPiSession(sessionId, spawnMsg, emit, scope, bin) {
  return createJsonlSession(sessionId, spawnMsg, emit, scope, {
    bin: bin || 'pi',
    buildArgs: ({ sessionId, system, excluded }) => {
      const a = ['--session-id', sessionId, '--mode', 'rpc', '--system-prompt', system];
      if (excluded.size) a.push('--exclude-tools', Array.from(excluded).join(','));
      return a;
    },
    map: piMap,
    encodePrompt: (text) => JSON.stringify({ type: 'prompt', message: text }) + '\n',
    encodeCancel: () => JSON.stringify({ type: 'cancel' }) + '\n', // graceful; process survives
  });
}

// ── Claude Code: persistent stream-json (rich events) ────────────────────────
// `claude -p --input-format stream-json --output-format stream-json --verbose`.
// claude uses its OWN auth/model + OWN tools. Flags/schema are version-sensitive;
// if a version differs, override via ORBIT_AGENT_CMD (text mode) — see custom.
const CLAUDE_TOOL_MAP = { bash: 'Bash', write: 'Write', edit: 'Edit', read: 'Read', ls: 'LS' };
function claudeMap(item, emit, st) {
  const emitUsage = (u) => { if (!u) return; const input = u.input_tokens || 0, output = u.output_tokens || 0, cacheRead = u.cache_read_input_tokens || 0; if (input || output) emit('usage', { input, output, reasoning: 0, cacheRead }); };
  if (item.type === 'assistant' && item.message) {
    for (const b of (item.message.content || [])) {
      if (b.type === 'text' && b.text) { st.acc += b.text; emit('text_delta', { delta: b.text }); emit('accumulated_text', { text: st.acc }); }
      else if (b.type === 'thinking' && b.thinking) { st.accThinking += b.thinking; emit('thinking_delta', { delta: b.thinking }); emit('accumulated_thinking', { text: st.accThinking }); }
      else if (b.type === 'tool_use') { emit('tool_call_start', { id: b.id, name: b.name || '', arguments: b.input || {} }); }
    }
    emitUsage(item.message.usage);
    return;
  }
  if (item.type === 'user' && item.message) {
    for (const b of (item.message.content || [])) {
      if (b.type === 'tool_result') emit('tool_call_end', { id: b.tool_use_id, name: '', result: typeof b.content === 'string' ? b.content : JSON.stringify(b.content), isError: b.is_error === true });
    }
    return;
  }
  if (item.type === 'result') { emitUsage(item.usage); st.turnActive = false; emit('agent_end', { accumulatedText: st.acc, accumulatedThinking: st.accThinking }); st.acc = ''; st.accThinking = ''; return; }
  // system/init and other events: ignore.
}
function createClaudeSession(sessionId, spawnMsg, emit, scope, bin) {
  return createJsonlSession(sessionId, spawnMsg, emit, scope, {
    bin: bin || 'claude',
    buildArgs: ({ system, excluded }) => {
      const a = ['-p', '--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose'];
      if (system) a.push('--append-system-prompt', system);
      const disallow = []; for (const t of excluded) { const m = CLAUDE_TOOL_MAP[t]; if (m) disallow.push(m); }
      if (disallow.length) a.push('--disallowedTools', disallow.join(' '));
      return a;
    },
    map: claudeMap,
    encodePrompt: (text) => JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }) + '\n',
    encodeCancel: null, // no in-band turn cancel; killTree stops it (ends the session)
  });
}

// ── Text agents (per-turn stdout streaming) ──────────────────────────────────
function textAgent(bin, buildArgs, opts = {}) {
  return (sid, msg, emit, scope) => createTextSession(sid, msg, emit, scope, { bin, buildArgs, ...opts });
}
// Prompt as an arg is the common shape. Orbit's system prompt is NOT injected for
// text agents (arg-size/quoting + each agent has its own) — they get the task.
const OPENCODE_CREATE = textAgent('opencode', ({ prompt }) => ['run', prompt]);
const GEMINI_CREATE   = textAgent('gemini',   ({ prompt }) => ['-p', prompt]);
const CODEX_CREATE     = textAgent('codex',    ({ prompt }) => ['exec', prompt]);
const AIDER_CREATE     = textAgent('aider',    ({ prompt }) => ['--yes-always', '--no-auto-commits', '--message', prompt]);

// Custom escape hatch: ORBIT_AGENT_CMD=<bin>, ORBIT_AGENT_ARGS="run --json {prompt}"
// ({prompt} is substituted; if absent, the prompt is appended). Drives ANY agent
// via the text engine — no code change needed for an agent we don't ship.
function createCustomSession(sid, msg, emit, scope) {
  const bin = process.env.ORBIT_AGENT_CMD;
  const tmpl = (process.env.ORBIT_AGENT_ARGS || '').trim();
  return createTextSession(sid, msg, emit, scope, {
    bin,
    buildArgs: ({ prompt }) => {
      if (!tmpl) return [prompt];
      const parts = tmpl.split(/\s+/);
      return parts.includes('{prompt}') ? parts.map((p) => (p === '{prompt}' ? prompt : p)) : [...parts, prompt];
    },
  });
}

// The generic OpenAI tool loop (above) wrapped in the adapter shape. Escape hatch
// only — for a box that has a model but no real agent.
function createGenericSession(sessionId, spawnMsg, emit, scope) {
  const s = createSession(sessionId, spawnMsg, emit, scope);
  return {
    _generic: s,
    prompt: (text) => runTurn(s, text, emit),
    cancel: () => abortSession(s),   // aborts turn + kills in-flight tool child; session reusable
    dispose: () => abortSession(s),
  };
}

// Registry, in detection priority order. `custom` wins when ORBIT_AGENT_CMD is
// set; otherwise the first agent found on PATH. `generic` is never auto-selected.
const TEXT_CAPS = ['chat', 'plan', 'edit', 'yolo', 'tools'];
const ADAPTERS = [
  { kind: 'custom', detect: () => !!process.env.ORBIT_AGENT_CMD, capabilities: TEXT_CAPS, describe: () => ({ model: '', provider: `${process.env.ORBIT_AGENT_CMD || 'custom'} (custom)` }), tools: () => [], create: createCustomSession },
  { kind: 'pi', detect: () => commandExists('pi'), capabilities: ['chat', 'plan', 'edit', 'yolo', 'subagents', 'tools', 'browser'], describe: () => ({ model: '', provider: 'pi (native)' }), tools: () => ['read', 'write', 'edit', 'bash', 'grep', 'find'].map((n) => ({ id: n, name: n, source: 'pi', description: `pi built-in ${n}`, enabledByDefault: true })), create: (sid, msg, emit, scope) => createPiSession(sid, msg, emit, scope, 'pi') },
  { kind: 'claude', detect: () => commandExists('claude'), capabilities: ['chat', 'plan', 'edit', 'yolo', 'subagents', 'tools'], describe: () => ({ model: '', provider: 'claude code (native)' }), tools: () => [], create: (sid, msg, emit, scope) => createClaudeSession(sid, msg, emit, scope, 'claude') },
  { kind: 'opencode', detect: () => commandExists('opencode'), capabilities: TEXT_CAPS, describe: () => ({ model: '', provider: 'opencode (native)' }), tools: () => [], create: OPENCODE_CREATE },
  { kind: 'codex', detect: () => commandExists('codex'), capabilities: TEXT_CAPS, describe: () => ({ model: '', provider: 'codex (native)' }), tools: () => [], create: CODEX_CREATE },
  { kind: 'gemini', detect: () => commandExists('gemini'), capabilities: TEXT_CAPS, describe: () => ({ model: '', provider: 'gemini cli (native)' }), tools: () => [], create: GEMINI_CREATE },
  { kind: 'aider', detect: () => commandExists('aider'), capabilities: TEXT_CAPS, describe: () => ({ model: '', provider: 'aider (native)' }), tools: () => [], create: AIDER_CREATE },
];

const GENERIC_ADAPTER = {
  kind: 'generic',
  detect: () => true,
  capabilities: ['chat', 'plan', 'edit', 'yolo', 'tools'],
  describe: () => { const llm = resolveLlm(null); return { model: llm.model || '', provider: llm.baseURL ? providerLabel(llm.baseURL) : '' }; },
  tools: () => TOOL_SCHEMAS.map((t) => ({ id: t.function.name, name: t.function.name, source: 'orbit-connect', description: t.function.description, enabledByDefault: true })),
  create: (sid, msg, emit, scope) => createGenericSession(sid, msg, emit, scope),
};

// Pick the adapter for this box. `ORBIT_CONNECT_AGENT` / `--agent` forces one
// (including `generic`); otherwise auto-detect a real agent by PATH. Returns null
// when no real agent is present (→ the box isn't a harness; it won't connect).
function resolveAdapter(forced) {
  const want = forced || process.env.ORBIT_CONNECT_AGENT || 'auto';
  if (want && want !== 'auto') {
    if (want === 'generic') return GENERIC_ADAPTER;
    const a = ADAPTERS.find((a) => a.kind === want);
    if (a) return a;
  }
  return ADAPTERS.find((a) => a.detect()) || null;
}

// ── supervised connection ────────────────────────────────────────────────────
function connectSupervised(descriptor, { name, machine, credsPath, persisted, adapter }) {
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
      const desc = adapter.describe ? adapter.describe() : { model: '', provider: adapter.kind };
      console.log(`[orbit-connect] Connected to ${descriptor.wsUrl}. Registering as "${name}" (adapter: ${adapter.kind}).`);
      send({
        type: 'register', name, machine,
        model: desc.model || '', provider: desc.provider || adapter.kind,
        capabilities: adapter.capabilities || ['chat', 'tools'],
      });
      heartbeat = setInterval(() => { try { ws.send(JSON.stringify({ type: 'ping' })); } catch {} }, heartbeatMs);
    });

    ws.addEventListener('message', async (ev) => {
      let msg; try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString()); } catch { return; }
      const sessionId = msg.sessionId;
      const emit = (event, data) => send({ type: 'event', sessionId, event, data });

      if (msg.type === 'registered') { console.log(`[orbit-connect] Registered as harness ${msg.harnessId}. Ready.`); return; }
      if (msg.type === 'list_tools') { send({ type: 'tools_list', reqId: msg.reqId, tools: adapter.tools ? adapter.tools() : [] }); return; }
      if (msg.type === 'spawn') {
        const scope = descriptor.device && descriptor.device.scope;
        let session;
        try { session = adapter.create(sessionId, msg, emit, scope); }
        catch (e) { emit('error', { message: `adapter (${adapter.kind}) failed: ${e.message}` }); emit('agent_end', { accumulatedText: '' }); return; }
        // The generic escape-hatch loop is the only path needing a local model.
        if (adapter.kind === 'generic' && session._generic && (!session._generic.llm.baseURL || !session._generic.llm.model)) {
          emit('error', { message: 'No OpenAI-compatible model configured on this machine. Set OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL, or install a supported agent (pi).' });
          emit('agent_end', { accumulatedText: '' });
          try { session.dispose(); } catch {}
          return;
        }
        sessions.set(sessionId, session);
        console.log(`[orbit-connect] Session ${sessionId} ready via the ${adapter.kind} adapter.`);
        return;
      }
      if (msg.type === 'prompt') { const s = sessions.get(sessionId); if (s) await s.prompt(msg.message); return; }
      if (msg.type === 'cancel') { const s = sessions.get(sessionId); if (s) s.cancel(); return; }
      if (msg.type === 'disconnect') { const s = sessions.get(sessionId); if (s) { s.dispose(); sessions.delete(sessionId); } return; }
    });

    // A 401 on upgrade → token revoked/rotated. If it came from stored creds,
    // drop them and exit (retrying a dead token loops forever).
    ws.addEventListener('error', (e) => { console.error('[orbit-connect] socket error:', e?.message || 'error'); });
    ws.addEventListener('close', (ev) => {
      if (heartbeat) clearInterval(heartbeat);
      for (const s of sessions.values()) { try { s.dispose(); } catch {} }
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

  // Pick the agent this box will run as a harness. A real installed agent (pi,
  // …) wins; the agent uses ITS OWN provider + tools. If none is found and the
  // generic loop isn't explicitly requested, refuse — a box with no agent isn't
  // a harness.
  const adapter = resolveAdapter(typeof args.agent === 'string' ? args.agent : null);
  if (!adapter) {
    console.error('[orbit-connect] No supported agent found on this machine.');
    console.error('               Install one (e.g. `pi`) so Orbit can drive it with its own brain + tools,');
    console.error('               or run with ORBIT_CONNECT_AGENT=generic (or --agent generic) to use the built-in model loop');
    console.error('               (that path needs OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL set here).');
    process.exit(1);
  }
  if (adapter.kind === 'generic') {
    const llm = resolveLlm(null);
    if (!llm.baseURL || !llm.model) {
      console.warn('[orbit-connect] generic adapter: no local model yet. Set OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL,');
      console.warn('               or the console can supply one at spawn.');
    } else {
      console.log(`[orbit-connect] generic adapter model: ${llm.model} via ${providerLabel(llm.baseURL)}.`);
    }
  } else {
    console.log(`[orbit-connect] Driving native agent "${adapter.kind}" (it uses its own provider + tools).`);
  }
  connectSupervised(descriptor, { name, machine, credsPath, persisted, adapter });
}

// Run when executed directly (`node orbit-connect.js …`) OR when the bootstrap
// injected a descriptor and piped us into `node` via stdin — in the stdin case
// `require.main` is `undefined`, so the usual `require.main === module` guard is
// false and main() would silently never run (the script would just exit). Only
// stay a pure module (no auto-run) when required for tests.
if (require.main === module || INJECTED) main();
module.exports = { createSession, runTurn, execTool, resolveLlm, abortSession, computeExcluded, createJsonlSession, createTextSession, createPiSession, createClaudeSession, createGenericSession, resolveAdapter, commandExists, whichCommand, spawnNativeAgent, ADAPTERS, GENERIC_ADAPTER, TOOL_SCHEMAS };
