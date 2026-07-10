// ═══════════════════════════════════════════════════════════════════════
// SessionMetricsManager — centralized metrics tracking & persistence
// ═══════════════════════════════════════════════════════════════════════

const { performance } = require("perf_hooks");

// ── Schema ──────────────────────────────────────────────────────────
const METRICS_SCHEMA_VERSION = 1;

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
    },
    latency: {
      totalMs: 0,
      perTool: {},
      perPhase: {},
    },
    subagents: [],
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
  // Already migrated
  if (oldMetrics._schemaVersion && oldMetrics.toolCalls?.byTool) {
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

// ── Cost Estimation ─────────────────────────────────────────────────
// Token counts are a character-count estimate (see estimateTokens above),
// not real provider usage — the harness protocol (harnesses/interface.js)
// has no usage/token event, and the LLM calls happen inside the external
// `pi` CLI process, not in this backend, so we never see a real API
// response to read `usage` from. Cost is therefore necessarily an
// estimate derived from an estimate; rates are blended $/1M tokens
// (input+output averaged, since we don't split by direction).
const MODEL_PRICING_PER_MILLION = [
  { match: /claude-.*opus/i, rate: 15 },
  { match: /claude-.*sonnet/i, rate: 3 },
  { match: /claude-.*haiku/i, rate: 0.8 },
  { match: /gpt-4o-mini/i, rate: 0.15 },
  { match: /gpt-4o/i, rate: 2.5 },
  { match: /gpt-4/i, rate: 5 },
  { match: /gpt-3\.5/i, rate: 0.5 },
  { match: /gemini.*pro/i, rate: 1.25 },
  { match: /gemini.*flash/i, rate: 0.075 },
  { match: /deepseek/i, rate: 0.28 },
];
const DEFAULT_RATE_PER_MILLION = 1; // blended fallback for unrecognized/local models

function estimateCost(totalTokens, modelName) {
  const entry = MODEL_PRICING_PER_MILLION.find(p => modelName && p.match.test(modelName));
  const rate = entry ? entry.rate : DEFAULT_RATE_PER_MILLION;
  return (totalTokens / 1_000_000) * rate;
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
      cost: estimateCost(metrics.tokens.total, metrics.model),
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
    return {
      toolCalls: m.toolCalls.total,
      sessionToolCalls: m.sessionToolCalls,
      tokens: m.tokens.total,
      sessionTokens: m.sessionTokens,
      tokensEstimated: m.tokens.estimated,
      cost: estimateCost(m.tokens.total, m.model),
      costEstimated: true, // always true until the harness protocol reports real usage
      latency: m.latency.totalMs,
      latencyPerTool: m.latency.perTool,
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
  METRICS_SCHEMA_VERSION,
};
