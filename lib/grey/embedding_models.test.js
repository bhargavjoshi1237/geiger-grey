import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BATCH_LIMITS,
  DEFAULT_REQUESTED_DIMS,
  IMAGE_BATCH_LIMITS,
  LEGACY_EMBEDDING_MODELS,
  SUGGESTED_EMBEDDING_MODELS,
  acceptsDimensionParam,
  buildEmbedRequest,
  buildImageEmbedRequest,
  defaultRequestedDims,
  embeddingModelLabel,
  imageEmbeddingSpec,
  isIndexedDims,
  isLegacyEmbeddingModel,
  isValidDims,
  modelSupportsImages,
  parseEmbedResponse,
  parseImageEmbedResponse,
  planBatches,
  resolveEmbeddingSpec,
  toPgVector,
} from "./embedding_models.js";

const body = (req) => JSON.parse(req.init.body);

test("legacy KB values map to driver + API model id + 1024 dims", () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(LEGACY_EMBEDDING_MODELS).map(([k, v]) => [k, [v.format, v.model, v.dims]])),
    {
      "cohere-embed-5-pro": ["cohere", "embed-v5.0-pro", 1024],
      "cohere-embed-5-fast": ["cohere", "embed-v5.0-fast", 1024],
      "openai-text-embedding-3-large": ["openai", "text-embedding-3-large", 1024],
      "voyage-3.5": ["voyage", "voyage-3.5", 1024],
    },
  );
  assert.equal(DEFAULT_REQUESTED_DIMS, 1024);
  assert.equal(isLegacyEmbeddingModel("cohere-embed-5-pro"), true);
  assert.equal(isLegacyEmbeddingModel("text-embedding-3-large"), false);
  assert.equal(embeddingModelLabel("openai-text-embedding-3-large"), "OpenAI text-embedding-3-large");
  assert.equal(embeddingModelLabel("my-model"), "my-model");
});

test("resolveEmbeddingSpec handles legacy keys, raw ids and both row shapes", () => {
  assert.deepEqual(resolveEmbeddingSpec({ embedding_model: "cohere-embed-5-fast", embedding_dims: null }), {
    model: "embed-v5.0-fast", dims: 1024, format: "cohere", legacy: true,
  });
  assert.deepEqual(resolveEmbeddingSpec({ embeddingModel: "nomic-embed-text", embeddingDims: 768 }), {
    model: "nomic-embed-text", dims: 768, format: null, legacy: false,
  });
  assert.equal(resolveEmbeddingSpec({ embedding_model: "voyage-3.5", embedding_dims: 512 }).dims, 512);
  assert.equal(resolveEmbeddingSpec({ embedding_model: "x" }).dims, null);
});

test("dimension rules", () => {
  assert.equal(isValidDims(64), true);
  assert.equal(isValidDims(4000), true);
  assert.equal(isValidDims(63), false);
  assert.equal(isValidDims(4001), false);
  assert.equal(isValidDims(1024.5), false);
  assert.equal(isIndexedDims(1024), true);
  assert.equal(isIndexedDims(1000), false);
  assert.equal(acceptsDimensionParam("openai", "text-embedding-3-large"), true);
  assert.equal(acceptsDimensionParam("openai", "nomic-embed-text"), false);
  assert.equal(acceptsDimensionParam("openai", "text-embedding-ada-002"), false);
  assert.equal(acceptsDimensionParam("cohere", "embed-v4.0"), true);
  assert.equal(acceptsDimensionParam("cohere", "embed-english-v3.0"), false);
  assert.equal(acceptsDimensionParam("voyage", "voyage-3.5-lite"), true);
  assert.equal(acceptsDimensionParam("voyage", "voyage-3"), false);
  assert.equal(acceptsDimensionParam("google", "models/gemini-embedding-001"), true);
  assert.equal(acceptsDimensionParam("nomic", "nomic-embed-text-v1.5"), true);
  assert.equal(acceptsDimensionParam("nomic", "nomic-embed-text-v1"), false);
});

test("default requested dims are capped at the model's native size", () => {
  assert.equal(defaultRequestedDims("nomic", "nomic-embed-text-v1.5"), 768);
  assert.equal(defaultRequestedDims("openai", "text-embedding-3-small"), 1024);
  assert.equal(defaultRequestedDims("google", "models/gemini-embedding-001"), 1024);
  assert.equal(defaultRequestedDims("openai", "unknown-model"), 1024);
});

