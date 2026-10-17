import { test } from "node:test";
import assert from "node:assert/strict";
import { batchByTokens, estimateTokens, runOrdered } from "./batch.js";

const chunk = (id, tokens) => ({ id, token_count: tokens, content: "x" });
const ids = (batches) => batches.map((b) => b.map((c) => c.id));

test("batchByTokens packs in order without exceeding the budget", () => {
  const batches = batchByTokens([chunk("a", 3000), chunk("b", 2500), chunk("c", 1000), chunk("d", 6000), chunk("e", 1)], 6000);
  assert.deepEqual(ids(batches), [["a", "b"], ["c"], ["d"], ["e"]]);
});

test("batchByTokens gives an oversized item its own batch", () => {
  assert.deepEqual(ids(batchByTokens([chunk("a", 10), chunk("b", 9000), chunk("c", 10)], 6000)), [["a"], ["b"], ["c"]]);
});

test("batchByTokens estimates tokens from content when no count is stored", () => {
  const items = [{ id: "a", content: "x".repeat(40) }, { id: "b", content: "x".repeat(40) }, { id: "c", content: "x".repeat(40) }];
  assert.equal(estimateTokens("x".repeat(40)), 10);
  assert.deepEqual(ids(batchByTokens(items, 20)), [["a", "b"], ["c"]]);
});

test("batchByTokens handles empty input and custom counters", () => {
  assert.deepEqual(batchByTokens([], 100), []);
  assert.deepEqual(batchByTokens(null, 100), []);
  assert.deepEqual(batchByTokens([1, 2, 3, 4], 5, { countTokens: (n) => n }), [[1, 2], [3], [4]]);
});

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("runOrdered settles in index order with bounded concurrency", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const settled = [];
  const durations = [30, 5, 20, 1, 15, 2, 8];
  const count = await runOrdered(durations.length, {
    concurrency: 3,
    start: async (i) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await delay(durations[i]);
      inFlight -= 1;
      return i * 10;
    },
    settle: (i, outcome) => {
      settled.push([i, outcome.value]);
    },
  });
  assert.equal(count, durations.length);
  assert.deepEqual(settled.map(([i]) => i), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(settled.map(([, v]) => v), [0, 10, 20, 30, 40, 50, 60]);
  assert.ok(maxInFlight <= 3);
  assert.equal(maxInFlight, 3);
});

test("runOrdered starts lazily so later items see earlier settled state", async () => {
  const seenAtStart = [];
  const settledSoFar = [];
  await runOrdered(5, {
    concurrency: 2,
    start: async (i) => {
      seenAtStart[i] = settledSoFar.length;
      return i;
    },
    settle: (i) => {
      settledSoFar.push(i);
    },
  });
  // Items 0 and 1 start together; item n (n ≥ 2) starts once item n-2 has settled.
  assert.deepEqual(seenAtStart, [0, 0, 1, 2, 3]);
});

test("runOrdered reports failures and stops when settle returns false", async () => {
  const started = [];
  const outcomes = [];
  const count = await runOrdered(10, {
    concurrency: 2,
    start: async (i) => {
      started.push(i);
      if (i === 1) throw new Error("boom");
      return i;
    },
    settle: (i, outcome) => {
      outcomes.push(outcome.ok ? "ok" : outcome.error.message);
      return outcome.ok;
    },
  });
  // Item 2 had already started (after item 0 settled), so it is still awaited and settled; nothing
  // new starts after the failure.
  assert.deepEqual(outcomes, ["ok", "boom", "ok"]);
  assert.equal(count, 3);
  assert.deepEqual(started, [0, 1, 2]);
});

test("runOrdered stops starting when shouldStop turns true and still settles started items", async () => {
  let stop = false;
  const settled = [];
  const count = await runOrdered(10, {
    concurrency: 3,
    shouldStop: () => stop,
    start: async (i) => i,
    settle: (i) => {
      settled.push(i);
      if (i === 1) stop = true;
    },
  });
  assert.deepEqual(settled, [0, 1, 2, 3]);
  assert.equal(count, 4);
});
