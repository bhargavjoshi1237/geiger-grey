import { test } from "node:test";
import assert from "node:assert/strict";
import { searchByVector, searchChunks } from "./retrieval.js";
import { EngineError } from "./errors.js";
import { PROJECT, uuid } from "./test_helpers.js";

const KB_A = uuid(1);
const KB_B = uuid(2); // same embedding model as KB_A -> one group
const KB_C = uuid(3); // a text-only embedding model -> its own group
const SRC_1 = uuid(11);
const SRC_2 = uuid(12);

const TEXT_VECTOR = [0.1, 0.2, 0.3, 0.4];
const IMAGE_VECTOR = [0.5, 0.5, 0.5, 0.5];
const IMAGE = { data: "aGVsbG8=", mimeType: "image/jpeg" };

const kbRow = (id, extra = {}) => ({
  id,
  project_id: PROJECT,
  status: "active",
  deleted_at: null,
  embedding_provider_id: "prov-mm",
  embedding_model: "voyage-multimodal-3.5",
  embedding_dims: 4,
  ...extra,
});
const KBS = [kbRow(KB_A), kbRow(KB_B), kbRow(KB_C, { embedding_provider_id: "prov-text", embedding_model: "text-embedding-3-small" })];

const imageInfo = (n) => ({ thumbPath: `${PROJECT}/${KB_A}/${uuid(n)}/.thumb.jpg`, width: 640, height: 480, dhash: "0f0f0f0f0f0f0f0f" });
const row = (id, extra = {}) => ({
  chunk_id: id,
  source_id: SRC_1,
  source_name: `${id}.pdf`,
  kb_id: KB_A,
  content: `content ${id}`,
  page: 1,
  start_ms: null,
  end_ms: null,
  heading_path: ["Intro"],
  score: 0.8,
  modality: "text",
  source_kind: "pdf",
  image: null,
  ...extra,
});
const imageRow = (id, n, extra = {}) =>
  row(id, { modality: "image", source_kind: "image", page: null, heading_path: null, image: imageInfo(n), ...extra });

// Service-role stand-in: knowledge_bases reads (select/eq/in/is) and scripted rpc calls.
function fakeAdmin({ kbs = KBS, rpc = {} } = {}) {
  const calls = [];
  const reads = [];
  const thenable = (result) => {
    const value = { then: (resolve, reject) => Promise.resolve(result).then(resolve, reject), abortSignal: () => value };
    return value;
  };
  return {
    calls,
    reads,
    from(table) {
      reads.push(table);
      const filters = [];
      const query = {
        select: () => query,
        eq: (col, value) => (filters.push((r) => r[col] === value), query),
        in: (col, values) => (filters.push((r) => values.includes(r[col])), query),
        is: (col, value) => (filters.push((r) => (r[col] ?? null) === value), query),
        abortSignal: () => query,
        then: (resolve, reject) =>
          Promise.resolve({ data: table === "knowledge_bases" ? kbs.filter((r) => filters.every((f) => f(r))) : [], error: null })
            .then(resolve, reject),
      };
      return query;
    },
    rpc(name, params) {
      calls.push({ name, params });
      const handler = rpc[name];
      return thenable(typeof handler === "function" ? handler(params) : handler ?? { data: [], error: null });
    },
  };
}

