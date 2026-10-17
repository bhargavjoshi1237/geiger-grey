import { test } from "node:test";
import assert from "node:assert/strict";
import { extractGraph, sweepGraphOrphans } from "./graph_extract.js";
import { PROJECT, fakeAdmin, jsonResponse, provider, stubFetch } from "./test_helpers.js";

// Local / custom provider URLs are opt-in (localProvidersAllowed); with the opt-in, custom
// URLs skip DNS and use the stubbed global fetch instead of the pinned transport.
process.env.GREY_ALLOW_LOCAL_PROVIDERS = "1";

globalThis.AI_SDK_LOG_WARNINGS = false;

const SOURCE = "33333333-3333-4333-8333-333333333333";
const JOB = "44444444-4444-4444-8444-444444444444";
const compat = provider(3, "openai_compatible", { base_url: "http://localhost:8000/v1", models: ["llama"] });
const settings = { project_id: PROJECT, processing_provider_id: compat.id, processing_model: "llama", deleted_at: null };
const TYPES = [
  { kind: "entity", name: "Person" },
  { kind: "entity", name: "Organization" },
  { kind: "entity", name: "Other" },
  { kind: "relation", name: "works_at" },
  { kind: "relation", name: "related_to" },
];

// A's fake client (project_settings, model_providers, provider secret) plus the graph RPCs.
function graphAdmin({ withModel = true, upsertError = null } = {}) {
  const base = fakeAdmin({
    tables: { model_providers: [compat], project_settings: withModel ? [settings] : [] },
    secrets: { [compat.id]: "sk-test-key" },
  });
  const upserts = [];
  const sweeps = [];
  return {
    upserts,
    sweeps,
    from: (table) => base.from(table),
    rpc: async (name, params) => {
      if (name === "ensure_default_ontology") return { data: TYPES, error: null };
      if (name === "kg_upsert_extracted") {
        upserts.push(params);
        if (upsertError) return { data: null, error: upsertError };
        return { data: Object.fromEntries(params.p_payload.entities.map((e) => [e.ref, `id:${e.name}`])), error: null };
      }
      if (name === "kg_sweep_orphans") {
        sweeps.push(params);
        return { data: { entities: 0, relations: 0 }, error: null };
      }
      return base.rpc(name, params);
    },
  };
}

// Chunks of 3000 tokens -> two per 6000-token batch. "Person N" is mentioned in chunk N.
const chunks = (n) =>
  Array.from({ length: n }, (_, i) => ({ id: `chunk-${i}`, content: `Person ${i} works at Org ${i}.`, page: i + 1, start_ms: null, token_count: 3000 }));

const completion = (content, usage = { prompt_tokens: 100, completion_tokens: 20 }) =>
  jsonResponse({
    id: "cmpl",
    object: "chat.completion",
    created: 0,
    model: "llama",
    choices: [{ index: 0, message: { role: "assistant", content: typeof content === "string" ? content : JSON.stringify(content) }, finish_reason: "stop" }],
    usage: { ...usage, total_tokens: usage.prompt_tokens + usage.completion_tokens },
  });

// Answers each batch with the people and organisations named in its excerpts.
function graphFor(prompt) {
  const ids = [...prompt.matchAll(/Person (\d+) works at Org/g)].map((m) => Number(m[1]));
  const entities = [];
  const relations = [];
  ids.forEach((id, i) => {
    const label = `c${i + 1}`;
    entities.push({ ref: `p${id}`, name: `Person ${id}`, type: "Person", aliases: [], description: "", confidence: 0.9, chunks: [label] });
    entities.push({ ref: `o${id}`, name: `Org ${id}`, type: "Organization", aliases: [], description: "", confidence: 0.9, chunks: [label] });
    relations.push({ source: `p${id}`, target: `o${id}`, type: "works_at", confidence: 0.8, chunk: label });
  });
  return { entities, relations };
}

const userText = (call) => call.body.messages.find((m) => m.role === "user").content;
const systemText = (call) => call.body.messages.find((m) => m.role === "system").content;

test("extractGraph extracts in parallel, stores batches in order and reports tokens", async () => {
  const admin = graphAdmin();
  const short = { id: "tiny", content: "Hi", page: 1, start_ms: null, token_count: 5 };
  const fetchStub = stubFetch((url, init, index, call) => {
    assert.equal(url, "http://localhost:8000/v1/chat/completions");
    // Finish out of order: earlier batches answer later.
    return new Promise((resolve) => setTimeout(() => resolve(completion(graphFor(userText(call)))), 40 - index * 10));
  });
  try {
    const result = await extractGraph({ admin, projectId: PROJECT, sourceId: SOURCE, jobId: JOB, chunks: [short, ...chunks(8)], config: { extract: true } });
    assert.equal(result.ok, true);
    assert.deepEqual(result.warnings, []);
    assert.equal(result.entities, 16);
    assert.equal(result.relations, 8);
    assert.equal(result.tokens, 4 * 120);

    assert.equal(fetchStub.calls.length, 4);
    assert.ok(!fetchStub.calls.some((c) => userText(c).includes("Hi")), "chunks under 20 tokens are skipped");
    assert.deepEqual(
      admin.upserts.map((u) => u.p_payload.entities.filter((e) => e.type === "Person").map((e) => e.name)),
      [["Person 0", "Person 1"], ["Person 2", "Person 3"], ["Person 4", "Person 5"], ["Person 6", "Person 7"]],
    );
    const first = admin.upserts[0];
    assert.equal(first.p_project, PROJECT);
    assert.equal(first.p_source, SOURCE);
    assert.equal(first.p_payload.job_id, JOB);
    assert.deepEqual(first.p_payload.entities[0].mentions, [{ chunk_id: "chunk-0", page: 1, start_ms: null }]);
    assert.deepEqual(first.p_payload.relations[0], {
      source: "e1",
      target: "e2",
      type: "works_at",
      confidence: 0.8,
      mention: { chunk_id: "chunk-0", page: 1, start_ms: null },
    });

    // The 4th batch starts only after the 1st is stored, so it sees the 1st batch's names.
    assert.doesNotMatch(systemText(fetchStub.calls[0]), /Names already used/);
    assert.match(systemText(fetchStub.calls[3]), /Names already used[\s\S]*- Person 0/);
  } finally {
    fetchStub.restore();
  }
});

