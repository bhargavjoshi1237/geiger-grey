// Nearest-neighbour label vote (spec §5.7). Pure. A classify tool's stored items vote for a label
// with their similarity score; the runtime asks the model only when the vote is unclear.

const round = (n) => Math.round(n * 10000) / 10000;

/**
 * neighbors: [{ sourceId, score, labels }] sorted by score, best first. allowed: the tool's labels.
 * Uses the top `k` neighbours with score ≥ minScore that carry at least one allowed label
 * (matched case-insensitively; the canonical `allowed` spelling is returned). A neighbour with n
 * allowed labels adds score / n to each. Ties are broken by vote count, then by label order in
 * `allowed`. `label` is the leading label even when the margin is too low to decide.
 * -> { label|null, confidence, margin, decided, reason: "ok"|"no_labeled_neighbors"|"low_margin",
 *      votes: [{ label, weight, count }] (best first), evidence: sourceIds that voted for the winner }
 */
export function voteLabels(neighbors, allowed, { k = 7, minScore = 0, minMargin = 0.15 } = {}) {
  const canonical = new Map();
  (Array.isArray(allowed) ? allowed : []).forEach((label) => {
    const value = typeof label === "string" ? label.trim() : "";
    if (value && !canonical.has(value.toLowerCase())) canonical.set(value.toLowerCase(), { label: value, order: canonical.size });
  });
  const limit = Number.isFinite(Number(k)) && Number(k) >= 1 ? Math.floor(Number(k)) : 7;
  const floor = Number.isFinite(Number(minScore)) ? Number(minScore) : 0;
  const margin = Number.isFinite(Number(minMargin)) ? Number(minMargin) : 0.15;

  const voters = [];
  for (const neighbor of Array.isArray(neighbors) ? neighbors : []) {
    if (voters.length >= limit) break;
    const score = Number(neighbor?.score);
    if (!Number.isFinite(score) || score < floor) continue;
    const labels = [];
    for (const raw of Array.isArray(neighbor?.labels) ? neighbor.labels : []) {
      const hit = typeof raw === "string" ? canonical.get(raw.trim().toLowerCase()) : null;
      if (hit && !labels.includes(hit.label)) labels.push(hit.label);
    }
    if (labels.length) voters.push({ sourceId: neighbor.sourceId, score: Math.max(0, score), labels });
  }

  if (!voters.length) {
    return { label: null, confidence: 0, margin: 0, decided: false, reason: "no_labeled_neighbors", votes: [], evidence: [] };
  }

  const tally = new Map();
  for (const voter of voters) {
    for (const label of voter.labels) {
      const entry = tally.get(label) || { label, weight: 0, count: 0 };
      entry.weight += voter.score / voter.labels.length;
      entry.count += 1;
      tally.set(label, entry);
    }
  }
  const order = (label) => canonical.get(label.toLowerCase()).order;
  const ranked = [...tally.values()].sort(
    (a, b) => b.weight - a.weight || b.count - a.count || order(a.label) - order(b.label),
  );
  const total = ranked.reduce((sum, v) => sum + v.weight, 0);
  const first = ranked[0];
  const second = ranked[1]?.weight ?? 0;
  const confidence = total > 0 ? first.weight / total : 0;
  const lead = total > 0 ? (first.weight - second) / total : 0;
  const decided = total > 0 && lead + 1e-9 >= margin; // epsilon: 0.3 - 0.15 must count as a 0.15 margin

  return {
    label: first.label,
    confidence: round(confidence),
    margin: round(lead),
    decided,
    reason: decided ? "ok" : "low_margin",
    votes: ranked.map((v) => ({ label: v.label, weight: round(v.weight), count: v.count })),
    evidence: voters.filter((v) => v.labels.includes(first.label)).map((v) => v.sourceId),
  };
}
