// Token-budget batching and an ordered, bounded-concurrency runner. Pure (no I/O).

// Rough token estimate for text without a stored count (~4 characters per token).
export function estimateTokens(text) {
  return Math.ceil(String(text ?? "").length / 4);
}

function defaultCount(item) {
  const stored = Number(item?.token_count ?? item?.tokenCount);
  return Number.isFinite(stored) && stored > 0 ? stored : estimateTokens(item?.content);
}

// Packs items, in order, into batches whose token total stays within maxTokens.
// An item larger than maxTokens on its own forms a single-item batch.
export function batchByTokens(items, maxTokens, { countTokens = defaultCount } = {}) {
  const limit = Math.max(1, Number(maxTokens) || 1);
  const batches = [];
  let current = [];
  let used = 0;
  for (const item of items || []) {
    const tokens = Math.max(0, countTokens(item) || 0);
    if (current.length && used + tokens > limit) {
      batches.push(current);
      current = [];
      used = 0;
    }
    current.push(item);
    used += tokens;
  }
  if (current.length) batches.push(current);
  return batches;
}

// Runs start(i) for i = 0..count-1 with at most `concurrency` calls outstanding, and hands each
// outcome — { ok: true, value } | { ok: false, error } — to settle(i, outcome) strictly in index order.
// start(i) is invoked lazily, so it can read state produced by earlier settle() calls.
// settle() returning false, or shouldStop() returning true, stops new starts; items already started
// are still awaited (and settled) so nothing is left running. Resolves to the number of items settled.
export async function runOrdered(count, { concurrency = 3, start, settle, shouldStop = () => false }) {
  const pending = new Map();
  const limit = Math.max(1, concurrency);
  let next = 0;
  let stopped = false;

  const launch = () => {
    while (!stopped && next < count && pending.size < limit) {
      if (shouldStop()) {
        stopped = true;
        break;
      }
      const index = next;
      next += 1;
      pending.set(
        index,
        Promise.resolve()
          .then(() => start(index))
          .then(
            (value) => ({ ok: true, value }),
            (error) => ({ ok: false, error }),
          ),
      );
    }
  };

  launch();
  let settled = 0;
  for (let index = 0; index < count && pending.has(index); index += 1) {
    const outcome = await pending.get(index);
    pending.delete(index);
    if ((await settle(index, outcome)) === false) stopped = true;
    settled += 1;
    launch();
  }
  return settled;
}
