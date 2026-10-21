import { test } from "node:test";
import assert from "node:assert/strict";
import { voteLabels } from "./knn_vote.js";

const n = (sourceId, score, labels) => ({ sourceId, score, labels });

test("voteLabels: score-weighted vote with canonical spelling and evidence", () => {
  const result = voteLabels(
    [n("s1", 0.9, ["CAT"]), n("s2", 0.8, ["cat", "indoor"]), n("s3", 0.5, ["Dog"]), n("s4", 0.4, [])],
    ["Cat", "Dog"],
  );
  assert.equal(result.label, "Cat");
  assert.equal(result.decided, true);
  assert.equal(result.reason, "ok");
  // Cat 1.7, Dog 0.5, total 2.2
  assert.equal(result.confidence, Math.round((1.7 / 2.2) * 10000) / 10000);
  assert.equal(result.margin, Math.round((1.2 / 2.2) * 10000) / 10000);
  assert.deepEqual(result.votes, [
    { label: "Cat", weight: 1.7, count: 2 },
    { label: "Dog", weight: 0.5, count: 1 },
  ]);
  assert.deepEqual(result.evidence, ["s1", "s2"]);
});

test("voteLabels: a neighbour with several allowed labels splits its score", () => {
  const result = voteLabels([n("s1", 0.8, ["cat", "dog"]), n("s2", 0.3, ["dog"])], ["cat", "dog"], { minMargin: 0 });
  assert.deepEqual(result.votes, [
    { label: "dog", weight: 0.7, count: 2 },
    { label: "cat", weight: 0.4, count: 1 },
  ]);
  assert.equal(result.label, "dog");
  assert.deepEqual(result.evidence, ["s1", "s2"]);
});

test("voteLabels: only the top k labelled neighbours at or above minScore vote", () => {
  const neighbors = [
    n("s1", 0.9, ["unrelated"]), // no allowed label: doesn't use up a k slot
    n("s2", 0.8, ["a"]),
    n("s3", 0.7, ["b"]),
    n("s4", 0.6, ["b"]),
    n("s5", 0.2, ["b"]),
  ];
  const top2 = voteLabels(neighbors, ["a", "b"], { k: 2, minMargin: 0 });
  assert.deepEqual(top2.votes.map((v) => [v.label, v.count]), [["a", 1], ["b", 1]]);
  assert.equal(top2.label, "a");

  const floor = voteLabels(neighbors, ["a", "b"], { k: 10, minScore: 0.65, minMargin: 0 });
  assert.deepEqual(floor.votes.map((v) => [v.label, v.count]), [["a", 1], ["b", 1]]);
});

test("voteLabels: ties break by count, then by label order in allowed", () => {
  const byCount = voteLabels([n("s1", 0.6, ["a"]), n("s2", 0.3, ["b"]), n("s3", 0.3, ["b"])], ["a", "b"], { minMargin: 0 });
  assert.equal(byCount.votes[0].label, "b", "equal weight (0.6), b has two votes");
  assert.equal(byCount.margin, 0);
  assert.equal(byCount.decided, true, "a zero margin decides when minMargin is 0");

  const byOrder = voteLabels([n("s1", 0.5, ["b"]), n("s2", 0.5, ["a"])], ["a", "b"], { minMargin: 0 });
  assert.equal(byOrder.label, "a");
});

test("voteLabels: low margin is undecided but still reports the leader", () => {
  const result = voteLabels([n("s1", 0.8, ["a"]), n("s2", 0.75, ["b"])], ["a", "b"]);
  assert.equal(result.decided, false);
  assert.equal(result.reason, "low_margin");
  assert.equal(result.label, "a");
  assert.ok(result.margin < 0.15);
  assert.deepEqual(result.evidence, ["s1"]);
});

test("voteLabels: margin exactly at minMargin decides", () => {
  // a 0.3, b 0.15, c 0.55 → c leads 0.55 vs 0.3 → margin 0.25 / 1.0
  const result = voteLabels([n("s1", 0.55, ["c"]), n("s2", 0.3, ["a"]), n("s3", 0.15, ["b"])], ["a", "b", "c"], { minMargin: 0.25 });
  assert.equal(result.label, "c");
  assert.equal(result.margin, 0.25);
  assert.equal(result.decided, true);
});

test("voteLabels: no labelled neighbours", () => {
  const empty = { label: null, confidence: 0, margin: 0, decided: false, reason: "no_labeled_neighbors", votes: [], evidence: [] };
  assert.deepEqual(voteLabels([], ["a"]), empty);
  assert.deepEqual(voteLabels([n("s1", 0.9, ["x"]), n("s2", 0.8, null)], ["a"]), empty);
  assert.deepEqual(voteLabels([n("s1", 0.1, ["a"])], ["a"], { minScore: 0.5 }), empty);
  assert.deepEqual(voteLabels(null, null), empty);
});

test("voteLabels: a single label wins outright", () => {
  const result = voteLabels([n("s1", 0.4, ["a"]), n("s2", 0.2, ["a"])], ["a", "b"]);
  assert.equal(result.confidence, 1);
  assert.equal(result.margin, 1);
  assert.equal(result.decided, true);
});
