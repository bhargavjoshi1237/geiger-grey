import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { detectEmbeddingDims, embedImages, embedTexts, kbImageSupport, toPgVector } from "./embeddings.js";
import * as nomicDriver from "./drivers/embed/nomic.js";
import { PROJECT, fakeAdmin, jsonResponse, provider, stubFetch, uuid } from "./test_helpers.js";

// Local / custom provider URLs are opt-in (localProvidersAllowed); with the opt-in, custom
// URLs skip DNS and use the stubbed global fetch instead of the pinned transport.
process.env.GREY_ALLOW_LOCAL_PROVIDERS = "1";

let stub = null;
afterEach(() => {
  stub?.restore();
  stub = null;
});

const openaiVectors = (body, dims) =>
  jsonResponse({
    data: body.input.map((_, index) => ({ index, embedding: Array(dims).fill(index / 10) })),
    usage: { total_tokens: body.input.length },
  });

const openai = provider(1, "openai");
const cohere = provider(2, "cohere");
const local = provider(3, "openai_compatible", { base_url: "http://localhost:11434/v1", metadata: { capabilities: ["chat", "embed"] } });
const anthropic = provider(4, "anthropic");
const nomic = provider(5, "nomic");
const admin = fakeAdmin({
  tables: { model_providers: [openai, cohere, local, anthropic, nomic] },
  secrets: { [openai.id]: "sk-openai-test-key", [cohere.id]: "co-key", [anthropic.id]: "sk-ant-key", [nomic.id]: "nk-nomic-key" },
});
const kb = (extra) => ({ id: uuid(99), embedding_provider_id: openai.id, embedding_model: "text-embedding-3-large", embedding_dims: 1024, ...extra });
const codeIs = (code) => (err) => err.code === code;

test("a knowledge base without a provider fails with an actionable message", async () => {
  await assert.rejects(
    embedTexts({ admin, projectId: PROJECT, kb: kb({ embedding_provider_id: null }), texts: ["a"] }),
    (err) => err.code === "no_embedding_provider" && /Choose an embedding provider/.test(err.message),
  );
  await assert.rejects(embedTexts({ admin, projectId: PROJECT, kb: kb({ embedding_dims: null }), texts: ["a"] }), codeIs("no_embedding_dims"));
});

test("batches, orders and sends the dimension param when the model accepts it", async () => {
  stub = stubFetch((url, init, i, call) => openaiVectors(call.body, 1024));
  const texts = Array.from({ length: 300 }, (_, i) => `t${i}`);
  const out = await embedTexts({ admin, projectId: PROJECT, kb: kb(), texts, inputType: "document" });
  assert.equal(stub.calls.length, 2);
  assert.equal(stub.calls[0].url, "https://api.openai.com/v1/embeddings");
  assert.equal(stub.calls[0].body.dimensions, 1024);
  assert.equal(stub.calls[0].init.headers.Authorization, "Bearer sk-openai-test-key");
  assert.deepEqual(stub.calls.map((c) => c.body.input.length).sort((a, b) => a - b), [44, 256]);
  assert.equal(out.vectors.length, 300);
  assert.equal(out.tokens, 300);
  assert.equal(out.dims, 1024);
  assert.ok(out.vectors.every((v) => v.length === 1024));
  assert.equal(await embedTexts({ admin, projectId: PROJECT, kb: kb(), texts: [] }).then((r) => r.vectors.length), 0);
});

test("vectors of the wrong length fail with EMBED_DIM_MISMATCH", async () => {
  stub = stubFetch((url, init, i, call) => openaiVectors(call.body, 768));
  await assert.rejects(
    embedTexts({ admin, projectId: PROJECT, kb: kb(), texts: ["a"] }),
    (err) => err.code === "EMBED_DIM_MISMATCH" && /768-dimension vectors but this knowledge base expects 1024/.test(err.message),
  );
});

