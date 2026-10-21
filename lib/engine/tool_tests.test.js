import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVector, runToolTests } from "./tool_tests.js";
import { PROJECT, OTHER_PROJECT, uuid } from "./test_helpers.js";
import { normalizeToolSpec } from "../grey/tool_spec.js";

const KB_A = uuid(1);
const KB_B = uuid(2); // another embedding model: never compared with KB_A vectors
const KB_C = uuid(3); // same model as KB_A
const S = (n) => uuid(100 + n);

// Enough of supabase-js for the test runner: select/eq/neq/in/is/order/limit and storage.
function memoryAdmin(seed, { files = {} } = {}) {
  const db = Object.fromEntries(Object.entries(seed).map(([table, rows]) => [table, rows.map((r) => ({ ...r }))]));
  const queries = [];
  const from = (table) => {
    const filters = [];
    let limit = Infinity;
    const run = () => {
      queries.push(table);
      const rows = (db[table] || []).filter((row) => filters.every((f) => f(row))).slice(0, limit);
      return { data: rows.map((row) => ({ ...row })), error: null };
    };
    const query = {
      select: () => query,
      eq: (column, value) => (filters.push((row) => row[column] === value), query),
      neq: (column, value) =>
        (filters.push((row) => (value === "{}" && Array.isArray(row[column]) ? row[column].length > 0 : row[column] !== value)), query),
      in: (column, values) => (filters.push((row) => values.includes(row[column])), query),
      is: (column, value) => (filters.push((row) => (row[column] ?? null) === value), query),
      order: () => query,
      limit: (n) => ((limit = n), query),
      abortSignal: () => query,
      then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
    };
    return query;
  };
  const storage = {
    from: () => ({
      download: async (path) => (files[path] ? { data: new Blob([files[path]], { type: "image/jpeg" }), error: null } : { data: null, error: {} }),
    }),
  };
  return { db, queries, from, storage };
}

const kb = (id, model, extra = {}) => ({
  id,
  project_id: PROJECT,
  status: "active",
  deleted_at: null,
  embedding_provider_id: uuid(50),
  embedding_model: model,
  embedding_dims: 3,
  ...extra,
});

function source(n, labels, extra = {}) {
  return { id: S(n), project_id: PROJECT, kb_id: KB_A, name: `Item ${n}`, kind: "image", labels, deleted_at: null, ...extra };
}

function chunkRow(n, vector, extra = {}) {
  return {
    source_id: S(n),
    kb_id: KB_A,
    project_id: PROJECT,
    ordinal: 0,
    state: "live",
    deleted_at: null,
    modality: "image",
    embedding: `[${vector.join(",")}]`,
    embedding_dims: vector.length,
    content: `Caption of item ${n}.`,
    image: { thumbPath: `${PROJECT}/${KB_A}/${S(n)}/.thumb.jpg`, dhash: "0000000000000000" },
    ...extra,
  };
}

const cosine = (a, b) => {
  const dot = a.reduce((sum, x, i) => sum + x * b[i], 0);
  const norm = (v) => Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
  return dot / (norm(a) * norm(b));
};

// searchByVector over the seeded chunks (cosine), honouring kbIds / exclusions / modality.
function vectorDeps(admin, extra = {}) {
  const calls = { vector: [], generate: [], cap: 0 };
  const deps = {
    searchByVector: async (args) => {
      calls.vector.push(args);
      const sources = new Map(admin.db.sources.map((s) => [s.id, s]));
      return admin.db.chunks
        .filter((row) => args.kbIds.includes(row.kb_id) && !(args.excludeSourceIds || []).includes(row.source_id))
        .filter((row) => !args.modality || row.modality === args.modality)
        .map((row) => ({
          chunkId: `chunk-${row.source_id}`,
          sourceId: row.source_id,
          sourceName: sources.get(row.source_id)?.name ?? null,
          kbId: row.kb_id,
          content: row.content,
          score: cosine(args.vector, JSON.parse(row.embedding)),
          modality: row.modality,
          sourceKind: sources.get(row.source_id)?.kind ?? null,
          image: row.image,
          via: "vector",
        }))
        .filter((c) => c.score >= args.threshold)
        .sort((a, b) => b.score - a.score)
        .slice(0, args.limit);
    },
    searchChunks: async () => {
      throw new Error("tests never embed a query");
    },
    getCapState: async () => {
      calls.cap += 1;
      return { reached: false, behavior: "alert" };
    },
    getProcessingModel: async () => ({ model: {}, modelId: "judge-1", providerKind: "openai", supportsTemperature: true }),
    generateText: async (args) => {
      calls.generate.push(args);
      return { output: "dog", usage: { inputTokens: 10, outputTokens: 1 } };
    },
    ...extra,
  };
  return { deps, calls };
}

