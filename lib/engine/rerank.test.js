import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { rerank } from "./rerank.js";
import { PROJECT, fakeAdmin, jsonResponse, provider, stubFetch } from "./test_helpers.js";

// Local / custom provider URLs are opt-in (localProvidersAllowed); with the opt-in, custom
// URLs skip DNS and use the stubbed global fetch instead of the pinned transport.
process.env.GREY_ALLOW_LOCAL_PROVIDERS = "1";

let stub = null;
afterEach(() => {
  stub?.restore();
  stub = null;
});

const cohere = provider(1, "cohere");
const voyage = provider(2, "voyage");
const jina = provider(3, "cohere", { base_url: "https://api.jina.ai/v1", metadata: { preset: "jina", capabilities: ["rerank"] } });
const openai = provider(4, "openai");
const admin = fakeAdmin({
  tables: { model_providers: [cohere, voyage, jina, openai] },
  secrets: { [cohere.id]: "co", [voyage.id]: "vo", [jina.id]: "ji", [openai.id]: "sk-x" },
});
const docs = ["alpha", "beta", "gamma"];

test("cohere format: sorted desc, invalid indexes dropped", async () => {
  stub = stubFetch(() =>
    jsonResponse({ results: [{ index: 2, relevance_score: 0.2 }, { index: 0, relevance_score: 0.9 }, { index: 7, relevance_score: 1 }, { index: 0, relevance_score: 0.1 }] }),
  );
  const out = await rerank({ admin, projectId: PROJECT, providerId: cohere.id, model: "rerank-v3.5", query: "q", documents: docs, topN: 2 });
  assert.deepEqual(out, [{ index: 0, score: 0.9 }, { index: 2, score: 0.2 }]);
  assert.equal(stub.calls[0].url, "https://api.cohere.com/v2/rerank");
  assert.deepEqual(stub.calls[0].body, { model: "rerank-v3.5", query: "q", documents: docs, top_n: 2 });
  assert.equal(stub.calls[0].init.headers.Authorization, "Bearer co");
});

test("versioned cohere-compatible base URLs take the bare path (Jina)", async () => {
  stub = stubFetch(() => jsonResponse({ results: [{ index: 1, relevance_score: 0.5 }] }));
  const out = await rerank({ admin, projectId: PROJECT, providerId: jina.id, query: "q", documents: docs });
  assert.equal(stub.calls[0].url, "https://api.jina.ai/v1/rerank");
  assert.equal(stub.calls[0].body.model, "jina-reranker-v2-base-multilingual", "falls back to the preset's suggestion");
  assert.deepEqual(out, [{ index: 1, score: 0.5 }]);
});

test("voyage format", async () => {
  stub = stubFetch(() => jsonResponse({ data: [{ index: 1, relevance_score: 0.4 }, { index: 2, relevance_score: 0.8 }] }));
  const out = await rerank({ admin, projectId: PROJECT, providerId: voyage.id, model: "rerank-2.5-lite", query: "q", documents: docs, topN: 5 });
  assert.equal(stub.calls[0].url, "https://api.voyageai.com/v1/rerank");
  assert.equal(stub.calls[0].body.top_k, 3, "topN is clamped to the document count");
  assert.deepEqual(out.map((r) => r.index), [2, 1]);
});

test("no documents means no call; non-rerank connections are refused", async () => {
  stub = stubFetch(() => jsonResponse({}));
  assert.deepEqual(await rerank({ admin, projectId: PROJECT, providerId: cohere.id, query: "q", documents: [] }), []);
  assert.equal(stub.calls.length, 0);
  await assert.rejects(rerank({ admin, projectId: PROJECT, providerId: openai.id, query: "q", documents: docs }), (err) => err.code === "capability_missing");
});

test("an aborted signal cancels the call", async () => {
  stub = stubFetch(() => new Promise(() => {}));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    rerank({ admin, projectId: PROJECT, providerId: cohere.id, model: "m", query: "q", documents: docs, signal: controller.signal }),
    (err) => err.code === "aborted",
  );
});
