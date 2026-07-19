// agent-backend/harnesses/picode/parser.js
// Pi CLI stdout JSON-line parsing — pure functions with no side effects

// ── Strip TUI box-drawing characters from reasoning/plan output ──
function stripTuiChars(text) {
  const lines = text
    .replace(/[╔╗╚╝║═╠╣╦╩╬┌┐└┘├┤┬┴┼─│]/g, "")
    .split("\n")
    .map(line => {
      let cleaned = line.replace(/^[\s│├┤┌┐└┘║╠╣┬┴┼─═]*\s*/, "");
      cleaned = cleaned.replace(/[\s│├┤┌┐└┘║╠╣┬┴┼─═]*$/, "");
      return cleaned.trim();
    })
    .filter(line => {
      const stripped = line.replace(/[\-\=\[\]\(\)\s\.<>]/g, "").trim();
      return stripped.length > 0;
    });
  
  const deduped = [];
  for (let i = 0; i < lines.length; i++) {
    const current = lines[i];
    const next = i + 1 < lines.length ? lines[i + 1] : null;
    if (next && next.startsWith(current) && next.length > current.length + 3) {
      continue;
    }
    if (current.length < 15 && next && next.includes(current.trim())) {
      continue;
    }
    deduped.push(current);
  }
  
  while (deduped.length > 0) {
    const last = deduped[deduped.length - 1];
    if (last.length < 2) { deduped.pop(); continue; }
    if (last.length < 5 && !/[.!?\)\]\"\'>]\s*$/.test(last) && !/^(No|Ok|Hi|Bye|Yes|Done|Step|File|Code|Test|Bug|Fix|Add|Run|Set|Get|Put|Try|Use|New|All|The|And|But|For|Not|Are|Was|Had|Has|Can|May|Will|Its|Let|How|Why|What|Who|When|Where)$/i.test(last)) {
      deduped.pop(); continue;
    }
    break;
  }
  
  return deduped.join("\n");
}

function isMutatingTool(toolName) {
  const mutatingTools = ["write", "edit", "replace_file_content", "multi_replace_file_content", "bash", "subagent"];
  return mutatingTools.includes(toolName);
}

function isReadOnlyTool(toolName) {
  if (toolName && toolName.startsWith("mcp_lightpanda_")) return true;
  const readOnlyTools = ["read", "find", "grep", "ls", "code_search", "web_search", "fetch_content", "get_search_content"];
  return readOnlyTools.includes(toolName);
}

function isConversationalPrompt(prompt) {
  if (!prompt || typeof prompt !== "string") return false;
  const conversationalPhrases = [
    /^\s*hello\s*$/i, /^\s*hi\s*$/i, /^\s*hey\s*$/i, /^\s*yo\s*$/i,
    /^\s*howdy\s*$/i, /^\s*sup\s*$/i, /^\s*greetings\s*$/i,
    /^\s*good\s+(morning|afternoon|evening)\s*$/i,
    /^\s*thank(s|\s*you)\s*$/i, /^\s*bye\s*$/i, /^\s*goodbye\s*$/i
  ];
  return conversationalPhrases.some(regex => regex.test(prompt));
}

// Action verbs implying something is being BUILT or CHANGED (multi-step work).
const ACTION_VERB = /\b(implement|build|create|add|write|refactor|migrate|fix|set\s?up|configure|integrate|deploy|rename|remove|delete|update|install|scaffold|port|convert|replace|generate|design|develop|rewrite|optimi[sz]e|automate|wire\s?up|hook\s?up|extract|split|merge|combine|set\s?up)\b/i;

/**
 * Positive heuristic: does this prompt look like genuine MULTI-STEP work that
 * warrants a pre-generated execution plan? Default is NO — questions, lookups,
 * and single-step asks must never trigger planning. This replaces the old
 * greeting-only whitelist, which let *every* non-greeting question fire an
 * extra reasoning round-trip (Workstream B1).
 */
function isMultiStepTask(prompt) {
  if (!prompt || typeof prompt !== "string") return false;
  const text = prompt.trim();
  if (text.length < 25) return false; // too short to be real multi-step work

  const lower = text.toLowerCase();

  // Pure questions / lookups are Q&A, never tasks — no plan.
  const questionStart = /^(what|why|how|who|when|where|which|whose|is|are|am|was|were|do|does|did|can|could|should|would|will|explain|tell\s+me|show\s+me|describe|summar(y|ize|ise)|list|find|search|look\s+up|read|check)\b/i;
  if (questionStart.test(lower) || /\?\s*$/.test(text)) return false;

  // Must be action-oriented to be a task at all.
  if (!ACTION_VERB.test(lower)) return false;

  // Multi-step signals: multiple actions, explicit enumeration/chaining, an
  // "and"-joined compound ask, or a long substantive request.
  const actionCount = (lower.match(new RegExp(ACTION_VERB.source, "gi")) || []).length;
  const multiStep =
    actionCount >= 2 ||
    /\b(and then|then|after that|first|next|finally|step\s*\d|steps|following)\b/i.test(lower) ||
    /(^|\n)\s*\d+[.)]\s/.test(text) ||       // numbered list
    /(^|\n)\s*[-*]\s/.test(text) ||          // bulleted list
    (/\band\b/i.test(lower) && text.length > 60) || // compound ask
    text.length > 120;                        // long, substantive ask

  return Boolean(multiStep);
}

// Broader small-talk detector: greetings, acknowledgements, and short social
// chit-chat. A superset of isConversationalPrompt's exact-match phrases, but kept
// deliberately SHORT-only so a real question ("how do I deploy this?") never
// gets misread as small talk.
function isSmallTalk(prompt) {
  if (!prompt || typeof prompt !== "string") return false;
  const text = prompt.trim();
  if (isConversationalPrompt(text)) return true;
  if (text.length > 40) return false; // small talk is brief
  const lower = text.toLowerCase();
  return /^(hey|hi|hello|yo|hiya|ok|okay|k|cool|nice|great|awesome|perfect|thanks|thank\s*you|thx|ty|cheers|lol|haha|good\s+(job|work|one|morning|afternoon|evening|night)|how\s+are\s+you|how'?s\s+it\s+going|what'?s\s+up|whats\s+up|sup|you\s+there|are\s+you\s+there|yes|yep|yeah|no|nope|nvm|never\s*mind|sure|sounds\s+good)\b[\s!.?]*$/i.test(lower);
}

/**
 * Classify a user prompt by its NATURE, for behavior + TTS routing:
 *   'conversational' — greetings / pleasantries / social chit-chat.
 *   'task'           — genuine build-or-change work (drives pre-planning).
 *   'qa'             — questions, lookups, explanations, single-step asks, else.
 * This does NOT decide the permission mode — the user owns that in the composer.
 * It's a lightweight signal the turn path uses to gate planning and to decide
 * whether/what to speak (voice suits chat & Q&A; heavy task output stays quiet).
 */
function classifyQuery(prompt) {
  if (!prompt || typeof prompt !== "string") return "qa";
  const text = prompt.trim();
  if (!text) return "qa";
  if (isSmallTalk(text)) return "conversational";
  if (isMultiStepTask(text)) return "task";
  return "qa";
}

module.exports = { stripTuiChars, isMutatingTool, isReadOnlyTool, isConversationalPrompt, isMultiStepTask, isSmallTalk, classifyQuery };