// Provider steps: text and image embeddings return fixed vectors; "voyage-multimodal-*" KBs embed images.
function fakeDeps(overrides = {}) {
  const calls = { embedTexts: [], embedImages: [], kbImageSupport: [], rerank: [], expandWithGraph: [] };
  const deps = {
    embedTexts: async (args) => {
      calls.embedTexts.push(args);
      return { vectors: [TEXT_VECTOR], tokens: 3, dims: 4 };
    },
    embedImages: async (args) => {
      calls.embedImages.push(args);
      return { vectors: [IMAGE_VECTOR], tokens: 7, dims: 4 };
    },
    kbImageSupport: async (args) => {
      calls.kbImageSupport.push(args);
      const supported = /^voyage-multimodal-/.test(args.kb.embedding_model);
      return { supported, model: supported ? args.kb.embedding_model : null, format: supported ? "voyage" : null };
    },
    rerank: async (args) => {
      calls.rerank.push(args);
      return [];
    },
    expandWithGraph: async (args) => {
      calls.expandWithGraph.push(args);
      return { chunks: [], facts: [], entities: [] };
    },
  };
  for (const [name, fn] of Object.entries(overrides)) {
    deps[name] = async (args) => {
      calls[name].push(args);
      return fn(args);
    };
  }
  return { calls, deps };
}

const vectorCalls = (admin) => admin.calls.filter((c) => c.name === "match_chunks_vector");
const textCalls = (admin) => admin.calls.filter((c) => c.name === "match_chunks_text");
const NO_FILTERS = { p_modality: null, p_source_ids: null, p_exclude_source_ids: null };

test("text-only search runs as before and passes the new filter params as null", async () => {
  const admin = fakeAdmin({
    rpc: {
      match_chunks_vector: ({ p_kb_ids }) => ({ data: p_kb_ids.includes(KB_A) ? [row("c1"), row("c2")] : [row("c3", { kb_id: KB_C })], error: null }),
      match_chunks_text: { data: [row("c2"), { chunk_id: "c4", source_id: SRC_2, kb_id: KB_B, content: "legacy row", score: 0.4 }], error: null },
    },
  });
  const { calls, deps } = fakeDeps();
  const { chunks, meta } = await searchChunks({ admin, projectId: PROJECT, kbIds: [KB_A, KB_B, KB_C, KB_A], query: "  red shoes ", deps });

  assert.equal(calls.embedTexts.length, 2, "one query embedding per KB group");
  assert.deepEqual(calls.embedTexts.map((c) => [c.kb.id, c.texts, c.inputType]), [
    [KB_A, ["red shoes"], "query"],
    [KB_C, ["red shoes"], "query"],
  ]);
  assert.equal(calls.kbImageSupport.length, 0);
  assert.equal(calls.embedImages.length, 0);

  assert.deepEqual(vectorCalls(admin).map((c) => c.params), [
    { p_project: PROJECT, p_kb_ids: [KB_A, KB_B], p_dims: 4, p_query: "[0.1,0.2,0.3,0.4]", p_limit: 30, p_min_similarity: 0.2, ...NO_FILTERS },
    { p_project: PROJECT, p_kb_ids: [KB_C], p_dims: 4, p_query: "[0.1,0.2,0.3,0.4]", p_limit: 30, p_min_similarity: 0.2, ...NO_FILTERS },
  ]);
  assert.deepEqual(textCalls(admin).map((c) => c.params), [
    { p_project: PROJECT, p_kb_ids: [KB_A, KB_B, KB_C], p_query: "red shoes", p_limit: 30, ...NO_FILTERS },
  ]);

  assert.deepEqual(chunks.map((c) => c.chunkId), ["c2", "c1", "c3", "c4"]);
  assert.equal(chunks[0].via, "text+vector");
  assert.deepEqual(chunks[1], {
    chunkId: "c1",
    sourceId: SRC_1,
    sourceName: "c1.pdf",
    kbId: KB_A,
    content: "content c1",
    score: chunks[1].score,
    page: 1,
    startMs: null,
    endMs: null,
    headingPath: ["Intro"],
    modality: "text",
    sourceKind: "pdf",
    image: null,
    via: "vector",
  });
  // A row without the new columns gets the defaults.
  assert.equal(chunks[3].modality, "text");
  assert.equal(chunks[3].sourceKind, null);
  assert.equal(chunks[3].image, null);
  assert.ok(chunks.every((c) => c.score > 0 && c.score <= 1));

  assert.equal(meta.scoreKind, "rrf");
  assert.deepEqual(meta.queryModes, ["text"]);
  assert.deepEqual(meta.imageSkippedKbIds, []);
  assert.equal(meta.embedCalls, 2);
  assert.equal(meta.embedTokens, 6);
  assert.deepEqual(meta.embedModels, ["voyage-multimodal-3.5", "text-embedding-3-small"]);
  assert.equal(meta.rerank, "off");
  assert.equal(meta.graph, "off");
  assert.equal(meta.degraded, null);
  assert.equal(meta.candidateCount, 4);
  assert.equal(meta.reason, undefined);
});

