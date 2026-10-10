import { test } from "node:test";
import assert from "node:assert/strict";
import { findDuplicateGroups, normalizeName } from "./duplicates.js";

test("normalizeName strips suffixes and punctuation", () => {
  assert.equal(normalizeName("Acme, Inc."), "acme");
  assert.equal(normalizeName("  Zoë   Smith "), "zoe smith");
});
test("groups by normalized name within a type", () => {
  const e = [
    { id: "1", typeId: "org", name: "Acme Inc", aliases: [] },
    { id: "2", typeId: "org", name: "ACME", aliases: [] },
    { id: "3", typeId: "person", name: "Acme", aliases: [] },
    { id: "4", typeId: "org", name: "Globex", aliases: ["Acme Corp"] },
  ];
  const groups = findDuplicateGroups(e).map((g) => g.map((x) => x.id).sort());
  assert.deepEqual(groups, [["1", "2", "4"]]);
});
test("ignores merged entities", () => {
  const e = [{ id: "1", typeId: "t", name: "A", aliases: [] }, { id: "2", typeId: "t", name: "a", aliases: [], mergedInto: "1" }];
  assert.deepEqual(findDuplicateGroups(e), []);
});
