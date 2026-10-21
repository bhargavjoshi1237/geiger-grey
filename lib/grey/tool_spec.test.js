import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLASSIFY_MAX_OUTPUT_TOKENS,
  TEMPLATE_INFO,
  TOOL_LIMITS,
  TOOL_TEMPLATES,
  applyToolPatch,
  defaultToolSpec,
  estimateRunCost,
  normalizeLabels,
  normalizeToolInput,
  normalizeToolSpec,
  summarizeToolSpec,
  toolInputJsonSchema,
  validateToolSpec,
} from "./tool_spec.js";

const KB_A = "kb-a";
const KB_B = "kb-b";

const classifySpec = (extra = {}) =>
  normalizeToolSpec({
    template: "classify",
    scope: { kbIds: [KB_A] },
    classify: { labels: ["cat", "dog"], mode: "auto" },
    ...extra,
  });

test("TEMPLATE_INFO covers every template with a label, description and lucide icon", () => {
  assert.deepEqual(TOOL_TEMPLATES, ["find_similar", "classify", "answer_similar"]);
  assert.deepEqual(TEMPLATE_INFO.find_similar, {
    label: "Find similar",
    description: "Upload an image or describe something and get the most similar stored items.",
    icon: "Images",
  });
  assert.equal(TEMPLATE_INFO.classify.icon, "Tags");
  assert.equal(TEMPLATE_INFO.answer_similar.label, "Answer from similar items");
  assert.equal(TEMPLATE_INFO.answer_similar.icon, "MessageSquareQuote");
});

test("defaultToolSpec: per-template defaults", () => {
  const find = defaultToolSpec("find_similar", { kbIds: [KB_A, KB_A, " ", KB_B] });
  assert.deepEqual(find, {
    schemaVersion: 1,
    template: "find_similar",
    input: { image: "required", text: "off", textLabel: null },
    scope: { kbIds: [KB_A, KB_B], modality: "image" },
    search: { topK: 8, minScore: 0.3 },
    classify: null,
    answer: null,
    model: null,
    budget: { maxLlmCalls: 0, monthlyRunLimit: null },
  });

  const classify = defaultToolSpec("classify");
  assert.deepEqual(classify.input, { image: "required", text: "off", textLabel: null });
  assert.deepEqual(classify.classify, { labels: [], mode: "auto", k: 7, minMargin: 0.15 });
  assert.equal(classify.budget.maxLlmCalls, 1);
  assert.equal(classify.answer, null);

  const answer = defaultToolSpec("answer_similar");
  assert.deepEqual(answer.input, { image: "optional", text: "required", textLabel: "Question" });
  assert.deepEqual(answer.answer, { instructions: "", maxOutputTokens: 600, includeImages: true });
  assert.equal(answer.budget.maxLlmCalls, 1);
  assert.equal(answer.classify, null);

  assert.equal(defaultToolSpec("nonsense").template, "find_similar");
});

test("normalizeToolSpec: never throws and turns junk into a valid-shaped spec", () => {
  for (const junk of [null, undefined, 42, "spec", [], [1, 2], { template: 7 }, { input: "x", scope: [], search: null, budget: 3 }]) {
    const spec = normalizeToolSpec(junk);
    assert.equal(spec.schemaVersion, 1);
    assert.equal(spec.template, "find_similar");
    assert.deepEqual(spec, defaultToolSpec("find_similar"));
  }
});