test("image-only search embeds the image per supported group and skips the others", async () => {
  const admin = fakeAdmin({
    rpc: { match_chunks_vector: { data: [imageRow("i1", 21, { score: 0.91 }), imageRow("i2", 22, { score: 0.62 })], error: null } },
  });
  const { calls, deps } = fakeDeps();
  const { chunks, meta } = await searchChunks({
    admin,
    projectId: PROJECT,
    kbIds: [KB_A, KB_B, KB_C],
    queryImage: { ...IMAGE, bytes: new Uint8Array(4), width: 10, height: 10 },
    rerank: true,
    rerankProviderId: "rerank-prov",
    rerankModel: "rerank-2",
    graphMode: "always",
    deps,
  });

  assert.equal(calls.kbImageSupport.length, 2, "asked once per KB group");
  assert.equal(calls.embedImages.length, 1);
  const [embed] = calls.embedImages;
  assert.equal(embed.kb.id, KB_A);
  assert.equal(embed.projectId, PROJECT);
  assert.equal(embed.inputType, "query");
  assert.deepEqual(embed.images, [IMAGE], "only { data, mimeType } is sent");
  assert.equal(calls.embedTexts.length, 0);
  assert.equal(calls.rerank.length, 0);
  assert.equal(calls.expandWithGraph.length, 0);

  assert.equal(textCalls(admin).length, 0, "no full-text arm without a text query");
  assert.deepEqual(vectorCalls(admin).map((c) => c.params), [
    { p_project: PROJECT, p_kb_ids: [KB_A, KB_B], p_dims: 4, p_query: "[0.5,0.5,0.5,0.5]", p_limit: 30, p_min_similarity: 0.2, ...NO_FILTERS },
  ]);

  assert.deepEqual(chunks.map((c) => [c.chunkId, c.score, c.via, c.modality, c.sourceKind]), [
    ["i1", 0.91, "vector", "image", "image"],
    ["i2", 0.62, "vector", "image", "image"],
  ]);
  assert.deepEqual(chunks[0].image, imageInfo(21));
  assert.equal(meta.scoreKind, "cosine");
  assert.deepEqual(meta.queryModes, ["image"]);
  assert.deepEqual(meta.imageSkippedKbIds, [KB_C]);
  assert.equal(meta.embedCalls, 1);
  assert.equal(meta.embedTokens, 7);
  assert.deepEqual(meta.embedModels, ["voyage-multimodal-3.5"]);
  assert.equal(meta.rerank, "skipped");
  assert.equal(meta.graph, "skipped");
  assert.equal(meta.reason, undefined);
});

