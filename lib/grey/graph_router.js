// Decides when graph expansion helps a query, and renders graph facts for the prompt. Pure (no I/O).

// Relational / global cues (spec §10.4): questions about how things connect, or that span many items.
const RELATIONAL_CUES = [
  /\bbetween\b/,
  /\brelationships?\b/,
  /\brelat(?:ed|es|e|ing|ion|ions)\b/,
  /\bconnect(?:s|ed|ion|ions|ing)?\b/,
  /\blink(?:s|ed|ing)?\b/,
  /\binvolv(?:e|es|ed|ing)\b/,
  /\bworks?\s+(?:with|at|for)\b/,
  /\bworking\s+(?:with|at|for)\b/,
  /\bcompar(?:e|es|ed|ing|ison)\b/,
  /\ball\b/,
  /\bevery\b/,
  /\blist\b/,
  /\bacross\b/,
  /\boverview\b/,
  /\bsummar(?:y|ies|ise|ize|ised|ized|ising|izing)\b/,
  /\bhow\s+many\b/,
  /\bdepend(?:s|ed|ing|ency|encies|ent|ents)?\b/,
  /\bwho\b/,
  /\bwhich\b/,
];

export function hasRelationalCue(query) {
  const text = String(query ?? "").toLowerCase();
  return RELATIONAL_CUES.some((cue) => cue.test(text));
}

// mode: 'off' | 'auto' | 'always'. matchedCount: entities found in the query (kg_match_query_entities).
//   off    → never
//   always → whenever at least one entity matched
//   auto   → ≥ 2 entities matched, or 1 matched plus a relational/global cue
export function shouldUseGraph(query, { mode = "off", matchedCount = 0 } = {}) {
  const matched = Number.isFinite(Number(matchedCount)) ? Number(matchedCount) : 0;
  if (matched < 1) return false;
  if (mode === "always") return true;
  if (mode !== "auto") return false;
  return matched >= 2 || hasRelationalCue(query);
}

const MAX_FACTS = 20;

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

// Facts ({ subject, relation, object, confidence }) as prompt lines, one per fact, e.g.
// "- Jane Smith → works at → Acme". The caller adds the "Known relationships" heading.
// Returns "" when there is nothing to show.
export function formatFacts(facts) {
  const lines = [];
  const seen = new Set();
  for (const fact of facts || []) {
    const subject = clean(fact?.subject);
    const object = clean(fact?.object);
    const relation = clean(String(fact?.relation ?? "").replace(/_/g, " "));
    if (!subject || !object || !relation) continue;
    const line = `- ${subject} → ${relation} → ${object}`;
    if (seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
    if (lines.length >= MAX_FACTS) break;
  }
  return lines.join("\n");
}