// Three cats near [1,0,0], three dogs near [0,1,0], plus items that must not become cases.
function petSeed() {
  return {
    knowledge_bases: [kb(KB_A, "embed-1"), kb(KB_B, "embed-2"), kb(KB_C, "embed-1"), kb(uuid(4), "embed-1", { project_id: OTHER_PROJECT })],
    sources: [
      source(1, ["cat"]),
      source(2, ["CAT"]),
      source(3, ["cat", "indoor"]),
      source(4, ["dog"]),
      source(5, ["dog"]),
      source(6, ["dog"], { kb_id: KB_C }),
      source(7, []), // unlabelled
      source(8, ["hamster"]), // not one of the tool's labels
      source(9, ["cat"], { kind: "document" }), // a text item: outside the image scope
      source(10, ["dog"], { kb_id: KB_B }), // other embedding model
      source(11, ["cat"], { deleted_at: "2026-10-01T00:00:00Z" }),
    ],
    chunks: [
      chunkRow(1, [1, 0.1, 0]),
      chunkRow(2, [1, 0.2, 0]),
      chunkRow(3, [1, 0, 0.1]),
      chunkRow(4, [0.1, 1, 0]),
      chunkRow(5, [0, 1, 0.2]),
      chunkRow(6, [0.2, 1, 0], { kb_id: KB_C }),
      chunkRow(7, [0.5, 0.5, 0]),
      chunkRow(8, [0, 0, 1]),
      chunkRow(9, [1, 0, 0], { modality: "text" }),
      chunkRow(10, [0, 1, 0], { kb_id: KB_B }),
    ],
  };
}

const classifySpec = (classify = {}, extra = {}) =>
  normalizeToolSpec({
    template: "classify",
    scope: { kbIds: [KB_A, KB_B, KB_C], modality: "image" },
    classify: { labels: ["cat", "dog"], mode: "auto", k: 3, ...classify },
    ...extra,
  });

test("parseVector: pgvector strings and arrays", () => {
  assert.deepEqual(parseVector("[0.1,-2,3e-1]"), [0.1, -2, 0.3]);
  assert.deepEqual(parseVector([1, "2"]), [1, 2]);
  assert.equal(parseVector("[1,abc]"), null);
  assert.equal(parseVector("[]"), null);
  assert.equal(parseVector(null), null);
  assert.equal(parseVector("[1,null]"), null);
});

test("classify: leave-one-out over labelled items, stratified by label, vote only", async () => {
  const admin = memoryAdmin(petSeed());
  const { deps, calls } = vectorDeps(admin);
  const report = await runToolTests({ admin, projectId: PROJECT, spec: classifySpec(), deps });

  assert.equal(report.kind, "classification");
  assert.equal(report.skippedReason, null);
  assert.equal(report.cases, 7, "cats 1–3, dogs 4–6 and the KB_B dog");
  assert.equal(report.llmCalls, 0);
  assert.equal(calls.generate.length + calls.cap, 0, "without includeLlm the model never runs");
  assert.ok(!Number.isNaN(Date.parse(report.ranAt)));

  // Round-robin by label: cat, dog, cat, dog, …
  assert.deepEqual(report.samples.map((s) => s.expected[0]), ["cat", "dog", "cat", "dog", "cat", "dog", "dog"]);
  assert.deepEqual(report.samples[0], { sourceId: S(1), sourceName: "Item 1", expected: ["cat"], predicted: "cat", confidence: 1, decidedBy: "knn" });
  assert.deepEqual(report.samples.find((s) => s.sourceId === S(2)).expected, ["cat"], "labels in the tool's spelling");

  // Each case excludes itself and searches only its embedding group.
  for (const call of calls.vector) {
    assert.equal(call.excludeSourceIds.length, 1);
    assert.equal(call.modality, "image");
    assert.equal(call.dims, 3);
  }
  const caseCall = (n) => calls.vector.find((c) => c.excludeSourceIds[0] === S(n));
  assert.deepEqual(caseCall(1).kbIds.sort(), [KB_A, KB_C].sort());
  assert.deepEqual(caseCall(1).vector, [1, 0.1, 0]);
  assert.deepEqual(caseCall(10).kbIds, [KB_B]);

  // The KB_B dog has no comparable neighbour: uncertain.
  const lonely = report.samples.find((s) => s.sourceId === S(10));
  assert.equal(lonely.predicted, null);
  assert.equal(report.report.total, 7);
  assert.equal(report.report.correct, 6);
  assert.equal(report.report.coverage, 0.8571);
  assert.deepEqual(report.report.confusion.dog, { dog: 3, uncertain: 1 });
  assert.deepEqual(report.usage, { llmCalls: 0, tokensIn: 0, tokensOut: 0, model: null, provider: null });
});