test("openai request body", () => {
  const req = buildEmbedRequest({ format: "openai", baseUrl: "https://api.openai.com/v1/", apiKey: "sk-test", model: "text-embedding-3-large", texts: ["a", "b"], dimensions: 1024 });
  assert.equal(req.url, "https://api.openai.com/v1/embeddings");
  assert.equal(req.init.method, "POST");
  assert.equal(req.init.headers.Authorization, "Bearer sk-test");
  assert.deepEqual(body(req), { model: "text-embedding-3-large", input: ["a", "b"], encoding_format: "float", dimensions: 1024 });
  const keyless = buildEmbedRequest({ format: "openai", baseUrl: "http://localhost:11434/v1", model: "nomic-embed-text", texts: ["a"] });
  assert.equal(keyless.init.headers.Authorization, undefined);
  assert.equal(body(keyless).dimensions, undefined);
});

test("cohere request body and versioned base URLs", () => {
  const req = buildEmbedRequest({ format: "cohere", baseUrl: "https://api.cohere.com", apiKey: "k", model: "embed-v5.0-pro", texts: ["a"], inputType: "query", dimensions: 1024 });
  assert.equal(req.url, "https://api.cohere.com/v2/embed");
  assert.deepEqual(body(req), { model: "embed-v5.0-pro", texts: ["a"], input_type: "search_query", embedding_types: ["float"], output_dimension: 1024 });
  const doc = buildEmbedRequest({ format: "cohere", baseUrl: "https://compat.example.com/v1", apiKey: "k", model: "m", texts: ["a"] });
  assert.equal(doc.url, "https://compat.example.com/v1/embed");
  assert.equal(body(doc).input_type, "search_document");
});

test("voyage request body", () => {
  const req = buildEmbedRequest({ format: "voyage", baseUrl: "https://api.voyageai.com/v1", apiKey: "k", model: "voyage-3.5", texts: ["a"], inputType: "document", dimensions: 1024 });
  assert.equal(req.url, "https://api.voyageai.com/v1/embeddings");
  assert.deepEqual(body(req), { model: "voyage-3.5", input: ["a"], input_type: "document", output_dimension: 1024 });
});