test("extractGraph is skipped with a warning when no processing model is set", async () => {
  const admin = graphAdmin({ withModel: false });
  const fetchStub = stubFetch(() => assert.fail("no LLM call expected"));
  try {
    const result = await extractGraph({ admin, projectId: PROJECT, sourceId: SOURCE, chunks: chunks(2) });
    assert.deepEqual(result, {
      ok: false,
      entities: 0,
      relations: 0,
      tokens: 0,
      warnings: [{ stage: "graph", code: "graph_unavailable", message: "Knowledge graph skipped: set a processing model in Settings → General." }],
    });
  } finally {
    fetchStub.restore();
  }
});

test("extractGraph stops after a rejected key and never leaks provider text", async () => {
  const admin = graphAdmin();
  const fetchStub = stubFetch(() => jsonResponse({ error: { message: "Incorrect API key provided: sk-test-key" } }, 401));
  try {
    const result = await extractGraph({ admin, projectId: PROJECT, sourceId: SOURCE, chunks: chunks(12) });
    assert.equal(result.ok, false);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0].code, "graph_failed");
    assert.match(result.warnings[0].message, /rejected the API key/);
    assert.doesNotMatch(JSON.stringify(result), /sk-test-key|Incorrect/);
    assert.ok(fetchStub.calls.length <= 3, "no batch starts after the failure");
    assert.equal(admin.upserts.length, 0);
  } finally {
    fetchStub.restore();
  }
});

test("extractGraph caps tokens per source", async () => {
  const admin = graphAdmin();
  const fetchStub = stubFetch((url, init, index, call) => completion(graphFor(userText(call))));
  try {
    const result = await extractGraph({ admin, projectId: PROJECT, sourceId: SOURCE, chunks: chunks(5), config: { maxTokensPerSource: 7000 } });
    assert.equal(result.ok, true);
    assert.equal(result.warnings[0].code, "graph_truncated");
    assert.match(result.warnings[0].message, /first 2 of 5 chunks/);
    assert.equal(fetchStub.calls.length, 1);
  } finally {
    fetchStub.restore();
  }
});

test("extractGraph recovers JSON wrapped in prose and reports partial failures", async () => {
  const admin = graphAdmin();
  const fetchStub = stubFetch((url, init, index, call) => {
    if (index === 0) return completion(`Sure! Here it is:\n${JSON.stringify(graphFor(userText(call)))}\nDone.`);
    return completion("I can't help with that.");
  });
  try {
    const result = await extractGraph({ admin, projectId: PROJECT, sourceId: SOURCE, chunks: chunks(4) });
    assert.equal(result.ok, false);
    assert.equal(admin.upserts.length, 1);
    assert.equal(result.entities, 4);
    assert.equal(result.warnings[0].code, "graph_partial");
    assert.match(result.warnings[0].message, /^1 of 2 parts/);
    assert.equal(result.tokens, 240);
  } finally {
    fetchStub.restore();
  }
});

test("extractGraph reports a storage failure without throwing", async () => {
  const admin = graphAdmin({ upsertError: { code: "42883", message: "function does not exist" } });
  const fetchStub = stubFetch((url, init, index, call) => completion(graphFor(userText(call))));
  try {
    const result = await extractGraph({ admin, projectId: PROJECT, sourceId: SOURCE, chunks: chunks(6) });
    assert.equal(result.ok, false);
    assert.deepEqual(result.warnings, [{ stage: "graph", code: "graph_failed", message: "Saving the knowledge graph failed (database error 42883)." }]);
    assert.equal(admin.upserts.length, 1);
  } finally {
    fetchStub.restore();
  }
});

test("extractGraph never throws, even with a broken client", async () => {
  const result = await extractGraph({ admin: null, projectId: PROJECT, sourceId: SOURCE, chunks: chunks(2) });
  assert.equal(result.ok, false);
  assert.equal(result.warnings[0].stage, "graph");
});

test("sweepGraphOrphans calls the sweep and never throws", async () => {
  const admin = graphAdmin();
  await sweepGraphOrphans({ admin, projectId: PROJECT, sourceId: SOURCE });
  assert.deepEqual(admin.sweeps, [{ p_project: PROJECT, p_source: SOURCE }]);
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await sweepGraphOrphans({ admin: { rpc: () => Promise.reject(new Error("down")) }, projectId: PROJECT, sourceId: SOURCE });
    await sweepGraphOrphans({ admin: { rpc: async () => ({ error: { code: "42883", message: "missing" } }) }, projectId: PROJECT });
  } finally {
    console.warn = originalWarn;
  }
});