test("normalizeToolSpec: coerces, clamps and falls back field by field", () => {
  const spec = normalizeToolSpec({
    schemaVersion: 99,
    template: "answer_similar",
    input: { image: "sometimes", text: "optional", textLabel: `  ${"q".repeat(80)}  ` },
    scope: { kbIds: [KB_A, 3, null, KB_A, " kb-b "], modality: "video" },
    search: { topK: "50", minScore: -2 },
    answer: { instructions: `  ${"x".repeat(2500)}`, maxOutputTokens: 10, includeImages: "no" },
    model: { providerId: "  prov-1 ", model: "  " },
    budget: { maxLlmCalls: 9, monthlyRunLimit: 5_000_000.4 },
    extra: "dropped",
  });
  assert.equal(spec.schemaVersion, 1);
  assert.deepEqual(spec.input, { image: "optional", text: "optional", textLabel: "q".repeat(60) });
  assert.deepEqual(spec.scope, { kbIds: [KB_A, KB_B], modality: "any" });
  assert.deepEqual(spec.search, { topK: 20, minScore: 0 });
  assert.equal(spec.answer.instructions.length, 2000);
  assert.equal(spec.answer.maxOutputTokens, 64);
  assert.equal(spec.answer.includeImages, true, "only an explicit false turns images off");
  assert.deepEqual(spec.model, { providerId: "prov-1", model: null });
  assert.deepEqual(spec.budget, { maxLlmCalls: 2, monthlyRunLimit: 1_000_000 });
  assert.equal("extra" in spec, false);

  assert.equal(normalizeToolSpec({ budget: { monthlyRunLimit: 0 } }).budget.monthlyRunLimit, null);
  assert.equal(normalizeToolSpec({ budget: { monthlyRunLimit: "250" } }).budget.monthlyRunLimit, 250);
  assert.equal(normalizeToolSpec({ model: { providerId: "" } }).model, null);
  assert.equal(normalizeToolSpec({ template: "answer_similar", input: { textLabel: null } }).input.textLabel, null);
  assert.equal(normalizeToolSpec({ template: "answer_similar", input: {} }).input.textLabel, "Question");
  assert.equal(normalizeToolSpec({ search: { topK: 0.4, minScore: "0.55" } }).search.topK, 1);
  assert.equal(normalizeToolSpec({ search: { minScore: "0.55" } }).search.minScore, 0.55);
  assert.equal(normalizeToolSpec({ search: { topK: true } }).search.topK, 8);
});

test("normalizeToolSpec: template invariants", () => {
  const find = normalizeToolSpec({
    template: "find_similar",
    classify: { labels: ["a", "b"] },
    answer: { instructions: "x" },
    budget: { maxLlmCalls: 2 },
  });
  assert.equal(find.classify, null);
  assert.equal(find.answer, null);
  assert.equal(find.budget.maxLlmCalls, 0);

  const knn = normalizeToolSpec({ template: "classify", classify: { mode: "knn" }, answer: {}, budget: { maxLlmCalls: 2 } });
  assert.equal(knn.answer, null);
  assert.equal(knn.budget.maxLlmCalls, 0);
  assert.equal(normalizeToolSpec({ template: "classify", classify: { mode: "auto" }, budget: { maxLlmCalls: 0 } }).budget.maxLlmCalls, 1);
  assert.equal(normalizeToolSpec({ template: "classify", classify: { mode: "llm" }, budget: { maxLlmCalls: 2 } }).budget.maxLlmCalls, 2);
  assert.equal(normalizeToolSpec({ template: "classify", classify: "bad" }).classify.mode, "auto");

  const answer = normalizeToolSpec({ template: "answer_similar", classify: { labels: ["a"] }, budget: { maxLlmCalls: 0 } });
  assert.equal(answer.classify, null);
  assert.equal(answer.budget.maxLlmCalls, 1);
  assert.ok(answer.answer, "answer_similar always has an answer section");
});

test("normalizeLabels: trims, caps lengths, dedupes case-insensitively and keeps at most 20", () => {
  assert.deepEqual(
    normalizeLabels(["  Cat ", "cat", { value: "Dog", description: `  ${"d".repeat(400)}` }, { label: "Bird" }, "", 7, null, "x".repeat(70)]),
    [
      { value: "Cat", description: "" },
      { value: "Dog", description: "d".repeat(300) },
      { value: "Bird", description: "" },
      { value: "x".repeat(60), description: "" },
    ],
  );
  const many = normalizeLabels(Array.from({ length: 30 }, (_, i) => `label ${i}`));
  assert.equal(many.length, TOOL_LIMITS.labelsMax);
  assert.deepEqual(normalizeLabels("cat"), []);
});