test("classify with includeLlm: the model runs for at most 10 cases and sees the item's text and thumbnail", async () => {
  const seed = petSeed();
  // 12 cats and dogs in KB_A, with ambiguous vectors so the vote never decides.
  seed.sources = Array.from({ length: 12 }, (_, i) => source(20 + i, [i % 2 ? "dog" : "cat"]));
  seed.chunks = Array.from({ length: 12 }, (_, i) => chunkRow(20 + i, [1, 1, i / 100]));
  const files = Object.fromEntries(seed.chunks.map((c) => [c.image.thumbPath, new Uint8Array([0xff, 0xd8])]));
  const admin = memoryAdmin(seed, { files });
  const { deps, calls } = vectorDeps(admin);
  const report = await runToolTests({ admin, projectId: PROJECT, spec: classifySpec({ mode: "llm", k: 5 }), includeLlm: true, deps });

  assert.equal(report.cases, 12);
  assert.equal(calls.generate.length, 10);
  assert.equal(report.llmCalls, 10);
  assert.equal(calls.cap, 1, "the cap is read once for the whole test");
  assert.equal(report.samples.filter((s) => s.decidedBy === "llm").length, 10);
  assert.deepEqual(report.usage, { llmCalls: 10, tokensIn: 100, tokensOut: 10, model: "judge-1", provider: "openai" });

  const content = calls.generate[0].messages[0].content;
  assert.match(content[0].text, /Item to classify:\nCaption of item 20\./);
  assert.equal(content[1].type, "file", "the item's thumbnail stands in for the uploaded image");
});

test("find_similar: retrieval report from the neighbours' labels", async () => {
  const admin = memoryAdmin(petSeed());
  const { deps } = vectorDeps(admin);
  const spec = normalizeToolSpec({ template: "find_similar", scope: { kbIds: [KB_A, KB_C], modality: "image" }, search: { topK: 3 } });
  const result = await runToolTests({ admin, projectId: PROJECT, spec, deps });

  assert.equal(result.kind, "retrieval");
  // Any label counts for find similar: cats, dogs and the hamster (KB_B is out of scope).
  assert.equal(result.cases, 7);
  assert.equal(result.report.total, 7);
  const hamster = result.samples.find((s) => s.sourceId === S(8));
  assert.equal(hamster.predicted, null);
  assert.equal(hamster.hitRank, null);
  const cat = result.samples.find((s) => s.sourceId === S(1));
  assert.equal(cat.predicted, "cat");
  assert.equal(cat.hitRank, 1);
  assert.ok(cat.confidence > 0.9);
  assert.equal(cat.decidedBy, null);
  assert.equal(result.report.hitAtK, 0.8571);
});

test("answer_similar has no automatic tests; too few labelled items are skipped", async () => {
  const admin = memoryAdmin(petSeed());
  const { deps, calls } = vectorDeps(admin);
  const none = await runToolTests({ admin, projectId: PROJECT, spec: normalizeToolSpec({ template: "answer_similar", scope: { kbIds: [KB_A] } }), deps });
  assert.equal(none.kind, "none");
  assert.equal(none.skippedReason, "no_automatic_tests");
  assert.equal(none.report, null);
  assert.equal(admin.queries.length, 0);

  const few = await runToolTests({ admin, projectId: PROJECT, spec: classifySpec({}, { scope: { kbIds: [KB_B], modality: "image" } }), deps });
  assert.equal(few.kind, "classification");
  assert.equal(few.skippedReason, "not_enough_labelled_items");
  assert.equal(few.cases, 1);
  assert.equal(calls.vector.length, 0);

  const textScope = await runToolTests({ admin, projectId: PROJECT, spec: classifySpec({}, { scope: { kbIds: [KB_A], modality: "text" } }), deps });
  assert.equal(textScope.skippedReason, "not_enough_labelled_items");
  assert.equal(textScope.cases, 1, "only the document source");
});

test("the limit caps the cases and a scope without active knowledge bases throws", async () => {
  const admin = memoryAdmin(petSeed());
  const { deps } = vectorDeps(admin);
  const limited = await runToolTests({ admin, projectId: PROJECT, spec: classifySpec(), limit: 4, deps });
  assert.equal(limited.cases, 4);
  assert.deepEqual(limited.samples.map((s) => s.expected[0]), ["cat", "dog", "cat", "dog"]);

  await assert.rejects(
    runToolTests({ admin, projectId: PROJECT, spec: classifySpec({}, { scope: { kbIds: [uuid(4)] } }), deps }),
    { code: "tool_scope_empty", status: 409 },
  );
});
