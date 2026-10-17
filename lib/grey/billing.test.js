import { test } from "node:test";
import assert from "node:assert/strict";
import { billablePages, byokUsage, mediaUsage, pageUnitPrice, pageUsage, sumCost, tierUsed, USAGE_MERGE } from "./billing.js";

const prices = { perPage: 0.006 };

test("billable pages: paginated counts pages, flowing formats count ~500 tokens per page", () => {
  assert.equal(billablePages({ paginated: true, pageCount: 12 }), 12);
  assert.equal(billablePages({ paginated: false, tokenCount: 1 }), 1);
  assert.equal(billablePages({ paginated: false, tokenCount: 1001 }), 3);
  assert.equal(billablePages({ paginated: false, tokenCount: 0 }), 0);
});

test("a layout preset served by the text engine is billed at the Fast tier", () => {
  assert.equal(tierUsed({ tier: "balanced", tierDowngraded: true }), "fast");
  assert.equal(pageUnitPrice({ tier: "balanced", prices, tierDowngraded: true }), 0.002);
  assert.equal(pageUnitPrice({ tier: "balanced", prices, tierDowngraded: false }), 0.006);
  // never more than the preset's own price
  assert.equal(pageUnitPrice({ tier: "custom", prices: { perPage: 0.001 }, tierDowngraded: true }), 0.001);
  // missing price falls back to the system tier price
  assert.equal(pageUnitPrice({ tier: "high", prices: {} }), 0.02);
});

test("page usage row", () => {
  const row = pageUsage({ pages: 10, tier: "fast", prices: { perPage: 0.002 } });
  assert.deepEqual(row, { kind: "page", quantity: 10, unitCost: 0.002, cost: 0.02, metadata: { tier: "fast", cached: false } });
});

test("a cached parse is billed 0 pages", () => {
  const row = pageUsage({ pages: 10, cached: true, tier: "fast", prices: { perPage: 0.002 } });
  assert.equal(row.quantity, 0);
  assert.equal(row.cost, 0);
  assert.equal(row.metadata.cached, true);
  assert.equal(pageUsage({ pages: 0, tier: "fast", prices }), null);
});

test("BYOK kinds record quantity at cost 0", () => {
  const row = byokUsage("graph_tokens", 1234, { model: "m" });
  assert.deepEqual(row, { kind: "graph_tokens", quantity: 1234, unitCost: 0, cost: 0, metadata: { model: "m", byok: true } });
  assert.equal(byokUsage("contextual_tokens", 0), null);
  assert.throws(() => byokUsage("page", 1));
});

test("media minutes", () => {
  const row = mediaUsage({ durationMs: 90_000, provider: "assemblyai" });
  assert.equal(row.kind, "media_minute");
  assert.equal(row.quantity, 1.5);
  assert.equal(row.cost, 0);
  assert.equal(row.metadata.byok, true);
  assert.equal(row.metadata.provider, "assemblyai");
});

test("sumCost and merge rules", () => {
  assert.equal(sumCost([{ cost: 0.1 }, null, { cost: 0.2 }]), 0.3);
  assert.equal(USAGE_MERGE.page, "first");
  assert.equal(USAGE_MERGE.graph_tokens, "add");
});
