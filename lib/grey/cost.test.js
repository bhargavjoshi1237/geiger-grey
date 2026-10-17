import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateFileCost, estimateTotal, PRICE_PER_RETRIEVAL } from "./cost.js";

const preset = (tier, extra = {}) => ({
  tier,
  config: {
    media: { keyframes: false }, graph: { extract: false }, enrichment: { contextual: false },
    prices: { perPage: { fast: 0.002, balanced: 0.006, high: 0.02, auto: 0.006 }[tier], perMediaMinute: 0.006, perKeyframeMinute: 0.04, perMillionTokensGraph: 0.5, perMillionTokensContextual: 1.02 },
    ...extra,
  },
});
const doc = { kind: "document", pageCount: 100, tokenCount: 50_000 };

test("document priced per page", () => {
  const r = estimateFileCost(doc, preset("balanced"));
  assert.equal(r.low, 0.6); assert.equal(r.high, 0.6);
});
test("auto gives a fast-to-high range", () => {
  const r = estimateFileCost(doc, preset("auto"));
  assert.equal(r.low, 0.2); assert.equal(r.high, 2);
});
test("video with keyframes adds visual cost", () => {
  const p = preset("balanced", { media: { keyframes: true } });
  const r = estimateFileCost({ kind: "video", durationMs: 600_000, tokenCount: 0 }, p);
  assert.equal(Number(r.low.toFixed(4)), 0.46);
});
test("graph extraction priced on tokens", () => {
  const p = preset("fast", { graph: { extract: true } });
  const r = estimateFileCost({ kind: "document", pageCount: 10, tokenCount: 2_000_000 }, p);
  assert.equal(Number(r.low.toFixed(4)), 1.02);
});
test("total sums low and high", () => {
  const t = estimateTotal([doc, doc], preset("auto"));
  assert.equal(t.low, 0.4); assert.equal(t.high, 4);
});
test("retrievals cost a tenth of a cent", () => {
  assert.equal(PRICE_PER_RETRIEVAL, 0.001);
});