test("google request body", () => {
  const req = buildEmbedRequest({ format: "google", baseUrl: "https://generativelanguage.googleapis.com/v1beta", apiKey: "g-key", model: "models/gemini-embedding-001", texts: ["a", "b"], inputType: "query", dimensions: 768 });
  assert.equal(req.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents");
  assert.equal(req.init.headers["x-goog-api-key"], "g-key");
  const parsed = body(req);
  assert.equal(parsed.requests.length, 2);
  assert.deepEqual(parsed.requests[0], {
    model: "models/gemini-embedding-001",
    content: { parts: [{ text: "a" }] },
    taskType: "RETRIEVAL_QUERY",
    outputDimensionality: 768,
  });
});

test("nomic request body", () => {
  const req = buildEmbedRequest({ format: "nomic", baseUrl: "https://api-atlas.nomic.ai/v1", apiKey: "nk-test", model: "nomic-embed-text-v1.5", texts: ["a", "b"], inputType: "query", dimensions: 512 });
  assert.equal(req.url, "https://api-atlas.nomic.ai/v1/embedding/text");
  assert.equal(req.init.headers.Authorization, "Bearer nk-test");
  assert.deepEqual(body(req), { model: "nomic-embed-text-v1.5", texts: ["a", "b"], task_type: "search_query", dimensionality: 512 });
  const doc = buildEmbedRequest({ format: "nomic", baseUrl: "https://api-atlas.nomic.ai/v1", apiKey: "nk-test", model: "nomic-embed-text-v1", texts: ["a"] });
  assert.deepEqual(body(doc), { model: "nomic-embed-text-v1", texts: ["a"], task_type: "search_document" });
});

test("unknown formats throw", () => {
  assert.throws(() => buildEmbedRequest({ format: "nope", baseUrl: "x", model: "m", texts: [] }));
  assert.throws(() => parseEmbedResponse("nope", {}));
});

test("response parsers", () => {
  const openai = parseEmbedResponse("openai", { data: [{ index: 1, embedding: [3, 4] }, { index: 0, embedding: [1, 2] }], usage: { total_tokens: 7 } }, ["a", "b"]);
  assert.deepEqual(openai, { vectors: [[1, 2], [3, 4]], tokens: 7 });
  const cohere = parseEmbedResponse("cohere", { embeddings: { float: [[1, 2]] }, meta: { billed_units: { input_tokens: 3 } } }, ["a"]);
  assert.deepEqual(cohere, { vectors: [[1, 2]], tokens: 3 });
  const voyage = parseEmbedResponse("voyage", { data: [{ index: 0, embedding: [5] }], usage: { total_tokens: 2 } }, ["a"]);
  assert.deepEqual(voyage, { vectors: [[5]], tokens: 2 });
  const google = parseEmbedResponse("google", { embeddings: [{ values: [1, 1] }] }, ["abcdefgh"]);
  assert.deepEqual(google, { vectors: [[1, 1]], tokens: 2 });
  const nomic = parseEmbedResponse("nomic", { embeddings: [[1, 2], [3, 4]], usage: { prompt_tokens: 5, total_tokens: 5 } }, ["a", "b"]);
  assert.deepEqual(nomic, { vectors: [[1, 2], [3, 4]], tokens: 5 });
  assert.throws(() => parseEmbedResponse("nomic", { embeddings: [[1]] }, ["a", "b"]), /Expected 2 vectors/);
  assert.throws(() => parseEmbedResponse("openai", { data: [] }, ["a"]), /Expected 1 vectors/);
  assert.throws(() => parseEmbedResponse("cohere", { embeddings: {} }, ["a"]), /no vectors/);
});

test("batch planning respects count and character limits", () => {
  const texts = Array.from({ length: 200 }, () => "x");
  const cohere = planBatches(texts, { format: "cohere" });
  assert.deepEqual(cohere, [{ start: 0, end: 96 }, { start: 96, end: 192 }, { start: 192, end: 200 }]);
  assert.equal(planBatches(texts, { format: "openai" }).length, 1);
  assert.equal(BATCH_LIMITS.voyage, 128);
  assert.equal(BATCH_LIMITS.google, 100);
  assert.equal(BATCH_LIMITS.nomic, 96);
  const long = ["a".repeat(60), "b".repeat(60), "c".repeat(10)];
  assert.deepEqual(planBatches(long, { format: "openai", maxChars: 100 }), [{ start: 0, end: 1 }, { start: 1, end: 3 }]);
  assert.deepEqual(planBatches(["z".repeat(500)], { format: "openai", maxChars: 100 }), [{ start: 0, end: 1 }]);
  assert.deepEqual(planBatches([], { format: "openai" }), []);
});

test("pgvector literal", () => {
  assert.equal(toPgVector([0.1, -2, 3e-5]), "[0.1,-2,0.00003]");
  assert.throws(() => toPgVector([]));
  assert.throws(() => toPgVector([1, NaN]));
  assert.throws(() => toPgVector("1,2"));
});

// --- Images ---------------------------------------------------------------------

const PNG = { data: "aGVsbG8=", mimeType: "image/png" }; // "hello"
const JPEG = { data: "d29ybGQ=", mimeType: "image/jpeg" }; // "world"

test("suggested models declare modalities; image ones resolve an image model", () => {
  const imageIds = [];
  for (const [format, list] of Object.entries(SUGGESTED_EMBEDDING_MODELS)) {
    for (const m of list) {
      assert.ok(Array.isArray(m.modalities) && m.modalities.includes("text"), m.id);
      if (!m.modalities.includes("image")) continue;
      imageIds.push(m.id);
      assert.ok(imageEmbeddingSpec({ format, model: m.id, dims: m.nativeDims }), m.id);
    }
  }
  assert.deepEqual(imageIds.sort(), ["embed-v4.0", "embed-v5.0-fast", "embed-v5.0-pro", "gemini-embedding-2", "voyage-multimodal-3.5"]);
  const gemini2 = SUGGESTED_EMBEDDING_MODELS.google.find((m) => m.id === "gemini-embedding-2");
  assert.deepEqual([gemini2.nativeDims, gemini2.dimensionParam], [3072, true]);
  const voyageMm = SUGGESTED_EMBEDDING_MODELS.voyage.find((m) => m.id === "voyage-multimodal-3.5");
  assert.deepEqual([voyageMm.nativeDims, voyageMm.dimensionParam], [1024, false]);
  assert.deepEqual(IMAGE_BATCH_LIMITS, { google: 1, voyage: 32, cohere: 16, nomic: 16 });
});

test("imageEmbeddingSpec maps each format's multimodal models (nomic only at 768 dims)", () => {
  const spec = (format, model, dims = 1024) => imageEmbeddingSpec({ format, model, dims });
  assert.deepEqual(spec("google", "gemini-embedding-2"), { model: "gemini-embedding-2" });
  assert.deepEqual(spec("google", "models/gemini-embedding-2-preview"), { model: "models/gemini-embedding-2-preview" });
  assert.equal(spec("google", "gemini-embedding-001"), null);
  assert.deepEqual(spec("voyage", "voyage-multimodal-3.5"), { model: "voyage-multimodal-3.5" });
  assert.equal(spec("voyage", "voyage-3.5"), null);
  assert.deepEqual(spec("cohere", "embed-v4.0"), { model: "embed-v4.0" });
  assert.deepEqual(spec("cohere", "embed-v5.0-fast", 1536), { model: "embed-v5.0-fast" });
  assert.equal(spec("cohere", "embed-english-v3.0"), null);
  assert.deepEqual(spec("nomic", "nomic-embed-text-v1.5", 768), { model: "nomic-embed-vision-v1.5" });
  assert.deepEqual(spec("nomic", "nomic-embed-text-v1", 768), { model: "nomic-embed-vision-v1" });
  assert.equal(spec("nomic", "nomic-embed-text-v1.5", 512), null);
  assert.equal(spec("nomic", "nomic-embed-text-v1.5", null), null);
  assert.equal(spec("openai", "text-embedding-3-large"), null);
  assert.equal(spec("openai", "nomic-embed-text", 768), null);
  assert.equal(spec("mystery", "gemini-embedding-2"), null);
  assert.equal(spec("google", ""), null);
  assert.equal(imageEmbeddingSpec(), null);
});

test("modelSupportsImages uses the size Detect would pick when dims aren't known", () => {
  assert.equal(modelSupportsImages("google", "gemini-embedding-2"), true);
  assert.equal(modelSupportsImages("google", "gemini-embedding-001"), false);
  assert.equal(modelSupportsImages("cohere", "embed-v4.0", 1024), true);
  assert.equal(modelSupportsImages("voyage", "voyage-multimodal-3.5", null), true);
  assert.equal(modelSupportsImages("nomic", "nomic-embed-text-v1.5", null), true);
  assert.equal(modelSupportsImages("nomic", "nomic-embed-text-v1.5", 512), false);
  assert.equal(modelSupportsImages("nomic", "nomic-embed-text-v1"), true);
  assert.equal(modelSupportsImages("openai", "text-embedding-3-large"), false);
  assert.equal(modelSupportsImages(null, ""), false);
});

test("dimension param for the multimodal models", () => {
  assert.equal(acceptsDimensionParam("google", "gemini-embedding-2"), true);
  assert.equal(acceptsDimensionParam("voyage", "voyage-multimodal-3.5"), false);
  assert.equal(acceptsDimensionParam("nomic", "nomic-embed-vision-v1.5"), false);
  assert.equal(acceptsDimensionParam("cohere", "embed-v5.0-pro"), true);
});

test("gemini-embedding-2 text: task prefixes and no taskType; other Gemini models unchanged", () => {
  const query = body(buildEmbedRequest({ format: "google", baseUrl: "https://generativelanguage.googleapis.com/v1beta", apiKey: "g", model: "gemini-embedding-2", texts: ["red shoes"], inputType: "query", dimensions: 1024 }));
  assert.deepEqual(query.requests[0], {
    model: "models/gemini-embedding-2",
    content: { parts: [{ text: "task: search result | query: red shoes" }] },
    outputDimensionality: 1024,
  });
  const doc = body(buildEmbedRequest({ format: "google", baseUrl: "https://x", model: "models/gemini-embedding-2", texts: ["a", "b"] }));
  assert.deepEqual(doc.requests.map((r) => r.content.parts[0].text), ["title: none | text: a", "title: none | text: b"]);
  assert.ok(doc.requests.every((r) => !("taskType" in r)));
  const legacy = body(buildEmbedRequest({ format: "google", baseUrl: "https://x", model: "gemini-embedding-001", texts: ["a"] }));
  assert.deepEqual(legacy.requests[0], { model: "models/gemini-embedding-001", content: { parts: [{ text: "a" }] }, taskType: "RETRIEVAL_DOCUMENT" });
});

test("voyage multimodal text goes through /multimodalembeddings", () => {
  const req = buildEmbedRequest({ format: "voyage", baseUrl: "https://api.voyageai.com/v1", apiKey: "k", model: "voyage-multimodal-3.5", texts: ["a", "b"], inputType: "query" });
  assert.equal(req.url, "https://api.voyageai.com/v1/multimodalembeddings");
  assert.equal(req.init.headers.Authorization, "Bearer k");
  assert.deepEqual(body(req), {
    model: "voyage-multimodal-3.5",
    inputs: [{ content: [{ type: "text", text: "a" }] }, { content: [{ type: "text", text: "b" }] }],
    input_type: "query",
  });
  const parsed = parseEmbedResponse("voyage", { data: [{ index: 1, embedding: [2] }, { index: 0, embedding: [1] }], usage: { total_tokens: 4 } }, ["a", "b"]);
  assert.deepEqual(parsed, { vectors: [[1], [2]], tokens: 4 });
});

test("google image request: one inline image per :embedContent", () => {
  const req = buildImageEmbedRequest({ format: "google", baseUrl: "https://generativelanguage.googleapis.com/v1beta", apiKey: "g-key", model: "models/gemini-embedding-2", images: [PNG], inputType: "query", dimensions: 768 });
  assert.equal(req.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent");
  assert.equal(req.init.method, "POST");
  assert.equal(req.init.headers["x-goog-api-key"], "g-key");
  assert.equal(req.init.headers["Content-Type"], "application/json");
  assert.deepEqual(body(req), {
    model: "models/gemini-embedding-2",
    content: { parts: [{ inline_data: { mime_type: "image/png", data: "aGVsbG8=" } }] },
    outputDimensionality: 768,
  });
  const plain = body(buildImageEmbedRequest({ format: "google", baseUrl: "https://x", model: "gemini-embedding-2", images: [{ data: "data:image/jpeg;base64,d29ybGQ=" }] }));
  assert.deepEqual(plain.content.parts[0].inline_data, { mime_type: "image/jpeg", data: "d29ybGQ=" });
  assert.equal(plain.outputDimensionality, undefined);
  assert.throws(() => buildImageEmbedRequest({ format: "google", baseUrl: "https://x", model: "gemini-embedding-2", images: [PNG, JPEG] }), /at most 1/);
});

test("voyage image request: base64 data URIs and input_type", () => {
  const req = buildImageEmbedRequest({ format: "voyage", baseUrl: "https://api.voyageai.com/v1", apiKey: "vk", model: "voyage-multimodal-3.5", images: [PNG, JPEG] });
  assert.equal(req.url, "https://api.voyageai.com/v1/multimodalembeddings");
  assert.equal(req.init.headers.Authorization, "Bearer vk");
  assert.deepEqual(body(req), {
    model: "voyage-multimodal-3.5",
    inputs: [
      { content: [{ type: "image_base64", image_base64: "data:image/png;base64,aGVsbG8=" }] },
      { content: [{ type: "image_base64", image_base64: "data:image/jpeg;base64,d29ybGQ=" }] },
    ],
    input_type: "document",
  });
  assert.equal(body(buildImageEmbedRequest({ format: "voyage", baseUrl: "https://x", model: "m", images: [PNG], inputType: "query" })).input_type, "query");
});

test("cohere image request: v2 inputs with image_url data URIs", () => {
  const req = buildImageEmbedRequest({ format: "cohere", baseUrl: "https://api.cohere.com", apiKey: "co", model: "embed-v4.0", images: [JPEG], inputType: "query", dimensions: 1024 });
  assert.equal(req.url, "https://api.cohere.com/v2/embed");
  assert.equal(req.init.headers.Authorization, "Bearer co");
  assert.deepEqual(body(req), {
    model: "embed-v4.0",
    inputs: [{ content: [{ type: "image_url", image_url: { url: "data:image/jpeg;base64,d29ybGQ=" } }] }],
    input_type: "search_query",
    embedding_types: ["float"],
    output_dimension: 1024,
  });
  const versioned = buildImageEmbedRequest({ format: "cohere", baseUrl: "https://compat.example.com/v1", model: "embed-v4.0", images: [PNG] });
  assert.equal(versioned.url, "https://compat.example.com/v1/embed");
  assert.equal(body(versioned).input_type, "search_document");
  assert.equal(body(versioned).output_dimension, undefined);
});

test("nomic image request: multipart with the vision model and one part per image", async () => {
  const req = buildImageEmbedRequest({ format: "nomic", baseUrl: "https://api-atlas.nomic.ai/v1", apiKey: "nk", model: "nomic-embed-vision-v1.5", images: [PNG, JPEG], dimensions: 768 });
  assert.equal(req.url, "https://api-atlas.nomic.ai/v1/embedding/image");
  assert.equal(req.init.method, "POST");
  assert.deepEqual(req.init.headers, { Authorization: "Bearer nk" }, "no Content-Type: fetch adds the boundary");
  assert.ok(req.init.body instanceof FormData);
  assert.equal(req.init.body.get("model"), "nomic-embed-vision-v1.5");
  assert.equal(req.init.body.get("dimensionality"), null);
  const parts = req.init.body.getAll("images");
  assert.equal(parts.length, 2);
  assert.deepEqual(parts.map((p) => [p.name, p.type]), [["image-1.png", "image/png"], ["image-2.jpg", "image/jpeg"]]);
  assert.deepEqual(await Promise.all(parts.map((p) => p.text())), ["hello", "world"]);
});

test("image requests reject formats without image support and bad input", () => {
  assert.throws(() => buildImageEmbedRequest({ format: "openai", baseUrl: "https://x", model: "m", images: [PNG] }), /can't embed images/);
  assert.throws(() => buildImageEmbedRequest({ format: "voyage", baseUrl: "https://x", model: "m", images: [] }), /Nothing to embed/);
  assert.throws(() => buildImageEmbedRequest({ format: "voyage", baseUrl: "https://x", model: "m", images: [{ data: "", mimeType: "image/png" }] }), /base64 data/);
  assert.throws(() => buildImageEmbedRequest({ format: "cohere", baseUrl: "https://x", model: "m", images: Array(17).fill(PNG) }), /at most 16/);
});

test("image response parsers", () => {
  assert.deepEqual(parseImageEmbedResponse("google", { embedding: { values: [1, 2] } }, 1), { vectors: [[1, 2]], tokens: 0 });
  assert.deepEqual(parseImageEmbedResponse("google", { embeddings: [{ values: [3] }], usageMetadata: { promptTokenCount: 258 } }, 1), { vectors: [[3]], tokens: 258 });
  assert.deepEqual(
    parseImageEmbedResponse("voyage", { data: [{ index: 1, embedding: [2] }, { index: 0, embedding: [1] }], usage: { total_tokens: 1200 } }, 2),
    { vectors: [[1], [2]], tokens: 1200 },
  );
  assert.deepEqual(
    parseImageEmbedResponse("cohere", { embeddings: { float: [[1], [2]] }, meta: { billed_units: { input_tokens: 2, image_tokens: 500 } } }, 2),
    { vectors: [[1], [2]], tokens: 502 },
  );
  assert.deepEqual(parseImageEmbedResponse("cohere", { embeddings: { float: [[1]] }, meta: { billed_units: { images: 1 } } }, 1), { vectors: [[1]], tokens: 0 });
  assert.deepEqual(parseImageEmbedResponse("nomic", { embeddings: [[1, 2]], usage: { total_tokens: 6 } }, 1), { vectors: [[1, 2]], tokens: 6 });
  assert.throws(() => parseImageEmbedResponse("nomic", { embeddings: [[1]] }, 2), /Expected 2 vectors/);
  assert.throws(() => parseImageEmbedResponse("google", { embedding: {} }, 1), /no vectors/);
  assert.throws(() => parseImageEmbedResponse("voyage", { data: [{ index: 0, embedding: [] }] }, 1), /no vectors/);
  assert.throws(() => parseImageEmbedResponse("openai", { data: [] }, 1), /can't embed images/);
});
