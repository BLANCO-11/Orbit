// ═══════════════════════════════════════════════════════════════════════
// SessionMetricsManager — centralized metrics tracking & persistence
// ═══════════════════════════════════════════════════════════════════════

const { performance } = require("perf_hooks");

// ── Schema ──────────────────────────────────────────────────────────
const METRICS_SCHEMA_VERSION = 2;

/**
 * Creates a fresh metrics object conforming to the structured schema.
 */
function createEmptyMetrics() {
  return {
    _schemaVersion: METRICS_SCHEMA_VERSION,
    sessionStart: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
    toolCalls: {
      total: 0,
      byTool: {},
    },
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      total: 0,
      estimated: true,
      // Provider-reported usage (from the harness's `usage` events). When any
      // reported usage arrives, `estimated` flips false and these become the
      // authoritative numbers for totals and cost.
      reported: { input: 0, output: 0, reasoning: 0, cacheRead: 0, total: 0 },
    },
    latency: {
      totalMs: 0,
      perTool: {},
      perPhase: {},
    },
    subagents: [],
    // Per-turn ledger (append-only): one entry per prompt turn with the token/
    // cost/tool-call deltas for that turn. Capped at 100 entries.
    turns: [],
    reasoningChunks: 0,
    sessionToolCalls: 0,
    sessionTokens: 0,
    actionFeed: [],
    mode: "",
    model: "",
  };
}

/**
 * Migrate old flat metrics format to new structured format.
 */
function migrateLegacyMetrics(oldMetrics) {
  if (!oldMetrics || typeof oldMetrics !== "object") {
    return createEmptyMetrics();
  }
  // Already structured (v1+). v1 → v2 just adds fields; patch them in place.
  if (oldMetrics._schemaVersion && oldMetrics.toolCalls?.byTool) {
    if (!oldMetrics.tokens.reported) {
      oldMetrics.tokens.reported = { input: 0, output: 0, reasoning: 0, total: 0 };
    }
    if (!Array.isArray(oldMetrics.turns)) oldMetrics.turns = [];
    oldMetrics._schemaVersion = METRICS_SCHEMA_VERSION;
    return oldMetrics;
  }
  // Legacy: { toolCalls: N, tokens: N, latency: N, cost: N, activeSubagents: [], actionFeed: [] }
  const m = createEmptyMetrics();
  if (typeof oldMetrics.toolCalls === "number") {
    m.toolCalls.total = oldMetrics.toolCalls;
  }
  if (typeof oldMetrics.sessionToolCalls === "number") {
    m.sessionToolCalls = oldMetrics.sessionToolCalls;
  } else {
    m.sessionToolCalls = m.toolCalls.total;
  }
  if (typeof oldMetrics.tokens === "number") {
    m.tokens.total = oldMetrics.tokens;
    m.tokens.output = oldMetrics.tokens;
  }
  if (typeof oldMetrics.sessionTokens === "number") {
    m.sessionTokens = oldMetrics.sessionTokens;
  } else {
    m.sessionTokens = m.tokens.total;
  }
  if (typeof oldMetrics.latency === "number") {
    m.latency.totalMs = oldMetrics.latency * 1000; // legacy was in seconds
  }
  if (Array.isArray(oldMetrics.actionFeed)) {
    m.actionFeed = oldMetrics.actionFeed;
  }
  if (Array.isArray(oldMetrics.activeSubagents)) {
    m.subagents = oldMetrics.activeSubagents.map((sa, i) => ({
      id: sa.id || `legacy-${i}`,
      name: sa.name || "unknown",
      status: sa.status || "unknown",
      toolCalls: sa.toolCalls || 0,
      tokens: sa.tokens || 0,
    }));
  }
  return m;
}

// ── Token Estimation ────────────────────────────────────────────────
// Unified token counter. Uses character-count estimation by default.
// Set estimated=false when using a real tokenizer.

