import { test } from "node:test";
import assert from "node:assert/strict";
import { tabToSlug, slugToTab, SLUG_TO_TAB, parentSectionOf } from "./tabs.js";
import { NAV_TREE } from "./nav_tree.js";

test("every nav title round-trips through its slug", () => {
  const titles = NAV_TREE.flatMap((s) => [s.title, ...(s.subItems || []).map((i) => i.title)]);
  for (const t of titles) assert.equal(slugToTab(tabToSlug(t)), t);
  assert.equal(new Set(titles.map(tabToSlug)).size, titles.length);
});

test("slug format", () => {
  assert.equal(tabToSlug("Usage & Costs"), "usagecosts");
  assert.equal(SLUG_TO_TAB.allknowledgebases, "All Knowledge Bases");
});

test("parent section lookup", () => {
  assert.equal(parentSectionOf("Entities"), "Knowledge Graph");
  assert.equal(parentSectionOf("Overview"), "Overview");
});
