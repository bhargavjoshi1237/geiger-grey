import { test } from "node:test";
import assert from "node:assert/strict";
import { RRF_K, fuseRrf, maxRrfScore, normalizeScores, poolSize } from "./fusion.js";

const ids = (rows) => rows.map((r) => r.chunkId);

test("poolSize: 5x topK clamped to 30..100", () => {
  assert.equal(poolSize(1), 30);
  assert.equal(poolSize(6), 30);
  assert.equal(poolSize(10), 50);
  assert.equal(poolSize(50), 100);
  assert.equal(poolSize(undefined), 30);
});

test("fuseRrf: dedupes across lists and sums reciprocal ranks", () => {
  const fused = fuseRrf([
    { via: "vector", items: [{ chunkId: "a" }, { chunkId: "b" }, { chunkId: "c" }] },
    { via: "text", items: [{ chunkId: "b" }, { chunkId: "d" }] },
  ]);
  assert.deepEqual(ids(fused), ["b", "a", "d", "c"]);
  const b = fused[0];
  assert.equal(b.score, 1 / (RRF_K + 2) + 1 / (RRF_K + 1));
  assert.deepEqual(b.ranks, { vector: 2, text: 1 });
  assert.equal(b.via, "text+vector");
  assert.equal(fused[1].via, "vector");
});

test("fuseRrf: keeps the first list's fields for a duplicated chunk", () => {
  const fused = fuseRrf([
    { via: "vector", items: [{ chunkId: "a", content: "from vector" }] },
    { via: "text", items: [{ chunkId: "a", content: "from text" }] },
  ]);
  assert.equal(fused.length, 1);
  assert.equal(fused[0].content, "from vector");
});

test("fuseRrf: weights scale a list's contribution (graph at 0.5)", () => {
  const fused = fuseRrf(
    [
      { via: "graph", items: [{ chunkId: "g" }] },
      { via: "vector", items: [{ chunkId: "v" }] },
    ],
    { weights: { graph: 0.5 } },
  );
  assert.deepEqual(ids(fused), ["v", "g"]);
  assert.equal(fused[1].score, 0.5 / (RRF_K + 1));
});

test("fuseRrf: ties keep first-appearance order; duplicates inside one list count once", () => {
  const fused = fuseRrf([
    { via: "vector", items: [{ chunkId: "x" }, { chunkId: "x" }] },
    { via: "vector", items: [{ chunkId: "y" }] },
  ]);
  assert.deepEqual(ids(fused), ["x", "y"]);
  assert.equal(fused[0].score, fused[1].score);
});

test("fuseRrf: empty / missing input", () => {
  assert.deepEqual(fuseRrf([]), []);
  assert.deepEqual(fuseRrf([{ via: "text", items: [] }, null]), []);
  assert.deepEqual(fuseRrf([{ via: "text", items: [{ content: "no id" }] }]), []);
});

test("maxRrfScore counts only non-empty lists", () => {
  const lists = [
    { via: "vector", items: [{ chunkId: "a" }] },
    { via: "text", items: [] },
    { via: "graph", items: [{ chunkId: "b" }] },
  ];
  assert.equal(maxRrfScore(lists, { weights: { graph: 0.5 } }), 1.5 / (RRF_K + 1));
});

test("normalizeScores: scales into 0..1 against max", () => {
  const lists = [
    { via: "vector", items: [{ chunkId: "a" }, { chunkId: "b" }] },
    { via: "text", items: [{ chunkId: "a" }] },
  ];
  const fused = fuseRrf(lists);
  const normalized = normalizeScores(fused, { max: maxRrfScore(lists) });
  assert.equal(normalized[0].score, 1);
  assert.ok(normalized[1].score > 0 && normalized[1].score < 1);
  assert.notEqual(normalized[0], fused[0]);
});

test("normalizeScores: defaults to the largest value and handles zeros", () => {
  assert.deepEqual(normalizeScores([{ score: 2 }, { score: 1 }]), [{ score: 1 }, { score: 0.5 }]);
  assert.deepEqual(normalizeScores([{ score: 0 }]), [{ score: 0 }]);
  assert.deepEqual(normalizeScores([{ score: 5 }], { max: 2 }), [{ score: 1 }]);
});
