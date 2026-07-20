// agent-backend/routes/run.js
// Run API (Gap 1). A parent app submits a task and reads back a typed result
// contract (Gap 2) — no transcript scraping. Runs are versioned per session.
//
//   POST   /api/run             — { sessionId?, prompt, profileId?, mode?, effort?, sandbox?, timeouts? }
//                                  → { runId, sessionId, seq, status:"running" }
//                                  ?wait=true&timeoutMs= long-polls for short runs.
//   GET    /api/run/:runId      — the result contract for that run (pollable)
//   POST   /api/run/:runId/cancel — abort an in-flight run
//
// Session-scoped version history lives at GET /api/sessions/:id/runs (wired in
// server.js so it shares the sessions namespace).
//
// Every run/session is scoped to the tenant of the API key; a caller may only
// see/act on its own tenant's runs (superadmin sees all).

const { Router } = require("express");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TERMINAL = new Set(["succeeded", "failed", "timeout", "error", "needs_review"]);

function createRunRouter({ db, startRun, cancelRun }) {
  const router = Router();

  const tenantOf = (req) => (req.auth && req.auth.tenantId) || null;
  const isSuper = (req) => req.auth && req.auth.role === "superadmin";
  // A caller may touch a run only within its own tenant (superadmin: any).
  const canAccess = (req, ownerTenant) => isSuper(req) || (ownerTenant || null) === tenantOf(req);

  router.post("/", async (req, res) => {
    const b = req.body || {};
    const prompt = typeof b.prompt === "string" ? b.prompt.trim() : "";
    if (!prompt) return res.status(400).json({ success: false, error: "prompt is required" });

    // If targeting an existing session, it must belong to the caller's tenant.
    if (b.sessionId) {
      const s = await db.getSession(String(b.sessionId));
      if (s && !canAccess(req, s.tenantId)) {
        return res.status(404).json({ success: false, error: "no such session" });
      }
    }

    let out;
    try {
      out = await startRun({
        sessionId: b.sessionId ? String(b.sessionId) : undefined,
        prompt,
        profileId: b.profileId,
        mode: b.mode,
        effort: b.effort,
        sandbox: b.sandbox,
        timeouts: b.timeouts,
        tenantId: tenantOf(req),
        source: "api",
      });
    } catch (e) {
      console.error("[run] startRun failed:", e.message);
      return res.status(500).json({ success: false, error: "failed to start run" });
    }

    // Optional long-poll for short runs.
    if (String(req.query.wait) === "true") {
      const timeoutMs = Math.max(1000, Math.min(120_000, Number(req.query.timeoutMs) || 30_000));
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const r = await db.getRun(out.runId);
        if (r && TERMINAL.has(r.status)) return res.json({ success: true, run: r.contract });
        await sleep(500);
      }
      return res.status(202).json({ success: true, ...out });
    }

    res.json({ success: true, ...out });
  });

  router.get("/:runId", async (req, res) => {
    const run = await db.getRun(req.params.runId);
    if (!run) return res.status(404).json({ success: false, error: "no such run" });
    if (!canAccess(req, run.tenantId)) return res.status(404).json({ success: false, error: "no such run" });
    // A still-running row has an empty contract; synthesize the running shape.
    const contract = (run.contract && run.contract.status)
      ? run.contract
      : { runId: run.runId, sessionId: run.sessionId, seq: run.seq, status: run.status, ok: false, summary: "run in progress", artifacts: [], tests: { ran: false, passed: false } };
    res.json({ success: true, run: contract });
  });

  router.post("/:runId/cancel", async (req, res) => {
    const run = await db.getRun(req.params.runId);
    if (!run) return res.status(404).json({ success: false, error: "no such run" });
    if (!canAccess(req, run.tenantId)) return res.status(404).json({ success: false, error: "no such run" });
    const cancelled = cancelRun(req.params.runId);
    if (!cancelled) return res.status(409).json({ success: false, error: "run is not in flight" });
    res.json({ success: true, status: "cancelling" });
  });

  return router;
}

module.exports = createRunRouter;
