import { test } from "node:test";
import assert from "node:assert/strict";
import { toJSONSchema } from "zod";
import {
  aggregateMetrics,
  buildJudgePrompt,
  buildJudgeSchema,
  clampScore,
  judgePlan,
  meanIgnoringNulls,
  normalizeJudgement,
  parseJudgeText,
  rankWeightedPrecision,
  scoreCase,
  shareTrue,
  sourceRecall,
  sourceRelevance,
} from "./eval_metrics.js";

const chunk = (sourceId, extra = {}) => ({ chunkId: `c-${sourceId}-${Math.random()}`, sourceId, sourceName: `Doc ${sourceId}`, content: `About ${sourceId}.`, page: null, startMs: null, ...extra });

test("clampScore keeps 0..1, reads percentages, rejects non-numbers", () => {
  assert.equal(clampScore(0.42), 0.42);
  assert.equal(clampScore("0.5"), 0.5);
  assert.equal(clampScore(85), 0.85);
  assert.equal(clampScore(-0.2), 0);
  assert.equal(clampScore(250), 1);
  assert.equal(clampScore(null), null);
  assert.equal(clampScore(undefined), null);
  assert.equal(clampScore(""), null);
  assert.equal(clampScore(true), null);
  assert.equal(clampScore("high"), null);
});

test("meanIgnoringNulls and shareTrue skip missing values", () => {
  assert.equal(meanIgnoringNulls([1, null, 0.5, undefined, NaN]), 0.75);
  assert.equal(meanIgnoringNulls([null, undefined]), null);
  assert.equal(meanIgnoringNulls([]), null);
  assert.equal(meanIgnoringNulls([1 / 3, 1 / 3, 1 / 3]), 0.3333);
  assert.equal(shareTrue([true, false, true, true]), 0.75);
  assert.equal(shareTrue([]), null);
  assert.equal(shareTrue(null), null);
});

test("rankWeightedPrecision rewards relevant chunks ranked first", () => {
  assert.equal(rankWeightedPrecision([true, true, false]), 1);
  assert.equal(rankWeightedPrecision([false, true]), 0.5);
  // (1/1 + 2/3) / 2
  assert.equal(rankWeightedPrecision([true, false, true]), (1 + 2 / 3) / 2);
  assert.ok(rankWeightedPrecision([true, false, false]) > rankWeightedPrecision([false, false, true]));
  assert.equal(rankWeightedPrecision([false, false]), 0);
  assert.equal(rankWeightedPrecision([]), null);
});

test("source-based relevance and recall use distinct expected source ids", () => {
  const retrieved = [chunk("a"), chunk("x"), chunk("a"), chunk("b")];
  assert.deepEqual(sourceRelevance(retrieved, ["a", "b"]), [true, false, true, true]);
  assert.equal(sourceRecall(retrieved, ["a", "b", "c", "a"]), 2 / 3);
  assert.equal(sourceRecall([], ["a"]), 0);
  assert.equal(sourceRecall(retrieved, []), null);
  assert.equal(sourceRecall(retrieved, null), null);
});

test("judgePlan: expected sources skip judge labels; expected answer drives recall", () => {
  assert.deepEqual(judgePlan({ expectedSourceIds: ["a"], expectedAnswer: "Yes.", retrievedCount: 3 }), {
    labelPassages: false,
    checkExpected: false,
  });
  assert.deepEqual(judgePlan({ expectedSourceIds: [], expectedAnswer: "Yes.", retrievedCount: 3 }), {
    labelPassages: true,
    checkExpected: true,
  });
  assert.deepEqual(judgePlan({ expectedSourceIds: [], expectedAnswer: "  ", retrievedCount: 0 }), {
    labelPassages: false,
    checkExpected: false,
  });
});