test("retries 429 honouring Retry-After, but not auth errors", async () => {
  stub = stubFetch((url, init, i, call) => (i === 0 ? jsonResponse({}, 429, { "retry-after": "0" }) : openaiVectors(call.body, 1024)));
  const out = await embedTexts({ admin, projectId: PROJECT, kb: kb(), texts: ["a"], inputType: "query" });
  assert.equal(stub.calls.length, 2);
  assert.equal(out.vectors.length, 1);
  stub.restore();

  stub = stubFetch(() => jsonResponse({ error: { message: "Incorrect API key sk-openai-test-key" } }, 401));
  await assert.rejects(embedTexts({ admin, projectId: PROJECT, kb: kb(), texts: ["a"] }), (err) => {
    assert.equal(err.code, "provider_auth");
    assert.equal(err.providerStatus, 401);
    assert.doesNotMatch(err.message, /sk-openai/);
    return true;
  });
  assert.equal(stub.calls.length, 1);
  stub.restore();

  stub = stubFetch(() => jsonResponse({}, 503, { "retry-after": "120" }));
  await assert.rejects(embedTexts({ admin, projectId: PROJECT, kb: kb(), texts: ["a"] }), (err) => err.code === "provider_unavailable" && err.retryable);
  assert.equal(stub.calls.length, 1, "a Retry-After over 10 s fails fast");
});

test("keeps at most 3 batches in flight", async () => {
  let active = 0;
  let peak = 0;
  stub = stubFetch(async (url, init, i, call) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return jsonResponse({ embeddings: { float: call.body.texts.map(() => Array(1024).fill(0)) }, meta: { billed_units: { input_tokens: 1 } } });
  });
  const texts = Array.from({ length: 96 * 7 }, () => "x");
  const out = await embedTexts({ admin, projectId: PROJECT, kb: kb({ embedding_provider_id: cohere.id, embedding_model: "embed-v4.0" }), texts });
  assert.equal(stub.calls.length, 7);
  assert.ok(peak <= 3, `peak ${peak}`);
  assert.equal(out.tokens, 7);
});

test("legacy KB values resolve through the legacy table", async () => {
  stub = stubFetch((url, init, i, call) => jsonResponse({ embeddings: { float: call.body.texts.map(() => Array(1024).fill(0)) } }));
  await embedTexts({ admin, projectId: PROJECT, kb: kb({ embedding_provider_id: cohere.id, embedding_model: "cohere-embed-5-pro", embedding_dims: null }), texts: ["a"], inputType: "query" });
  assert.equal(stub.calls[0].url, "https://api.cohere.com/v2/embed");
  assert.equal(stub.calls[0].body.model, "embed-v5.0-pro");
  assert.equal(stub.calls[0].body.output_dimension, 1024);
  assert.equal(stub.calls[0].body.input_type, "search_query");
  await assert.rejects(
    embedTexts({ admin, projectId: PROJECT, kb: kb({ embedding_model: "cohere-embed-5-pro" }), texts: ["a"] }),
    codeIs("capability_missing"),
  );
});

test("connections must exist, embed and have a key (local servers may skip it)", async () => {
  await assert.rejects(embedTexts({ admin, projectId: PROJECT, kb: kb({ embedding_provider_id: uuid(404) }), texts: ["a"] }), codeIs("provider_not_found"));
  await assert.rejects(embedTexts({ admin, projectId: PROJECT, kb: kb({ embedding_provider_id: anthropic.id }), texts: ["a"] }), codeIs("capability_missing"));
  const noKey = fakeAdmin({ tables: { model_providers: [openai] } });
  await assert.rejects(embedTexts({ admin: noKey, projectId: PROJECT, kb: kb(), texts: ["a"] }), codeIs("no_key"));

  stub = stubFetch((url, init, i, call) => openaiVectors(call.body, 768));
  const out = await embedTexts({ admin, projectId: PROJECT, kb: kb({ embedding_provider_id: local.id, embedding_model: "nomic-embed-text", embedding_dims: 768 }), texts: ["a"] });
  assert.equal(out.dims, 768);
  assert.equal(stub.calls[0].url, "http://localhost:11434/v1/embeddings");
  assert.equal(stub.calls[0].init.headers.Authorization, undefined);
  assert.equal(stub.calls[0].body.dimensions, undefined);
  assert.equal(stub.calls[0].init.redirect, "error");
});