test("validateToolSpec: a complete spec passes", () => {
  assert.deepEqual(validateToolSpec(classifySpec(), { kbIds: [KB_A, KB_B] }), { ok: true, errors: [] });
  const find = normalizeToolSpec({ template: "find_similar", scope: { kbIds: [KB_A] } });
  assert.equal(validateToolSpec(find).ok, true);
  const answer = normalizeToolSpec({ template: "answer_similar", scope: { kbIds: [KB_A] } });
  assert.equal(validateToolSpec(answer).ok, true);
});

test("validateToolSpec: reports what's missing with paths and plain messages", () => {
  const paths = (result) => result.errors.map((e) => e.path);

  assert.deepEqual(validateToolSpec(null), { ok: false, errors: [{ path: "", message: "The tool has no settings yet." }] });

  const empty = validateToolSpec(normalizeToolSpec({ template: "classify" }));
  assert.equal(empty.ok, false);
  assert.deepEqual(paths(empty), ["scope.kbIds", "classify.labels"]);
  assert.match(empty.errors[0].message, /at least one knowledge base/);
  assert.match(empty.errors[1].message, /at least 2 labels/);

  const noInput = validateToolSpec(normalizeToolSpec({ template: "find_similar", scope: { kbIds: [KB_A] }, input: { image: "off", text: "off" } }));
  assert.deepEqual(paths(noInput), ["input"]);

  const foreign = validateToolSpec(classifySpec({ scope: { kbIds: [KB_A, "gone-1", "gone-2"] } }), { kbIds: [KB_A] });
  assert.deepEqual(paths(foreign), ["scope.kbIds"]);
  assert.match(foreign.errors[0].message, /2 of the chosen knowledge bases/);
  assert.match(validateToolSpec(classifySpec({ scope: { kbIds: ["gone"] } }), { kbIds: [KB_A] }).errors[0].message, /One of the chosen/);

  const answerless = validateToolSpec({ ...normalizeToolSpec({ template: "answer_similar", scope: { kbIds: [KB_A] } }), answer: null });
  assert.deepEqual(paths(answerless), ["answer"]);
});

test("validateToolSpec: checks raw (un-normalised) values and budget rules", () => {
  const raw = {
    template: "classify",
    input: { image: "maybe", text: "off" },
    scope: { kbIds: [KB_A], modality: "any" },
    search: { topK: 30, minScore: 2 },
    classify: {
      labels: [{ value: "cat" }, { value: "Cat" }, { value: "" }, { value: "dog", description: "d".repeat(301) }],
      mode: "knn",
      k: 0,
      minMargin: -1,
    },
    model: { providerId: "" },
    budget: { maxLlmCalls: 1, monthlyRunLimit: 0 },
  };
  const result = validateToolSpec(raw);
  assert.deepEqual(
    result.errors.map((e) => e.path),
    [
      "input.image",
      "search.topK",
      "search.minScore",
      "classify.labels.1",
      "classify.labels.2",
      "classify.labels.3.description",
      "classify.k",
      "classify.minMargin",
      "model",
      "budget.maxLlmCalls",
      "budget.monthlyRunLimit",
    ],
  );
  assert.match(result.errors.find((e) => e.path === "budget.maxLlmCalls").message, /Nearest-neighbour mode makes no model calls/);
  assert.match(result.errors.find((e) => e.path === "classify.labels.1").message, /"Cat" is listed twice/);

  const auto = { ...classifySpec(), budget: { maxLlmCalls: 0, monthlyRunLimit: null } };
  assert.match(validateToolSpec(auto).errors[0].message, /at least one model call/);
  const find = { ...normalizeToolSpec({ scope: { kbIds: [KB_A] } }), budget: { maxLlmCalls: 1, monthlyRunLimit: null } };
  assert.match(validateToolSpec(find).errors[0].message, /make no model calls/);
  const answer = { ...normalizeToolSpec({ template: "answer_similar", scope: { kbIds: [KB_A] } }), budget: { maxLlmCalls: 0, monthlyRunLimit: null } };
  assert.match(validateToolSpec(answer).errors[0].message, /Answering needs at least one model call/);
  assert.deepEqual(validateToolSpec({ ...classifySpec(), template: "summarize" }).errors[0].path, "template");
});