test("image + text: text arms run as today and RRF fuses them with the image arm", async () => {
  const admin = fakeAdmin({
    rpc: {
      match_chunks_vector: ({ p_query }) => ({
        data: p_query === "[0.1,0.2,0.3,0.4]" ? [row("c1"), row("c2")] : [imageRow("i3", 23), row("c1")],
        error: null,
      }),
      match_chunks_text: { data: [row("c1")], error: null },
    },
  });
  const { calls, deps } = fakeDeps({
    rerank: ({ documents }) => documents.map((_, index) => ({ index, score: index === 1 ? 0.99 : 0.1 })),
  });
  const { chunks, meta } = await searchChunks({
    admin,
    projectId: PROJECT,
    kbIds: [KB_A],
    query: "red shoes",
    queryImage: IMAGE,
    rerank: true,
    rerankProviderId: "rerank-prov",
    rerankModel: "rerank-2",
    graphMode: "always",
    deps,
  });

  assert.equal(calls.embedTexts.length, 1);
  assert.equal(calls.embedImages.length, 1);
  assert.deepEqual(vectorCalls(admin).map((c) => c.params.p_query).sort(), ["[0.1,0.2,0.3,0.4]", "[0.5,0.5,0.5,0.5]"]);
  assert.equal(textCalls(admin).length, 1);

  // Rerank and graph expansion use the text query only.
  assert.equal(calls.rerank.length, 1);
  assert.equal(calls.rerank[0].query, "red shoes");
  assert.deepEqual(calls.rerank[0].documents, ["content c1", "content i3", "content c2"], "the fused order: c1 in every arm first");
  assert.equal(calls.expandWithGraph.length, 1);
  assert.equal(calls.expandWithGraph[0].query, "red shoes");

  assert.deepEqual(chunks.map((c) => c.chunkId), ["i3", "c1", "c2"]);
  assert.equal(chunks[0].modality, "image");
  assert.equal(meta.scoreKind, "rerank");
  assert.equal(meta.rerank, "applied");
  assert.deepEqual(meta.queryModes, ["text", "image"]);
  assert.deepEqual(meta.imageSkippedKbIds, []);
  assert.equal(meta.embedCalls, 2);
  assert.equal(meta.embedTokens, 10);
  assert.equal(meta.candidateCount, 3);
});

test("RRF ranks a chunk found by the image and text arms above single-arm hits", async () => {
  const admin = fakeAdmin({
    rpc: {
      match_chunks_vector: ({ p_query }) => ({
        data: p_query === "[0.1,0.2,0.3,0.4]" ? [row("c2"), row("c1")] : [imageRow("i3", 23), row("c1")],
        error: null,
      }),
      match_chunks_text: { data: [row("c1")], error: null },
    },
  });
  const { deps } = fakeDeps();
  const { chunks, meta } = await searchChunks({ admin, projectId: PROJECT, kbIds: [KB_A], query: "red shoes", queryImage: IMAGE, deps });
  assert.equal(chunks[0].chunkId, "c1");
  assert.equal(chunks[0].via, "vector+text");
  assert.equal(meta.scoreKind, "rrf");
});

test("a query image no knowledge base can embed returns image_query_unsupported", async () => {
  const admin = fakeAdmin();
  const { calls, deps } = fakeDeps();
  const { chunks, meta } = await searchChunks({ admin, projectId: PROJECT, kbIds: [KB_C], queryImage: IMAGE, deps });
  assert.deepEqual(chunks, []);
  assert.equal(meta.reason, "image_query_unsupported");
  assert.deepEqual(meta.imageSkippedKbIds, [KB_C]);
  assert.deepEqual(meta.queryModes, []);
  assert.equal(meta.embedCalls, 0);
  assert.equal(calls.embedImages.length, 0);
  assert.equal(admin.calls.length, 0, "nothing searched");

  // With text as well, the text search still runs and the image is reported as skipped.
  const withText = fakeAdmin({ rpc: { match_chunks_vector: { data: [row("c1", { kb_id: KB_C })], error: null } } });
  const both = await searchChunks({ admin: withText, projectId: PROJECT, kbIds: [KB_C], query: "shoes", queryImage: IMAGE, deps });
  assert.deepEqual(both.chunks.map((c) => c.chunkId), ["c1"]);
  assert.equal(both.meta.reason, undefined);
  assert.deepEqual(both.meta.queryModes, ["text"]);
  assert.deepEqual(both.meta.imageSkippedKbIds, [KB_C]);
  assert.equal(calls.embedImages.length, 0);
});