test("private custom base URLs are blocked without the local opt-in, whatever NODE_ENV", async () => {
  const previous = { NODE_ENV: process.env.NODE_ENV, GREY_ALLOW_LOCAL_PROVIDERS: process.env.GREY_ALLOW_LOCAL_PROVIDERS };
  delete process.env.GREY_ALLOW_LOCAL_PROVIDERS;
  stub = stubFetch(() => assert.fail("no request may be sent"));
  try {
    for (const nodeEnv of [undefined, "test", "production"]) {
      if (nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = nodeEnv;
      await assert.rejects(
        embedTexts({ admin, projectId: PROJECT, kb: kb({ embedding_provider_id: local.id, embedding_model: "nomic-embed-text", embedding_dims: 768 }), texts: ["a"] }),
        codeIs("unsafe_base_url"),
        String(nodeEnv),
      );
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("detect reports the vector length, asking for 1024 when supported", async () => {
  stub = stubFetch((url, init, i, call) => openaiVectors(call.body, call.body.dimensions || 3072));
  assert.deepEqual(await detectEmbeddingDims({ admin, projectId: PROJECT, providerId: openai.id, model: "text-embedding-3-large" }), { dims: 1024 });
  assert.equal(stub.calls[0].body.input[0], "ping");
  assert.deepEqual(await detectEmbeddingDims({ admin, projectId: PROJECT, providerId: openai.id, model: "text-embedding-3-small", requestedDims: 512 }), { dims: 512 });
  assert.deepEqual(await detectEmbeddingDims({ admin, projectId: PROJECT, providerId: openai.id, model: "text-embedding-ada-002" }), { dims: 3072 });
  assert.equal(stub.calls[2].body.dimensions, undefined);
  await assert.rejects(detectEmbeddingDims({ admin, projectId: PROJECT, providerId: openai.id, model: "" }), codeIs("no_embedding_model"));
  await assert.rejects(detectEmbeddingDims({ admin, projectId: PROJECT, providerId: openai.id, model: "m", requestedDims: 5000 }), codeIs("bad_dims"));
  stub.restore();
  stub = stubFetch((url, init, i, call) => openaiVectors(call.body, 8192));
  await assert.rejects(detectEmbeddingDims({ admin, projectId: PROJECT, providerId: local.id, model: "big" }), codeIs("unsupported_dims"));
});

test("nomic: Atlas endpoint, task types, and detect capped at 768", async () => {
  stub = stubFetch((url, init, i, call) =>
    jsonResponse({ embeddings: call.body.texts.map(() => Array(call.body.dimensionality || 768).fill(0)), usage: { total_tokens: 4 } }),
  );
  assert.deepEqual(await detectEmbeddingDims({ admin, projectId: PROJECT, providerId: nomic.id, model: "nomic-embed-text-v1.5" }), { dims: 768 });
  assert.equal(stub.calls[0].url, "https://api-atlas.nomic.ai/v1/embedding/text");
  assert.equal(stub.calls[0].body.dimensionality, 768);
  assert.equal(stub.calls[0].init.headers.Authorization, "Bearer nk-nomic-key");

  const out = await embedTexts({
    admin,
    projectId: PROJECT,
    kb: kb({ embedding_provider_id: nomic.id, embedding_model: "nomic-embed-text-v1.5", embedding_dims: 512 }),
    texts: ["a", "b"],
    inputType: "query",
  });
  assert.equal(stub.calls[1].body.task_type, "search_query");
  assert.equal(stub.calls[1].body.dimensionality, 512);
  assert.deepEqual(out.vectors.map((v) => v.length), [512, 512]);
  assert.equal(out.tokens, 4);
});

test("toPgVector is re-exported for writers", () => {
  assert.equal(toPgVector([1, 2]), "[1,2]");
});

// --- Images ---------------------------------------------------------------------

const google = provider(20, "google");
const voyage = provider(21, "voyage");
const imageAdmin = fakeAdmin({
  tables: { model_providers: [openai, cohere, nomic, google, voyage] },
  secrets: { [openai.id]: "sk-openai-test-key", [cohere.id]: "co-key", [nomic.id]: "nk-nomic-key", [google.id]: "g-key", [voyage.id]: "vk-key" },
});
// Image i carries data "img<i>" so responses can encode which image they embedded.
const images = (n) => Array.from({ length: n }, (_, i) => ({ data: btoa(`img${i}`), mimeType: "image/jpeg" }));
const imageIndex = (data) => Number(atob(data).slice(3));

// stubFetch parses bodies as JSON; multipart (Nomic) requests need the raw init.
function stubRawFetch(handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init, calls.length - 1);
  };
  return { calls, restore: () => (globalThis.fetch = original) };
}

test("embedImages (google): one :embedContent per image, ordered, at most 3 in flight", async () => {
  let active = 0;
  let peak = 0;
  stub = stubFetch(async (url, init, i, call) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    const index = imageIndex(call.body.content.parts[0].inline_data.data);
    return jsonResponse({ embedding: { values: Array(1024).fill(index) } });
  });
  const out = await embedImages({
    admin: imageAdmin,
    projectId: PROJECT,
    kb: kb({ embedding_provider_id: google.id, embedding_model: "gemini-embedding-2", embedding_dims: 1024 }),
    images: images(5),
  });
  assert.equal(stub.calls.length, 5);
  assert.ok(peak <= 3, `peak ${peak}`);
  assert.equal(stub.calls[0].url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent");
  assert.equal(stub.calls[0].init.headers["x-goog-api-key"], "g-key");
  assert.equal(stub.calls[0].body.outputDimensionality, 1024);
  assert.equal(stub.calls[0].body.taskType, undefined);
  assert.equal(stub.calls[0].body.content.parts[0].inline_data.mime_type, "image/jpeg");
  assert.deepEqual(out.vectors.map((v) => v[0]), [0, 1, 2, 3, 4]);
  assert.deepEqual([out.dims, out.tokens], [1024, 0]);
});

test("embedImages (voyage): batches of 32, query input type, no dimension param", async () => {
  stub = stubFetch((url, init, i, call) =>
    jsonResponse({
      data: call.body.inputs.map((input, index) => ({ index, embedding: Array(1024).fill(imageIndex(input.content[0].image_base64.split(",")[1])) })),
      usage: { total_tokens: 10 * call.body.inputs.length },
    }),
  );
  const out = await embedImages({
    admin: imageAdmin,
    projectId: PROJECT,
    kb: kb({ embedding_provider_id: voyage.id, embedding_model: "voyage-multimodal-3.5", embedding_dims: 1024 }),
    images: images(40),
    inputType: "query",
  });
  assert.deepEqual(stub.calls.map((c) => c.body.inputs.length).sort((a, b) => a - b), [8, 32]);
  assert.equal(stub.calls[0].url, "https://api.voyageai.com/v1/multimodalembeddings");
  assert.equal(stub.calls[0].init.headers.Authorization, "Bearer vk-key");
  assert.equal(stub.calls[0].body.input_type, "query");
  assert.equal(stub.calls[0].body.output_dimension, undefined);
  assert.match(stub.calls[0].body.inputs[0].content[0].image_base64, /^data:image\/jpeg;base64,/);
  assert.deepEqual(out.vectors.map((v) => v[0]), Array.from({ length: 40 }, (_, i) => i));
  assert.equal(out.tokens, 400);
});

test("embedImages (cohere, legacy key): image_url inputs with the KB's output dimension", async () => {
  stub = stubFetch((url, init, i, call) =>
    jsonResponse({ embeddings: { float: call.body.inputs.map(() => Array(1024).fill(0)) }, meta: { billed_units: { image_tokens: 7 } } }),
  );
  const out = await embedImages({
    admin: imageAdmin,
    projectId: PROJECT,
    kb: kb({ embedding_provider_id: cohere.id, embedding_model: "cohere-embed-5-pro", embedding_dims: null }),
    images: images(2),
  });
  assert.equal(stub.calls.length, 1);
  assert.equal(stub.calls[0].url, "https://api.cohere.com/v2/embed");
  assert.equal(stub.calls[0].body.model, "embed-v5.0-pro");
  assert.equal(stub.calls[0].body.input_type, "search_document");
  assert.equal(stub.calls[0].body.output_dimension, 1024);
  assert.deepEqual(stub.calls[0].body.embedding_types, ["float"]);
  assert.equal(stub.calls[0].body.inputs[0].content[0].type, "image_url");
  assert.deepEqual([out.vectors.length, out.tokens, out.dims], [2, 7, 1024]);
});

test("embedImages (nomic): multipart to the paired vision model, only at 768 dims", async () => {
  stub = stubRawFetch((url, init) =>
    jsonResponse({ embeddings: init.body.getAll("images").map(() => Array(768).fill(0)), usage: { total_tokens: 3 } }),
  );
  const nomicKb = (dims) => kb({ embedding_provider_id: nomic.id, embedding_model: "nomic-embed-text-v1.5", embedding_dims: dims });
  const out = await embedImages({ admin: imageAdmin, projectId: PROJECT, kb: nomicKb(768), images: images(2) });
  assert.equal(stub.calls.length, 1);
  assert.equal(stub.calls[0].url, "https://api-atlas.nomic.ai/v1/embedding/image");
  assert.deepEqual(stub.calls[0].init.headers, { Authorization: "Bearer nk-nomic-key" });
  assert.equal(stub.calls[0].init.body.get("model"), "nomic-embed-vision-v1.5");
  assert.equal(stub.calls[0].init.body.getAll("images").length, 2);
  assert.deepEqual([out.vectors.length, out.tokens, out.dims], [2, 3, 768]);

  await assert.rejects(embedImages({ admin: imageAdmin, projectId: PROJECT, kb: nomicKb(512), images: images(1) }), codeIs("images_unsupported"));
  assert.equal(stub.calls.length, 1);
});

test("embedImages rejects vectors of the wrong length with EMBED_DIM_MISMATCH", async () => {
  stub = stubFetch(() => jsonResponse({ embedding: { values: Array(768).fill(0) } }));
  await assert.rejects(
    embedImages({
      admin: imageAdmin,
      projectId: PROJECT,
      kb: kb({ embedding_provider_id: google.id, embedding_model: "gemini-embedding-2", embedding_dims: 1024 }),
      images: images(1),
    }),
    (err) => err.code === "EMBED_DIM_MISMATCH" && /768-dimension vectors but this knowledge base expects 1024/.test(err.message),
  );
});

test("embedImages: text-only models fail with images_unsupported before any request", async () => {
  stub = stubFetch(() => assert.fail("no request may be sent"));
  await assert.rejects(embedImages({ admin: imageAdmin, projectId: PROJECT, kb: kb(), images: images(1) }), (err) => {
    assert.equal(err.code, "images_unsupported");
    assert.equal(err.status, 422);
    assert.equal(err.message, "This knowledge base's embedding model can't embed images.");
    return true;
  });
  await assert.rejects(
    embedImages({ admin: imageAdmin, projectId: PROJECT, kb: kb({ embedding_provider_id: google.id, embedding_model: "gemini-embedding-001" }), images: images(1) }),
    codeIs("images_unsupported"),
  );
  await assert.rejects(embedImages({ admin: imageAdmin, projectId: PROJECT, kb: kb({ embedding_provider_id: null }), images: images(1) }), codeIs("no_embedding_provider"));
  const geminiKb = kb({ embedding_provider_id: google.id, embedding_model: "gemini-embedding-2" });
  await assert.rejects(embedImages({ admin: imageAdmin, projectId: PROJECT, kb: geminiKb, images: [{ mimeType: "image/png" }] }), codeIs("invalid_image"));
  assert.deepEqual(await embedImages({ admin: imageAdmin, projectId: PROJECT, kb: geminiKb, images: [] }), { vectors: [], tokens: 0, dims: 1024 });
});

test("embedTexts on gemini-embedding-2 sends task prefixes instead of taskType", async () => {
  stub = stubFetch((url, init, i, call) => jsonResponse({ embeddings: call.body.requests.map(() => ({ values: Array(1024).fill(0) })) }));
  await embedTexts({
    admin: imageAdmin,
    projectId: PROJECT,
    kb: kb({ embedding_provider_id: google.id, embedding_model: "gemini-embedding-2" }),
    texts: ["red shoes"],
    inputType: "query",
  });
  assert.equal(stub.calls[0].url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:batchEmbedContents");
  assert.deepEqual(stub.calls[0].body.requests[0], {
    model: "models/gemini-embedding-2",
    content: { parts: [{ text: "task: search result | query: red shoes" }] },
    outputDimensionality: 1024,
  });
});

test("image drivers take an injected fetch and map odd payloads to bad_response", async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return jsonResponse({ embeddings: [] });
  };
  await assert.rejects(
    nomicDriver.embedImages({ baseUrl: "https://api-atlas.nomic.ai/v1", apiKey: "nk", model: "nomic-embed-vision-v1.5", images: images(1), retries: 0, fetch }),
    (err) => err.code === "bad_response" && err.status === 502,
  );
  assert.equal(calls.length, 1);
  assert.ok(calls[0].init.body instanceof FormData);
});

test("kbImageSupport reports the image model and never throws", async () => {
  const support = (extra, client = imageAdmin) => kbImageSupport({ admin: client, projectId: PROJECT, kb: kb(extra) });
  assert.deepEqual(await support({ embedding_provider_id: google.id, embedding_model: "gemini-embedding-2" }), {
    supported: true,
    model: "gemini-embedding-2",
    format: "google",
  });
  assert.deepEqual(await support({ embedding_provider_id: nomic.id, embedding_model: "nomic-embed-text-v1.5", embedding_dims: 768 }), {
    supported: true,
    model: "nomic-embed-vision-v1.5",
    format: "nomic",
  });
  assert.deepEqual(await support({ embedding_provider_id: cohere.id, embedding_model: "cohere-embed-5-fast", embedding_dims: null }), {
    supported: true,
    model: "embed-v5.0-fast",
    format: "cohere",
  });
  const none = { supported: false, model: null, format: null };
  assert.deepEqual(await support({}), none, "openai text model");
  assert.deepEqual(await support({ embedding_provider_id: nomic.id, embedding_model: "nomic-embed-text-v1.5", embedding_dims: 512 }), none);
  assert.deepEqual(await support({ embedding_provider_id: openai.id, embedding_model: "cohere-embed-5-pro" }), none, "legacy key on the wrong format");
  assert.deepEqual(await support({ embedding_provider_id: uuid(404), embedding_model: "gemini-embedding-2" }), none);
  assert.deepEqual(await support({ embedding_provider_id: google.id, embedding_model: "gemini-embedding-2", embedding_dims: null }), none);
  assert.deepEqual(await support({ embedding_provider_id: null }), none);
  assert.deepEqual(await kbImageSupport({ admin: imageAdmin, projectId: PROJECT, kb: null }), none);
  const broken = { from: () => { throw new Error("db down"); } };
  assert.deepEqual(await support({ embedding_provider_id: google.id, embedding_model: "gemini-embedding-2" }, broken), none);
});