test("applyToolPatch: merges partial sections, returns name/description in meta and lists what changed", () => {
  const base = classifySpec();
  const { spec, meta, changed, errors } = applyToolPatch(base, {
    name: "  Defect sorter ",
    description: "Sorts photos of parts.",
    classify: { labels: ["ok", { value: "scratch", description: "Visible scratch" }, "OK"], k: 5 },
    search: { topK: 12 },
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(meta, { name: "Defect sorter", description: "Sorts photos of parts." });
  assert.equal("name" in spec, false, "name never lands in the spec");
  assert.deepEqual(spec.classify, {
    labels: [
      { value: "ok", description: "" },
      { value: "scratch", description: "Visible scratch" },
    ],
    mode: "auto",
    k: 5,
    minMargin: 0.15,
  });
  assert.equal(spec.search.topK, 12);
  assert.equal(spec.search.minScore, 0.3, "untouched fields keep their value");
  assert.deepEqual(changed, ["name", "description", "search.topK", "classify.labels", "classify.k"]);
});

test("applyToolPatch: reports unknown and invalid keys and still applies the valid ones", () => {
  const { spec, changed, errors } = applyToolPatch(classifySpec(), {
    code: "rm -rf /",
    input: { text: "optional", colour: "red", image: "always" },
    search: { topK: 99, minScore: 0.5 },
    answer: { instructions: "no" },
    budget: { monthlyRunLimit: -5 },
    name: "",
  });
  assert.deepEqual(errors.map((e) => e.path), ["code", "name", "input.colour", "input.image", "search.topK", "answer", "budget.monthlyRunLimit"]);
  assert.match(errors[0].message, /Unknown setting "code"/);
  assert.equal(spec.input.text, "optional");
  assert.equal(spec.input.image, "required");
  assert.equal(spec.search.topK, 8);
  assert.equal(spec.search.minScore, 0.5);
  assert.deepEqual(changed, ["input.text", "search.minScore"]);

  assert.deepEqual(applyToolPatch(classifySpec(), "nope").errors, [{ path: "", message: "Send the changes as an object." }]);
  assert.deepEqual(applyToolPatch(classifySpec(), { search: 5 }).errors.map((e) => e.path), ["search"]);
});

test("applyToolPatch: label errors drop only the bad entries", () => {
  const { spec, errors } = applyToolPatch(classifySpec(), {
    classify: { labels: ["good", "", "x".repeat(61), { value: "fine", description: "d".repeat(301) }, "great"] },
  });
  assert.deepEqual(errors.map((e) => e.path), ["classify.labels.1", "classify.labels.2", "classify.labels.3.description"]);
  assert.deepEqual(spec.classify.labels.map((l) => l.value), ["good", "great"]);

  const many = applyToolPatch(classifySpec(), { classify: { labels: Array.from({ length: 25 }, (_, i) => `l${i}`) } });
  assert.match(many.errors[0].message, /at most 20 labels/);
  assert.equal(many.spec.classify.labels.length, 20);
});

test("applyToolPatch: switching template keeps scope, search and model and takes the new defaults", () => {
  const base = normalizeToolSpec({
    template: "find_similar",
    scope: { kbIds: [KB_A], modality: "any" },
    search: { topK: 4, minScore: 0.5 },
    model: { providerId: "p1", model: "m1" },
    budget: { monthlyRunLimit: 100 },
  });
  const { spec, changed } = applyToolPatch(base, { template: "answer_similar", answer: { instructions: "Be brief." } });
  assert.equal(spec.template, "answer_similar");
  assert.deepEqual(spec.scope, { kbIds: [KB_A], modality: "any" });
  assert.deepEqual(spec.search, { topK: 4, minScore: 0.5 });
  assert.deepEqual(spec.model, { providerId: "p1", model: "m1" });
  assert.deepEqual(spec.input, { image: "optional", text: "required", textLabel: "Question" });
  assert.equal(spec.answer.instructions, "Be brief.");
  assert.deepEqual(spec.budget, { maxLlmCalls: 1, monthlyRunLimit: 100 });
  assert.ok(changed.includes("template"));
  assert.ok(changed.includes("answer"));
  assert.ok(changed.includes("input.text"));

  const bad = applyToolPatch(base, { template: "chatbot" });
  assert.equal(bad.spec.template, "find_similar");
  assert.equal(bad.errors[0].path, "template");
});

test("applyToolPatch: knn mode forces the model budget to 0; model null returns to the processing model", () => {
  const knn = applyToolPatch(classifySpec(), { classify: { mode: "knn" }, budget: { maxLlmCalls: 2 } });
  assert.equal(knn.spec.classify.mode, "knn");
  assert.equal(knn.spec.budget.maxLlmCalls, 0);
  assert.deepEqual(knn.changed, ["classify.mode", "budget.maxLlmCalls"]);

  const withModel = applyToolPatch(classifySpec(), { model: { providerId: "prov", model: "vision-1" } });
  assert.deepEqual(withModel.spec.model, { providerId: "prov", model: "vision-1" });
  assert.deepEqual(withModel.changed, ["model"]);
  const cleared = applyToolPatch(withModel.spec, { model: null });
  assert.equal(cleared.spec.model, null);

  const noProvider = applyToolPatch(classifySpec(), { model: { model: "vision-1" } });
  assert.equal(noProvider.spec.model, null);
  assert.deepEqual(noProvider.errors.map((e) => e.path), ["model.providerId"]);

  const modelOnly = applyToolPatch(withModel.spec, { model: { model: "vision-2" } });
  assert.deepEqual(modelOnly.spec.model, { providerId: "prov", model: "vision-2" });
});

test("applyToolPatch: no-op patch changes nothing", () => {
  const base = classifySpec();
  const { spec, changed, errors } = applyToolPatch(base, { search: { topK: 8 } });
  assert.deepEqual(spec, base);
  assert.deepEqual(changed, []);
  assert.deepEqual(errors, []);
});

test("summarizeToolSpec: short lines naming knowledge bases, labels and the decision rule", () => {
  const text = summarizeToolSpec(
    classifySpec({ scope: { kbIds: [KB_A, "unknown"], modality: "image" }, classify: { labels: ["cat", "dog"], mode: "auto", k: 5 } }),
    { kbNames: new Map([[KB_A, "Pet photos"]]) },
  );
  assert.match(text, /^Classify: Pick one label/);
  assert.match(text, /Input: image required\./);
  assert.match(text, /Searches: Pet photos, Unknown knowledge base \(images only\)\./);
  assert.match(text, /Labels \(2\): cat, dog\./);
  assert.match(text, /vote of the 5 closest labelled items .*the model decides when the vote is unclear/);
  assert.match(text, /project processing model; up to 1 model call per run/);
  assert.match(text, /No monthly run limit\./);

  const answer = summarizeToolSpec(
    normalizeToolSpec({ template: "answer_similar", scope: { kbIds: [KB_A] }, answer: { instructions: "Answer like a vet." }, budget: { monthlyRunLimit: 5000 } }),
    { kbNames: [{ id: KB_A, name: "Cases" }] },
  );
  assert.match(answer, /Input: image optional, text "Question" required\./);
  assert.match(answer, /Owner instructions: "Answer like a vet\."/);
  assert.match(answer, /Monthly run limit: 5,000\./);
  assert.match(summarizeToolSpec(null), /no knowledge bases chosen/);
});

test("estimateRunCost: embeddings per input kind and bounded model calls", () => {
  assert.deepEqual(estimateRunCost(defaultToolSpec("find_similar")), { embedCalls: 1, llmCalls: { min: 0, max: 0 }, maxOutputTokens: 0 });
  assert.deepEqual(estimateRunCost(classifySpec()), { embedCalls: 1, llmCalls: { min: 0, max: 1 }, maxOutputTokens: CLASSIFY_MAX_OUTPUT_TOKENS });
  assert.deepEqual(estimateRunCost(classifySpec({ classify: { labels: ["a", "b"], mode: "knn" } })).llmCalls, { min: 0, max: 0 });
  assert.deepEqual(estimateRunCost(classifySpec({ classify: { labels: ["a", "b"], mode: "llm" } })).llmCalls, { min: 1, max: 1 });
  assert.deepEqual(estimateRunCost(normalizeToolSpec({ template: "answer_similar", answer: { maxOutputTokens: 900 } })), {
    embedCalls: 2,
    llmCalls: { min: 0, max: 1 },
    maxOutputTokens: 900,
  });
});

test("toolInputJsonSchema: honours required / optional / off", () => {
  const find = toolInputJsonSchema(defaultToolSpec("find_similar"));
  assert.deepEqual(Object.keys(find.properties), ["image"]);
  assert.deepEqual(find.required, ["image"]);
  assert.equal(find.additionalProperties, false);
  assert.deepEqual(find.properties.image.required, ["data"]);
  assert.deepEqual(find.properties.image.properties.mimeType.enum, ["image/jpeg", "image/png", "image/webp"]);

  const answer = toolInputJsonSchema(defaultToolSpec("answer_similar"));
  assert.deepEqual(Object.keys(answer.properties).sort(), ["image", "text"]);
  assert.deepEqual(answer.required, ["text"]);
  assert.equal(answer.properties.text.minLength, 1);
  assert.equal(answer.properties.text.maxLength, 2000);
  assert.equal(answer.properties.text.description, "Question");

  const optional = toolInputJsonSchema(normalizeToolSpec({ input: { image: "optional", text: "optional" } }));
  assert.deepEqual(optional.required, []);
  assert.equal(optional.properties.text.minLength, undefined);
});

test("normalizeToolInput: checks required / off and text length", () => {
  const find = defaultToolSpec("find_similar");
  assert.deepEqual(normalizeToolInput(find, { image: { data: "abc", mimeType: "image/png" } }), {
    ok: true,
    input: { text: null, imageRaw: { data: "abc", mimeType: "image/png" } },
  });
  assert.deepEqual(normalizeToolInput(find, { image: "data:image/png;base64,abc" }).input.imageRaw, { data: "data:image/png;base64,abc" });
  assert.equal(normalizeToolInput(find, {}).code, "image_required");
  assert.equal(normalizeToolInput(find, { image: { data: "" } }).code, "image_required");
  assert.equal(normalizeToolInput(find, { image: { data: "abc" }, text: "hi" }).code, "text_not_accepted");
  assert.deepEqual(normalizeToolInput(find, { image: { data: "abc" }, text: "   " }).input.text, null);
  assert.equal(normalizeToolInput(find, { image: 42 }).code, "invalid_input");
  assert.equal(normalizeToolInput(find, null).code, "image_required");

  const answer = defaultToolSpec("answer_similar");
  const missing = normalizeToolInput(answer, { image: { data: "abc" } });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, "text_required");
  assert.equal(missing.message, "Enter the question.");
  assert.equal(normalizeToolInput(answer, { text: "x".repeat(2001) }).code, "text_too_long");
  assert.equal(normalizeToolInput(answer, { text: 5 }).code, "invalid_input");
  assert.deepEqual(normalizeToolInput(answer, { text: "  Is it rusty? " }), { ok: true, input: { text: "Is it rusty?", imageRaw: null } });

  const textOnly = normalizeToolSpec({ input: { image: "off", text: "optional" } });
  assert.equal(normalizeToolInput(textOnly, { image: { data: "abc" }, text: "x" }).code, "image_not_accepted");
  const either = normalizeToolSpec({ input: { image: "optional", text: "optional" } });
  assert.equal(normalizeToolInput(either, {}).code, "input_required");
  assert.equal(normalizeToolInput(either, {}).message, "Add an image or enter text.");
});