test("embedImages reporting images_unsupported counts as skipped, not failed", async () => {
  const admin = fakeAdmin();
  const { deps } = fakeDeps({
    embedImages: () => {
      throw new EngineError("images_unsupported", "This knowledge base's embedding model can't embed images.", { status: 422 });
    },
  });
  const { meta } = await searchChunks({ admin, projectId: PROJECT, kbIds: [KB_A], queryImage: IMAGE, deps });
  assert.equal(meta.reason, "image_query_unsupported");
  assert.deepEqual(meta.imageSkippedKbIds, [KB_A]);
  assert.equal(meta.degraded, null);
});

test("needs a text query or a query image", async () => {
  const admin = fakeAdmin();
  const { calls, deps } = fakeDeps();
  const empty = await searchChunks({ admin, projectId: PROJECT, kbIds: [KB_A], query: "   ", queryImage: { data: "" }, deps });
  assert.equal(empty.meta.reason, "empty_query");
  assert.deepEqual(empty.meta.imageSkippedKbIds, []);
  assert.equal(empty.meta.embedCalls, 0);
  const noKbs = await searchChunks({ admin, projectId: PROJECT, kbIds: [], queryImage: IMAGE, deps });
  assert.equal(noKbs.meta.reason, "no_knowledge_bases");
  assert.deepEqual(admin.reads, [], "no database read");
  assert.equal(calls.kbImageSupport.length, 0);
});

test("modality and source filters reach both RPCs by name", async () => {
  const admin = fakeAdmin();
  const { deps } = fakeDeps();
  await searchChunks({
    admin,
    projectId: PROJECT,
    kbIds: [KB_A],
    query: "shoes",
    modality: "image",
    sourceIds: [SRC_1, SRC_1, "", null],
    excludeSourceIds: [],
    deps,
  });
  assert.equal(admin.calls.length, 2);
  for (const { params } of admin.calls) {
    assert.equal(params.p_modality, "image");
    assert.deepEqual(params.p_source_ids, [SRC_1]);
    assert.equal(params.p_exclude_source_ids, null);
  }

  const other = fakeAdmin();
  await searchChunks({ admin: other, projectId: PROJECT, kbIds: [KB_A], query: "shoes", modality: "video", excludeSourceIds: [SRC_2], deps });
  for (const { params } of other.calls) {
    assert.equal(params.p_modality, null, "only text/image narrow the search");
    assert.equal(params.p_source_ids, null);
    assert.deepEqual(params.p_exclude_source_ids, [SRC_2]);
  }

  // An explicit but empty source list matches nothing rather than everything.
  const none = fakeAdmin();
  const empty = await searchChunks({ admin: none, projectId: PROJECT, kbIds: [KB_A], query: "shoes", sourceIds: [null, ""], deps });
  assert.deepEqual(empty.chunks, []);
  assert.equal(empty.meta.reason, "no_sources");
  assert.equal(none.calls.length, 0);
});

test("a failed image embedding degrades; with nothing else to search it fails", async (t) => {
  t.mock.method(console, "warn", () => {});
  const failing = () => {
    throw Object.assign(new Error("upstream 503"), { code: "provider_unavailable" });
  };

  const admin = fakeAdmin({ rpc: { match_chunks_vector: { data: [row("c1")], error: null } } });
  const { deps } = fakeDeps({ embedImages: failing });
  const { chunks, meta } = await searchChunks({ admin, projectId: PROJECT, kbIds: [KB_A], query: "shoes", queryImage: IMAGE, deps });
  assert.deepEqual(chunks.map((c) => c.chunkId), ["c1"]);
  assert.equal(meta.degraded, "vector_unavailable");
  assert.deepEqual(meta.queryModes, ["text", "image"]);
  assert.equal(meta.embedCalls, 2);
  assert.equal(vectorCalls(admin).length, 1, "only the text vector arm ran");

  await assert.rejects(
    searchChunks({ admin: fakeAdmin(), projectId: PROJECT, kbIds: [KB_A], queryImage: IMAGE, deps }),
    (err) => err instanceof EngineError && err.code === "retrieval_failed" && err.status === 503,
  );
});

