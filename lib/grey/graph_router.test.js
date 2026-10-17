import { test } from "node:test";
import assert from "node:assert/strict";
import { formatFacts, hasRelationalCue, shouldUseGraph } from "./graph_router.js";

test("shouldUseGraph: off never expands", () => {
  assert.equal(shouldUseGraph("How is Acme related to Globex?", { mode: "off", matchedCount: 3 }), false);
  assert.equal(shouldUseGraph("anything", { matchedCount: 3 }), false); // default mode is off
});

test("shouldUseGraph: always expands whenever something matched", () => {
  assert.equal(shouldUseGraph("Acme", { mode: "always", matchedCount: 1 }), true);
  assert.equal(shouldUseGraph("Acme", { mode: "always", matchedCount: 0 }), false);
});

test("shouldUseGraph: auto needs two entities or one plus a relational cue", () => {
  assert.equal(shouldUseGraph("Acme and Globex pricing", { mode: "auto", matchedCount: 2 }), true);
  assert.equal(shouldUseGraph("What is the Acme refund policy?", { mode: "auto", matchedCount: 1 }), false);
  assert.equal(shouldUseGraph("Who works with Jane Smith?", { mode: "auto", matchedCount: 1 }), true);
  assert.equal(shouldUseGraph("Summarise everything about Acme", { mode: "auto", matchedCount: 1 }), true);
  assert.equal(shouldUseGraph("How is Acme connected to the merger?", { mode: "auto", matchedCount: 1 }), true);
  assert.equal(shouldUseGraph("Who works with Jane Smith?", { mode: "auto", matchedCount: 0 }), false);
  assert.equal(shouldUseGraph("Who?", { mode: "auto", matchedCount: "nope" }), false);
});

test("hasRelationalCue matches whole words only", () => {
  for (const q of [
    "difference between plans",
    "relationship of A and B",
    "which teams are involved",
    "list every vendor",
    "how many offices across Europe",
    "an overview please",
    "what depends on the billing service",
    "compare the two contracts",
    "people linked to the project",
    "Jane works at Acme",
  ]) {
    assert.equal(hasRelationalCue(q), true, q);
  }
  for (const q of ["the refund policy", "ballistic overall listing", "a connector cable", "whose turn"]) {
    assert.equal(hasRelationalCue(q), false, q);
  }
});

test("formatFacts renders one line per fact, de-duplicated", () => {
  const text = formatFacts([
    { subject: "Jane Smith", relation: "works_at", object: "Acme", confidence: 0.9 },
    { subject: "Jane Smith", relation: "works_at", object: "Acme", confidence: 0.7 },
    { subject: "Acme", relation: "located_in", object: "Berlin" },
    { subject: "Acme", relation: "CEO of", object: "" },
    { subject: "Line\nBreak", relation: "part_of", object: "  Group  " },
  ]);
  assert.equal(text, "- Jane Smith → works at → Acme\n- Acme → located in → Berlin\n- Line Break → part of → Group");
});

test("formatFacts returns an empty string when there is nothing to show", () => {
  assert.equal(formatFacts([]), "");
  assert.equal(formatFacts(null), "");
});

test("formatFacts caps the list at 20 lines", () => {
  const facts = Array.from({ length: 30 }, (_, i) => ({ subject: `E${i}`, relation: "related_to", object: "X" }));
  assert.equal(formatFacts(facts).split("\n").length, 20);
});
