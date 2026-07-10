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

module.exports = { stripTuiChars, isMutatingTool, isReadOnlyTool, isConversationalPrompt };