test("a failed text embedding still falls back to full-text search for its KBs", async (t) => {
  t.mock.method(console, "warn", () => {});
  const admin = fakeAdmin({ rpc: { match_chunks_text: { data: [row("t1")], error: null } } });
  const { deps } = fakeDeps({
    embedTexts: () => {
      throw new Error("down");
    },
  });
  const { chunks, meta } = await searchChunks({ admin, projectId: PROJECT, kbIds: [KB_A, KB_C], query: "shoes", hybrid: false, deps });
  assert.deepEqual(chunks.map((c) => c.chunkId), ["t1"]);
  assert.equal(meta.degraded, "vector_unavailable");
  assert.equal(meta.scoreKind, "text_rank");
  assert.deepEqual(textCalls(admin).map((c) => c.params.p_kb_ids), [[KB_A, KB_C]]);
});

test("searchByVector runs the raw vector arm with filters and no embedding call", async () => {
  const admin = fakeAdmin({ rpc: { match_chunks_vector: { data: [imageRow("i1", 21, { score: 0.77 }), row("c1", { score: 0.5 })], error: null } } });
  const chunks = await searchByVector({
    admin,
    projectId: PROJECT,
    kbIds: [KB_A, KB_A, null],
    dims: 4,
    vector: [1, 0, 0, 0],
    modality: "image",
    excludeSourceIds: [SRC_2],
  });
  assert.deepEqual(admin.calls, [
    {
      name: "match_chunks_vector",
      params: {
        p_project: PROJECT,
        p_kb_ids: [KB_A],
        p_dims: 4,
        p_query: "[1,0,0,0]",
        p_limit: 10,
        p_min_similarity: 0,
        p_modality: "image",
        p_source_ids: null,
        p_exclude_source_ids: [SRC_2],
      },
    },
  ]);
  assert.deepEqual(admin.reads, []);
  assert.deepEqual(chunks[0], {
    chunkId: "i1",
    sourceId: SRC_1,
    sourceName: "i1.pdf",
    kbId: KB_A,
    content: "content i1",
    score: 0.77,
    page: null,
    startMs: null,
    endMs: null,
    headingPath: null,
    modality: "image",
    sourceKind: "image",
    image: imageInfo(21),
    via: "vector",
  });
  assert.equal(chunks[1].via, "vector");

  const capped = fakeAdmin();
  await searchByVector({ admin: capped, projectId: PROJECT, kbIds: [KB_A], vector: [1, 0, 0, 0], limit: 500, threshold: 3 });
  assert.equal(capped.calls[0].params.p_limit, 200);
  assert.equal(capped.calls[0].params.p_min_similarity, 1);
  assert.equal(capped.calls[0].params.p_dims, 4, "dims default to the vector length");

  const none = fakeAdmin();
  assert.deepEqual(await searchByVector({ admin: none, projectId: PROJECT, kbIds: [], vector: [1, 0, 0, 0] }), []);
  assert.deepEqual(await searchByVector({ admin: none, projectId: PROJECT, kbIds: [KB_A], vector: [] }), []);
  assert.equal(none.calls.length, 0);
});

test("searchByVector maps an RPC failure to retrieval_failed", async (t) => {
  t.mock.method(console, "error", () => {});
  const admin = fakeAdmin({ rpc: { match_chunks_vector: { data: null, error: { message: "BAD_DIMS" } } } });
  await assert.rejects(
    searchByVector({ admin, projectId: PROJECT, kbIds: [KB_A], dims: 4, vector: [1, 0, 0, 0] }),
    (err) => err instanceof EngineError && err.code === "retrieval_failed",
  );
});
