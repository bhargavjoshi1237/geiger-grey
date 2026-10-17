import { test } from "node:test";
import assert from "node:assert/strict";
import { findDuplicateGroups, normalizeName } from "./duplicates.js";

test("normalizeName strips suffixes and punctuation", () => {
  assert.equal(normalizeName("Acme, Inc."), "acme");
  assert.equal(normalizeName("  Zoë   Smith "), "zoe smith");
});
// These cases mirror grey.normalize_entity_name (migration 20261018120300), which resolves
// extracted entities in SQL with the same rules.
test("normalizeName strips diacritics", () => {
  assert.equal(normalizeName("Crème Brûlée"), "creme brulee");
  assert.equal(normalizeName("São Paulo"), "sao paulo");
  assert.equal(normalizeName("ÅNGSTRÖM"), "angstrom");
  assert.equal(normalizeName("Zoé"), "zoe"); // already-decomposed accent
});
test("normalizeName drops trailing corporate suffixes but never the whole name", () => {
  assert.equal(normalizeName("Acme Corp"), "acme");
  assert.equal(normalizeName("Acme Co. Inc."), "acme");
  assert.equal(normalizeName("Globex LLC"), "globex");
  assert.equal(normalizeName("Initech Ltd"), "initech");
  assert.equal(normalizeName("Inc"), "inc");
  assert.equal(normalizeName("Co Inc"), "co");
  assert.equal(normalizeName("Corp Acme"), "corp acme"); // only trailing suffixes
  assert.equal(normalizeName("Acme Corporation"), "acme corporation"); // not a listed suffix
});
test("normalizeName turns punctuation into word breaks", () => {
  assert.equal(normalizeName("O'Brien & Sons"), "o brien sons");
  assert.equal(normalizeName("I.B.M."), "i b m");
  assert.equal(normalizeName("Café-Bar"), "cafe bar");
  assert.equal(normalizeName("Jane\tSmith\n"), "jane smith");
  assert.equal(normalizeName("!!!"), "");
  assert.equal(normalizeName(""), "");
  assert.equal(normalizeName(null), "");
});
test("normalizeName transliterates undecomposable Latin letters and keeps other scripts", () => {
  assert.equal(normalizeName("Straße"), "strasse");
  assert.equal(normalizeName("Ærø"), "aero");
  assert.equal(normalizeName("Łódź"), "lodz");
  assert.equal(normalizeName("Москва, Inc."), "москва");
  assert.equal(normalizeName("東京"), "東京");
});
test("non-Latin names can be flagged as duplicates", () => {
  const e = [
    { id: "1", typeId: "city", name: "Москва", aliases: [] },
    { id: "2", typeId: "city", name: "москва", aliases: [] },
  ];
  assert.deepEqual(findDuplicateGroups(e).map((g) => g.map((x) => x.id)), [["1", "2"]]);
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