test("buildJudgeSchema only asks for what the plan needs, every field required", () => {
  const base = toJSONSchema(buildJudgeSchema());
  assert.deepEqual(Object.keys(base.properties).sort(), ["answerRelevance", "claims"]);
  assert.deepEqual([...base.required].sort(), ["answerRelevance", "claims"]);

  const full = toJSONSchema(buildJudgeSchema({ labelPassages: true, checkExpected: true }));
  assert.deepEqual(Object.keys(full.properties).sort(), ["answerRelevance", "claims", "expectedStatements", "passages"]);
  assert.deepEqual([...full.required].sort(), ["answerRelevance", "claims", "expectedStatements", "passages"]);

  const parsed = buildJudgeSchema({ labelPassages: true }).parse({
    claims: [{ statement: "X is 5.", supported: true }],
    answerRelevance: 0.9,
    passages: [{ index: 1, relevant: true }],
  });
  assert.equal(parsed.passages[0].relevant, true);
});

test("buildJudgePrompt numbers passages, tags data and lists only the requested tasks", () => {
  const chunks = [chunk("a", { content: "Refunds take 5 days.", page: 2 }), chunk("b", { content: "Shipping is free." })];
  const facts = [{ subject: "Acme", relation: "works_with", object: "Globex", confidence: 0.9 }];
  const out = buildJudgePrompt({
    question: "How long do refunds take?",
    answer: "Refunds take 5 days [1].",
    chunks,
    facts,
    expectedAnswer: "Five business days.",
    labelPassages: true,
    checkExpected: true,
  });
  assert.equal(out.chunks.length, 2);
  assert.match(out.prompt, /<question>\nHow long do refunds take\?\n<\/question>/);
  assert.match(out.prompt, /\[1\] Doc a — p\. 2\nRefunds take 5 days\./);
  assert.match(out.prompt, /\[2\] Doc b\nShipping is free\./);
  assert.match(out.prompt, /<known_relationships>\n- Acme → works with → Globex/);
  assert.match(out.prompt, /<answer>\nRefunds take 5 days \[1\]\.\n<\/answer>/);
  assert.match(out.prompt, /<reference_answer>\nFive business days\.\n<\/reference_answer>/);
  assert.match(out.instructions, /1\. claims:/);
  assert.match(out.instructions, /2\. answerRelevance:/);
  assert.match(out.instructions, /3\. passages: for each passage 1 to 2/);
  assert.match(out.instructions, /4\. expectedStatements:/);
  const shape = JSON.parse(out.instructions.match(/shaped like: (\{.*\})$/m)[1]);
  assert.deepEqual(Object.keys(shape), ["claims", "answerRelevance", "passages", "expectedStatements"]);

  const bare = buildJudgePrompt({ question: "Q?", answer: "I couldn't find anything.", chunks: [], expectedAnswer: "Hidden" });
  assert.match(bare.prompt, /\(no passages were retrieved\)/);
  assert.doesNotMatch(bare.prompt, /reference_answer|Hidden|known_relationships/);
  assert.doesNotMatch(bare.instructions, /\d\. passages:|expectedStatements/);
  assert.deepEqual(Object.keys(JSON.parse(bare.instructions.match(/shaped like: (\{.*\})$/m)[1])), ["claims", "answerRelevance"]);
});

test("parseJudgeText recovers a JSON object from surrounding text", () => {
  assert.deepEqual(parseJudgeText('Here you go:\n```json\n{"claims": [], "answerRelevance": 1}\n```'), { claims: [], answerRelevance: 1 });
  assert.equal(parseJudgeText("no json"), null);
  assert.equal(parseJudgeText("{broken"), null);
  assert.equal(parseJudgeText(undefined), null);
});

