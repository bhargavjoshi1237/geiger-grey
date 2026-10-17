import { test } from "node:test";
import assert from "node:assert/strict";
import { contextCitations, mapCitations, parseCitationIndices, toCitation } from "./citations.js";

const chunks = [
  { chunkId: "c1", sourceId: "s1", sourceName: "Handbook", content: "Refunds take 5 days.", page: 3, startMs: null },
  { chunkId: "c2", sourceId: "s2", sourceName: "Call", content: "We discussed pricing.", page: null, startMs: 61_000 },
  { chunkId: "c3", sourceId: "s1", sourceName: "Handbook", content: "x".repeat(400), page: 9, startMs: null },
];

test("parseCitationIndices: [1], [1, 2] and [1][2], de-duplicated in first-appearance order", () => {
  assert.deepEqual(parseCitationIndices("A [2]. B [1, 3]. C [3][2]."), [2, 1, 3]);
  assert.deepEqual(parseCitationIndices("no markers"), []);
  assert.deepEqual(parseCitationIndices(null), []);
});

test("mapCitations: maps to the UI shape and drops out-of-range markers", () => {
  const citations = mapCitations("Refunds take five days [1][7]. Pricing came up [2, 0].", chunks);
  assert.deepEqual(citations, [
    { index: 1, sourceId: "s1", chunkId: "c1", title: "Handbook", page: 3, startMs: null, snippet: "Refunds take 5 days." },
    { index: 2, sourceId: "s2", chunkId: "c2", title: "Call", page: null, startMs: 61_000, snippet: "We discussed pricing." },
  ]);
});

test("mapCitations: empty when nothing is cited or there is no context", () => {
  assert.deepEqual(mapCitations("Plain answer.", chunks), []);
  assert.deepEqual(mapCitations("Answer [1].", []), []);
});

test("toCitation: snippets are trimmed to 300 characters", () => {
  const citation = toCitation(chunks[2], 3);
  assert.equal(citation.snippet.length, 301);
  assert.ok(citation.snippet.endsWith("…"));
});

test("contextCitations: every chunk, numbered from 1", () => {
  assert.deepEqual(contextCitations(chunks).map((c) => [c.index, c.chunkId]), [[1, "c1"], [2, "c2"], [3, "c3"]]);
});
