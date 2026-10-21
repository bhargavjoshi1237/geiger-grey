import { test } from "node:test";
import assert from "node:assert/strict";
import { classificationReport, retrievalReport } from "./tool_metrics.js";

test("classificationReport: accuracy, coverage, confusion and per-label precision / recall", () => {
  const report = classificationReport(
    [
      { expected: ["cat"], predicted: "cat" },
      { expected: ["CAT"], predicted: "dog" },
      { expected: ["dog"], predicted: "dog" },
      { expected: ["dog"], predicted: null },
      { expected: ["bird", "dog"], predicted: "Dog" }, // multi-label: correct, row is the matched label
      { expected: ["bird"], predicted: "cat" },
    ],
    ["cat", { value: "dog" }, "bird"],
  );
  assert.equal(report.total, 6);
  assert.equal(report.decided, 5);
  assert.equal(report.correct, 3);
  assert.equal(report.accuracy, 0.5);
  assert.equal(report.coverage, 0.8333);
  assert.deepEqual(report.confusion, {
    cat: { cat: 1, dog: 1 },
    dog: { dog: 2, uncertain: 1 },
    bird: { cat: 1 },
  });
  assert.deepEqual(report.perLabel, [
    { label: "cat", support: 2, precision: 0.5, recall: 0.5 },
    { label: "dog", support: 3, precision: 0.6667, recall: 0.6667 },
    { label: "bird", support: 2, precision: null, recall: 0 },
  ]);
});

test("classificationReport: empty input", () => {
  assert.deepEqual(classificationReport([], ["a"]), {
    total: 0,
    decided: 0,
    correct: 0,
    accuracy: null,
    coverage: null,
    confusion: {},
    perLabel: [{ label: "a", support: 0, precision: null, recall: null }],
  });
  assert.equal(classificationReport(null, null).total, 0);
});

test("retrievalReport: hit@k and MRR over neighbour labels", () => {
  const report = retrievalReport([
    { expected: ["rust"], neighbors: [["Rust"], ["dent"]] }, // rank 1
    { expected: ["dent"], neighbors: [["rust"], [], ["dent", "rust"]] }, // rank 3
    { expected: ["crack"], neighbors: [["rust"], ["dent"]] }, // miss
    { expected: ["rust", "dent"], neighbors: [["x"], ["dent"]] }, // rank 2
  ]);
  assert.equal(report.total, 4);
  assert.equal(report.hitAtK, 0.75);
  assert.equal(report.mrr, Math.round(((1 + 1 / 3 + 0 + 1 / 2) / 4) * 10000) / 10000);
  assert.deepEqual(retrievalReport([]), { total: 0, hitAtK: null, mrr: null });
  assert.deepEqual(retrievalReport([{ expected: [], neighbors: [["a"]] }]), { total: 1, hitAtK: 0, mrr: 0 });
});
