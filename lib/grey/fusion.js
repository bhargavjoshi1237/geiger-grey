// Pure rank fusion for hybrid retrieval (no I/O). Reciprocal Rank Fusion merges the
// vector arms, the full-text arm and the graph list into one ranking by position only,
// so arms with incomparable score scales (cosine, ts_rank, graph depth) combine cleanly.

export const RRF_K = 60;

// Candidates fetched per retrieval arm: 5x topK, at least 30, at most 100.
export function poolSize(topK) {
  const k = Math.max(1, Math.floor(Number(topK) || 1));
  return Math.min(Math.max(k * 5, 30), 100);
}

// lists: [{ via: 'vector' | 'text' | 'graph' | ..., items: [{ chunkId, ...fields }] }],
// each list already ordered best-first. weights are keyed by `via` (default 1).
// Returns one entry per distinct chunkId, best-first:
//   { ...fields of the first list that returned it, score, via, ranks }
// where score = Σ weight / (k + rank) over the lists containing the chunk, ranks maps
// each contributing via to its best (1-based) rank, and via names the contributing
// arms ordered by contribution (e.g. "vector+text"). Ties keep first-appearance order.
export function fuseRrf(lists = [], { k = RRF_K, weights = {} } = {}) {
  const fused = new Map();
  let order = 0;

  for (const list of lists) {
    const via = list?.via || "unknown";
    const weight = weights[via] ?? 1;
    if (!(weight > 0)) continue;
    const seen = new Set();
    (list?.items || []).forEach((item, index) => {
      const id = item?.chunkId;
      if (!id || seen.has(id)) return;
      seen.add(id);
      const rank = index + 1;
      const contribution = weight / (k + rank);
      let entry = fused.get(id);
      if (!entry) {
        entry = { item, score: 0, contributions: new Map(), ranks: {}, order: order++ };
        fused.set(id, entry);
      }
      entry.score += contribution;
      entry.contributions.set(via, (entry.contributions.get(via) || 0) + contribution);
      if (entry.ranks[via] === undefined || rank < entry.ranks[via]) entry.ranks[via] = rank;
    });
  }

  return [...fused.values()]
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map(({ item, score, contributions, ranks }) => ({
      ...item,
      score,
      via: [...contributions.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name).join("+"),
      ranks,
    }));
}

// The best possible RRF score for these lists: rank 1 in every list, i.e. Σ w / (k + 1).
export function maxRrfScore(lists = [], { k = RRF_K, weights = {} } = {}) {
  return lists.reduce((sum, list) => {
    const weight = weights[list?.via || "unknown"] ?? 1;
    return weight > 0 && list?.items?.length ? sum + weight / (k + 1) : sum;
  }, 0);
}

// Scales `key` into 0..1 by dividing by `max` (defaults to the largest value present)
// and clamping. Returns new objects; the input is not mutated.
export function normalizeScores(items = [], { key = "score", max } = {}) {
  const top = max ?? items.reduce((m, item) => Math.max(m, Number(item?.[key]) || 0), 0);
  if (!(top > 0)) return items.map((item) => ({ ...item, [key]: 0 }));
  return items.map((item) => {
    const value = (Number(item?.[key]) || 0) / top;
    return { ...item, [key]: Math.min(1, Math.max(0, Math.round(value * 1e6) / 1e6)) };
  });
}