function estimateTokens(text) {
  if (!text || typeof text !== "string") return 0;
  // Average: ~3.8 chars per token for English text; code is denser (~3.0)
  // Use a blended ratio based on code density heuristics
  const codeChars = (text.match(/[{}().,;:=\-+*/<>[\]|&^%$#@!~`'"\n\t]/g) || []).length;
  const totalLen = text.length;
  const codeRatio = totalLen > 0 ? codeChars / totalLen : 0;
  // Code-heavy text: ~3.0 chars/token, prose: ~4.5 chars/token
  const ratio = 3.0 + (1 - Math.min(codeRatio, 0.5)) * 1.5; // ranges 3.0–4.5
  return Math.round(totalLen / ratio);
}

function estimateTokensFromLines(lines) {
  if (!Array.isArray(lines)) return 0;
  return lines.reduce((sum, line) => sum + estimateTokens(String(line)), 0);
}

// ── Cost ────────────────────────────────────────────────────────────
// Directional $/1M-token rates. When the harness reports real usage
// (tokens.reported), cost is computed from the actual input/output split;
// when only the character-count estimate is available, we assume a 3:1
// input:output split (typical for tool-heavy agent traffic).
const MODEL_PRICING_PER_MILLION = [
  { match: /claude-.*opus/i, in: 15, out: 75 },
  { match: /claude-.*sonnet/i, in: 3, out: 15 },
  { match: /claude-.*haiku/i, in: 0.8, out: 4 },
  { match: /gpt-4o-mini/i, in: 0.15, out: 0.6 },
  { match: /gpt-4o/i, in: 2.5, out: 10 },
  { match: /gpt-4/i, in: 5, out: 15 },
  { match: /gpt-3\.5/i, in: 0.5, out: 1.5 },
  { match: /gemini.*pro/i, in: 1.25, out: 5 },
  { match: /gemini.*flash/i, in: 0.075, out: 0.3 },
  { match: /deepseek/i, in: 0.14, out: 0.28 },
];
const DEFAULT_RATES = { in: 0.5, out: 1.5 }; // fallback for unrecognized/local models

/**
 * Cost from a directional token split. Reasoning tokens bill as output
 * (that's how every provider meters thinking). Cache-READ tokens bill at ~10%
 * of the input rate (Anthropic/most providers) — this matters enormously for
 * agentic turns, where the same large system prompt + history is re-sent on
 * every internal model call: without cache-read accounting the cost looks like
 * it's "exploding" when in reality most of that input is cheap cache hits.
 */
const CACHE_READ_FACTOR = 0.1;
function computeCost({ input = 0, output = 0, reasoning = 0, cacheRead = 0 }, modelName) {
  const entry = MODEL_PRICING_PER_MILLION.find(p => modelName && p.match.test(modelName));
  const rates = entry || DEFAULT_RATES;
  return (
    (input / 1_000_000) * rates.in +
    (cacheRead / 1_000_000) * rates.in * CACHE_READ_FACTOR +
    ((output + reasoning) / 1_000_000) * rates.out
  );
}

/** Legacy blended estimate from a single total (assumes 3:1 in:out). */
function estimateCost(totalTokens, modelName) {
  return computeCost({ input: totalTokens * 0.75, output: totalTokens * 0.25 }, modelName);
}

// ── Metrics Manager ─────────────────────────────────────────────────
class SessionMetricsManager {
  constructor() {
    /** Map<sessionId, MetricsObject> */
    this._metrics = new Map();
    /** Map<sessionId, Map<toolCallId, { startTime, name }>> for per-tool latency */
    this._toolTimers = new Map();
    /** Map<sessionId, { startTime }> for phase timing */
    this._phaseTimers = new Map();
    /** Map<sessionId, openTurn> for the per-turn ledger (ephemeral, not persisted) */
    this._openTurns = new Map();
  }

  /**
   * Effective token counters: provider-reported when any usage arrived,
   * character-count estimate otherwise.
   */
  _effectiveTokens(m) {
    return m.tokens.estimated ? m.tokens : m.tokens.reported;
  }

  _effectiveCost(m) {
    const t = this._effectiveTokens(m);
    return computeCost({ input: t.input, output: t.output, reasoning: t.reasoning, cacheRead: t.cacheRead || 0 }, m.model);
  }

  /**
   * Initialize metrics for a session. Idempotent — reuses existing if present.
   */
  initSession(sessionId, mode, modelName) {
    if (this._metrics.has(sessionId)) {
      const existing = this._metrics.get(sessionId);
      if (mode) existing.mode = mode;
      if (modelName) existing.model = modelName;
      return existing;
    }
    const m = createEmptyMetrics();
    m.mode = mode || "";
    m.model = modelName || "";
    this._metrics.set(sessionId, m);
    this._toolTimers.set(sessionId, new Map());
    this._phaseTimers.set(sessionId, {});
    return m;
  }

  /**
   * Load existing metrics from DB (may be legacy format).
   */
  loadSession(sessionId, dbMetrics) {
    const m = migrateLegacyMetrics(dbMetrics);
    this._metrics.set(sessionId, m);
    if (!this._toolTimers.has(sessionId)) {
      this._toolTimers.set(sessionId, new Map());
    }
    if (!this._phaseTimers.has(sessionId)) {
      this._phaseTimers.set(sessionId, {});
    }
    return m;
  }

  /**
   * Get live metrics object for a session.
   */
  getMetrics(sessionId) {
    return this._metrics.get(sessionId) || null;
  }

  /**
   * Record a tool call start (for latency tracking).
   */
  startToolCall(sessionId, toolCallId, toolName) {
    const timers = this._toolTimers.get(sessionId);
    if (timers) {
      timers.set(toolCallId, { startTime: performance.now(), name: toolName, args: null });
    }
  }

  /**
   * Record tool call args (captured for action feed).
   */
  setToolCallArgs(sessionId, toolCallId, args) {
    const timers = this._toolTimers.get(sessionId);
    if (timers) {
      const timer = timers.get(toolCallId);
      if (timer) timer.args = args;
    }
  }

  /**
   * Record a tool call completion. Returns latency in ms.
   */
  endToolCall(sessionId, toolCallId, toolName, result, resultTokens) {
    const metrics = this._metrics.get(sessionId);
    const timers = this._toolTimers.get(sessionId);
    let latencyMs = 0;

    if (timers) {
      const timer = timers.get(toolCallId);
      if (timer) {
        latencyMs = Math.round(performance.now() - timer.startTime);
        timers.delete(toolCallId);

        // Record per-tool latency
        const toolNameKey = timer.name || toolName || "unknown";
        if (!metrics.latency.perTool[toolNameKey]) {
          metrics.latency.perTool[toolNameKey] = { count: 0, totalMs: 0, avgMs: 0 };
        }
        metrics.latency.perTool[toolNameKey].count++;
        metrics.latency.perTool[toolNameKey].totalMs += latencyMs;
        metrics.latency.perTool[toolNameKey].avgMs = Math.round(
          metrics.latency.perTool[toolNameKey].totalMs / metrics.latency.perTool[toolNameKey].count
        );
      }
    }

    if (metrics) {
      metrics.toolCalls.total++;
      metrics.sessionToolCalls = metrics.toolCalls.total;
      const toolNameKey = toolName || "unknown";
      metrics.toolCalls.byTool[toolNameKey] = (metrics.toolCalls.byTool[toolNameKey] || 0) + 1;
      metrics.latency.totalMs += latencyMs;

      const outputTok = resultTokens || (result ? estimateTokens(String(result)) : 0);
      metrics.tokens.output += outputTok;
      metrics.tokens.total += outputTok;
      metrics.sessionTokens = metrics.tokens.total;

      // Action feed entry
      const args = timers?.get(toolCallId)?.args;
      metrics.actionFeed.push({
        type: "tool_call",
        toolName: toolNameKey,
        latencyMs,
        timestamp: new Date().toISOString(),
        resultSnippet: result ? String(result).substring(0, 100) : "",
      });
      if (metrics.actionFeed.length > 200) {
        metrics.actionFeed = metrics.actionFeed.slice(-100);
      }

      metrics.lastActivity = new Date().toISOString();
    }

    return latencyMs;
  }

  /**
   * Record reasoning tokens (thinking) as a separate metric.
   */
  recordReasoning(sessionId, delta, content) {
    const metrics = this._metrics.get(sessionId);
    if (!metrics) return;
    const tok = delta || estimateTokens(content || "");
    metrics.tokens.reasoning += tok;
    metrics.tokens.total += tok;
    metrics.sessionTokens = metrics.tokens.total;
    metrics.reasoningChunks++;
    metrics.lastActivity = new Date().toISOString();
  }

  /**
   * Record input tokens (user prompt sent to agent).
   */
  recordInputTokens(sessionId, text) {
    const metrics = this._metrics.get(sessionId);
    if (!metrics) return;
    const tok = estimateTokens(text);
    metrics.tokens.input += tok;
    metrics.tokens.total += tok;
    metrics.sessionTokens = metrics.tokens.total;
    metrics.lastActivity = new Date().toISOString();
    return tok;
  }

  /**
   * Record output tokens (text generated by agent).
   */
  recordOutputTokens(sessionId, text) {
    const metrics = this._metrics.get(sessionId);
    if (!metrics) return;
    const tok = estimateTokens(text);
    metrics.tokens.output += tok;
    metrics.tokens.total += tok;
    metrics.sessionTokens = metrics.tokens.total;
    metrics.lastActivity = new Date().toISOString();
    return tok;
  }

  /**
   * Record provider-reported usage (real tokens from the model API, relayed
   * by the harness as a `usage` event). First reported usage flips the
   * session from estimated to reported accounting.
   */
  recordUsage(sessionId, { input = 0, output = 0, reasoning = 0, cacheRead = 0 } = {}) {
    const metrics = this._metrics.get(sessionId);
    if (!metrics) return;
    if (!metrics.tokens.reported) {
      metrics.tokens.reported = { input: 0, output: 0, reasoning: 0, cacheRead: 0, total: 0 };
    }
    const r = metrics.tokens.reported;
    if (r.cacheRead === undefined) r.cacheRead = 0;

    // Dedup guard: the harness sniffs usage off several stdout item shapes
    // (message_update final chunk, a terminal message item, agent_end). One
    // model completion can surface the SAME usage payload on more than one of
    // them; summing each occurrence is what makes a trivial turn's token count
    // balloon. Two genuinely-distinct completions never share a byte-identical
    // (input,output,reasoning) triple — the cumulative input always differs —
    // so skipping an exact repeat of the immediately-preceding payload is safe.
    const sig = `${input}|${output}|${reasoning}|${cacheRead}`;
    if (sig === metrics._lastUsageSig && (input || output || reasoning)) return;
    metrics._lastUsageSig = sig;

    r.input += input;
    r.output += output;
    r.reasoning += reasoning;
    r.cacheRead += cacheRead;
    r.total = r.input + r.output + r.reasoning;
    metrics.tokens.estimated = false;
    metrics.sessionTokens = r.total;
    metrics.lastActivity = new Date().toISOString();
  }

  /**
   * Check the session's accumulated usage against configured budget caps.
   * A cap of 0 (or missing) means "no limit". Returns the list of exceeded
   * caps, each with the limit and the current value, so the caller can halt
   * and report precisely. Sub-agent depth is checked separately at spawn time.
   */
  checkBudget(sessionId, budgets) {
    const metrics = this._metrics.get(sessionId);
    if (!metrics || !budgets) return { ok: true, exceeded: [] };
    const exceeded = [];
    const tokens = this._effectiveTokens(metrics).total;
    const cost = this._effectiveCost(metrics);
    if (budgets.maxCostPerSession > 0 && cost >= budgets.maxCostPerSession) {
      exceeded.push({ kind: "cost", limit: budgets.maxCostPerSession, value: cost });
    }
    if (budgets.maxTokensPerSession > 0 && tokens >= budgets.maxTokensPerSession) {
      exceeded.push({ kind: "tokens", limit: budgets.maxTokensPerSession, value: tokens });
    }
    return { ok: exceeded.length === 0, exceeded };
  }

  // ── Per-turn ledger ─────────────────────────────────────────────────

  /**
   * Open a turn: snapshot counters so endTurn can record this turn's deltas.
   */
  beginTurn(sessionId, promptText) {
    const metrics = this._metrics.get(sessionId);
    if (!metrics) return;
    // Fresh turn — clear the dedup signature so this turn's first usage is never
    // mistaken for a repeat of the previous turn's final payload.
    metrics._lastUsageSig = null;
    // Snapshot BOTH counters: if the session flips estimated→reported mid-turn
    // (first real usage event arrives), the delta must be taken against the
    // matching source's baseline, not across sources.
    const est = metrics.tokens;
    const rep = metrics.tokens.reported || { input: 0, output: 0, reasoning: 0 };
    this._openTurns.set(sessionId, {
      startMs: Date.now(),
      prompt: String(promptText || "").substring(0, 120),
      estimatedAt: { input: est.input, output: est.output, reasoning: est.reasoning },
      reportedAt: { input: rep.input, output: rep.output, reasoning: rep.reasoning },
      toolCallsAt: metrics.toolCalls.total,
      costAt: this._effectiveCost(metrics),
    });
  }

  /**
   * Close the open turn and append its deltas to the persisted ledger.
   */
  endTurn(sessionId) {
    const metrics = this._metrics.get(sessionId);
    const open = this._openTurns.get(sessionId);
    if (!metrics || !open) return null;
    this._openTurns.delete(sessionId);
    const t = this._effectiveTokens(metrics);
    const baseline = metrics.tokens.estimated ? open.estimatedAt : open.reportedAt;
    const entry = {
      at: new Date(open.startMs).toISOString(),
      durationMs: Date.now() - open.startMs,
      prompt: open.prompt,
      tokens: {
        input: Math.max(0, t.input - baseline.input),
        output: Math.max(0, t.output - baseline.output),
        reasoning: Math.max(0, t.reasoning - baseline.reasoning),
      },
      toolCalls: metrics.toolCalls.total - open.toolCallsAt,
      cost: Math.max(0, this._effectiveCost(metrics) - open.costAt),
      source: metrics.tokens.estimated ? "estimated" : "reported",
    };
    if (!Array.isArray(metrics.turns)) metrics.turns = [];
    metrics.turns.push(entry);
    if (metrics.turns.length > 100) metrics.turns = metrics.turns.slice(-100);
    metrics.lastActivity = new Date().toISOString();
    return entry;
  }

  /**
   * Aggregate sub-agent tokens into the session total.
   * Called when a sub-agent completes its task.
   */
  aggregateSubagentTokens(sessionId, { input, output, reasoning }) {
    const metrics = this._metrics.get(sessionId);
    if (!metrics) return;
    metrics.tokens.input += (input || 0);
    metrics.tokens.output += (output || 0);
    metrics.tokens.reasoning += (reasoning || 0);
    metrics.tokens.total += ((input || 0) + (output || 0) + (reasoning || 0));
    metrics.sessionTokens = metrics.tokens.total;
    metrics.lastActivity = new Date().toISOString();
  }

  /**
   * Start a phase timer (e.g., "reasoning", "tool_execution", "planning").
   */
  startPhase(sessionId, phaseName) {
    const timers = this._phaseTimers.get(sessionId);
    if (timers) {
      timers[phaseName] = { startTime: performance.now() };
    }
  }

  /**
   * End a phase timer. Returns elapsed ms.
   */
  endPhase(sessionId, phaseName) {
    const metrics = this._metrics.get(sessionId);
    const timers = this._phaseTimers.get(sessionId);
    if (!metrics || !timers) return 0;
    const timer = timers[phaseName];
    if (!timer) return 0;
    const elapsed = Math.round(performance.now() - timer.startTime);
    metrics.latency.perPhase[phaseName] = (metrics.latency.perPhase[phaseName] || 0) + elapsed;
    delete timers[phaseName];
    return elapsed;
  }

  /**
   * Register a subagent in the metrics.
   */
  addSubagent(sessionId, subagentData) {
    const metrics = this._metrics.get(sessionId);
    if (!metrics) return null;
    const entry = {
      id: subagentData.id,
      name: subagentData.name || "subagent",
      parentId: subagentData.parentId || null,
      status: subagentData.status || "spawning",
      mode: subagentData.mode || metrics.mode || "",
      timeStart: new Date().toISOString(),
      timeEnd: null,
      toolCalls: [],
      reasoning: [],
      tokens: { input: 0, output: 0, reasoning: 0, total: 0 },
      results: "",
      children: [],
    };
    metrics.subagents.push(entry);
    metrics.lastActivity = new Date().toISOString();
    return entry;
  }

  /**
   * Update subagent status.
   */
  updateSubagent(sessionId, subagentId, updates) {
    const metrics = this._metrics.get(sessionId);
    if (!metrics) return;
    const sa = metrics.subagents.find(s => s.id === subagentId);
    if (!sa) return;
    Object.assign(sa, updates);
    metrics.lastActivity = new Date().toISOString();
  }

  /**
   * Record subagent reasoning.
   */
  addSubagentReasoning(sessionId, subagentId, content, tokens) {
    const metrics = this._metrics.get(sessionId);
    if (!metrics) return;
    const sa = metrics.subagents.find(s => s.id === subagentId);
    if (!sa) return;
    const tok = tokens || estimateTokens(content);
    sa.reasoning.push({ content, timestamp: new Date().toISOString(), tokens: tok });
    sa.tokens.reasoning += tok;
    sa.tokens.total += tok;
    metrics.tokens.reasoning += tok;
    metrics.tokens.total += tok;
    metrics.sessionTokens = metrics.tokens.total;
    metrics.lastActivity = new Date().toISOString();
  }

  /**
   * Record subagent tool call.
   */
  addSubagentToolCall(sessionId, subagentId, toolName, args, result, latencyMs) {
    const metrics = this._metrics.get(sessionId);
    if (!metrics) return;
    const sa = metrics.subagents.find(s => s.id === subagentId);
    if (!sa) return;
    const tc = {
      name: toolName,
      args: args ? (typeof args === "string" ? args.substring(0, 200) : JSON.stringify(args).substring(0, 200)) : "",
      result: result ? String(result).substring(0, 200) : "",
      startTime: new Date().toISOString(),
      latencyMs: latencyMs || 0,
    };
    sa.toolCalls.push(tc);
    sa.tokens.output += tc.result ? estimateTokens(tc.result) : 0;
    sa.tokens.total += tc.result ? estimateTokens(tc.result) : 0;
    metrics.lastActivity = new Date().toISOString();
  }

  /**
   * Mark a subagent as completed.
   */
  completeSubagent(sessionId, subagentId, results) {
    const metrics = this._metrics.get(sessionId);
    if (!metrics) return;
    const sa = metrics.subagents.find(s => s.id === subagentId);
    if (!sa) return;
    sa.status = "completed";
    sa.timeEnd = new Date().toISOString();
    if (results) sa.results = String(results).substring(0, 500);
    metrics.lastActivity = new Date().toISOString();
  }

  /**
   * Get the persistent-ready metrics object for DB storage.
   * Strips ephemeral fields (timer maps, etc.).
   */
  toPersistable(sessionId) {
    const metrics = this._metrics.get(sessionId);
    if (!metrics) return createEmptyMetrics();
    return {
      ...metrics,
      cost: this._effectiveCost(metrics),
      costSource: metrics.tokens.estimated ? "estimated" : "reported",
      lastActivity: new Date().toISOString(),
    };
  }

  /**
   * Get a compact partial metrics update for real-time frontend streaming.
   */
  toFrontendUpdate(sessionId) {
    const m = this._metrics.get(sessionId);
    if (!m) return {};
    const activeSubs = m.subagents
      .filter(sa => sa.status === "spawning" || sa.status === "working")
      .map(sa => ({
        id: sa.id,
        name: sa.name,
        status: sa.status,
        toolCalls: sa.toolCalls.length,
        tokens: sa.tokens.total,
        mode: sa.mode,
      }));
    const eff = this._effectiveTokens(m);
    return {
      toolCalls: m.toolCalls.total,
      sessionToolCalls: m.sessionToolCalls,
      tokens: eff.total,
      sessionTokens: eff.total,
      tokensIn: eff.input,
      tokensOut: eff.output,
      tokensReasoning: eff.reasoning,
      tokensEstimated: m.tokens.estimated,
      tokensSource: m.tokens.estimated ? "estimated" : "reported",
      cost: this._effectiveCost(m),
      costEstimated: m.tokens.estimated,
      latency: m.latency.totalMs,
      latencyPerTool: m.latency.perTool,
      turns: (m.turns || []).slice(-12),
      activeSubagents: activeSubs,
      subagents: activeSubs, // field name expected by frontend
      actionFeed: m.actionFeed.slice(-10),
    };
  }

  /**
   * Clean up resources for a session.
   */
  releaseSession(sessionId) {
    this._metrics.delete(sessionId);
    this._toolTimers.delete(sessionId);
    this._phaseTimers.delete(sessionId);
    this._openTurns.delete(sessionId);
  }
}

// ── Singleton ───────────────────────────────────────────────────────
const metricsManager = new SessionMetricsManager();

module.exports = {
  SessionMetricsManager,
  metricsManager,
  createEmptyMetrics,
  migrateLegacyMetrics,
  estimateTokens,
  estimateTokensFromLines,
  estimateCost,
  computeCost,
  METRICS_SCHEMA_VERSION,
};