test("normalizeJudgement tolerates any shape and maps passage labels by number", () => {
  const out = normalizeJudgement(
    {
      claims: [{ statement: " A ", supported: true }, { statement: "", supported: true }, { statement: "B", supported: "yes" }, null],
      answerRelevance: "0.8",
      passages: [{ index: 2, relevant: true }, { index: 9, relevant: true }, { index: "1", relevant: false }],
      expectedStatements: [{ statement: "C", supported: true }],
    },
    { passageCount: 3, labelPassages: true, checkExpected: true },
  );
  assert.deepEqual(out.claims, [
    { statement: "A", supported: true },
    { statement: "B", supported: false },
  ]);
  assert.equal(out.answerRelevance, 0.8);
  assert.deepEqual(out.passages, [false, true, false]);
  assert.deepEqual(out.expectedStatements, [{ statement: "C", supported: true }]);

  const empty = normalizeJudgement(null, { passageCount: 2 });
  assert.deepEqual(empty, { claims: [], answerRelevance: null, passages: null, expectedStatements: null });
});

test("scoreCase: expected sources decide precision and recall", () => {
  const retrieved = [chunk("x"), chunk("a"), chunk("b")];
  const judgement = normalizeJudgement({
    claims: [{ statement: "A", supported: true }, { statement: "B", supported: false }],
    answerRelevance: 0.9,
  });
  const { scores, basis } = scoreCase({ retrieved, expectedSourceIds: ["a", "c"], judgement });
  assert.deepEqual(scores, {
    faithfulness: 0.5,
    answerRelevance: 0.9,
    contextPrecision: 0.5, // only "a" (rank 2) is expected -> precision@2 = 1/2
    contextRecall: 0.5, // "a" found, "c" missing
  });
  assert.deepEqual(basis, { contextPrecision: "sources", contextRecall: "sources" });
});

test("scoreCase: judge labels and expected-answer statements as fallbacks", () => {
  const judgement = normalizeJudgement(
    {
      claims: [{ statement: "A", supported: true }],
      answerRelevance: 1,
      passages: [{ index: 1, relevant: true }, { index: 2, relevant: false }],
      expectedStatements: [
        { statement: "A", supported: true },
        { statement: "B", supported: true },
        { statement: "C", supported: false },
      ],
    },
    { passageCount: 2, labelPassages: true, checkExpected: true },
  );
  const { scores, basis } = scoreCase({ retrieved: [chunk("a"), chunk("b")], expectedSourceIds: [], judgement });
  assert.deepEqual(scores, { faithfulness: 1, answerRelevance: 1, contextPrecision: 1, contextRecall: 0.6667 });
  assert.deepEqual(basis, { contextPrecision: "judge", contextRecall: "expected_answer" });
});

test("scoreCase: no claims, no passages and no expectations give nulls", () => {
  const judgement = normalizeJudgement({ claims: [], answerRelevance: 0.1 });
  const { scores, basis } = scoreCase({ retrieved: [], expectedSourceIds: [], judgement });
  assert.deepEqual(scores, { faithfulness: null, answerRelevance: 0.1, contextPrecision: null, contextRecall: null });
  assert.deepEqual(basis, { contextPrecision: null, contextRecall: null });
});

test("scoreCase without a judgement still scores against expected sources", () => {
  const { scores } = scoreCase({ retrieved: [chunk("a")], expectedSourceIds: ["a"], judgement: null });
  assert.deepEqual(scores, { faithfulness: null, answerRelevance: null, contextPrecision: 1, contextRecall: 1 });
});

test("aggregateMetrics averages per metric ignoring nulls and carries counts", () => {
  const metrics = aggregateMetrics(
    [
      { faithfulness: 1, answerRelevance: 0.5, contextPrecision: null, contextRecall: 1 },
      { faithfulness: 0.5, answerRelevance: null, contextPrecision: null, contextRecall: 0 },
      null,
    ],
    { cases: 3, failed: 1 },
  );
  assert.deepEqual(metrics, {
    faithfulness: 0.75,
    answerRelevance: 0.5,
    contextPrecision: null,
    contextRecall: 0.5,
    cases: 3,
    failed: 1,
  });
  assert.deepEqual(aggregateMetrics([], { cases: 0, failed: 0 }), {
    faithfulness: null,
    answerRelevance: null,
    contextPrecision: null,
    contextRecall: null,
    cases: 0,
    failed: 0,
  });
});
