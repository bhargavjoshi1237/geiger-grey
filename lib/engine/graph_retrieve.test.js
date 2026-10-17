import { test } from "node:test";
import assert from "node:assert/strict";
import { expandWithGraph } from "./graph_retrieve.js";

// Minimal stand-in for the service-role client: records rpc calls and answers from a table.
function fakeAdmin(responses) {
  const calls = [];
  return {
    calls,
    rpc(name, params) {
      calls.push({ name, params });
      const response = typeof responses[name] === "function" ? responses[name](params) : responses[name];
      return Promise.resolve(response ?? { data: null, error: { message: "unexpected rpc" } });
    },
  };
}

const MATCHED = [
  { entity_id: "ent-jane", name: "Jane Smith", type_name: "Person", score: 1 },
  { entity_id: "ent-acme", name: "Acme", type_name: "Organization", score: 0.9 },
];
const EXPANDED = {
  chunks: [
    { chunk_id: "ch-9", source_id: "src-1", source_name: "handbook.pdf", kb_id: "kb-1", content: "Acme HQ", page: 4, start_ms: null, end_ms: null, heading_path: ["About"], score: 1.5 },
  ],
  facts: [{ subject: "Jane Smith", relation: "works_at", object: "Acme", confidence: "0.9" }],
};

test("expandWithGraph returns graph chunks in the searchChunks shape plus facts", async () => {
  const admin = fakeAdmin({ kg_match_query_entities: { data: MATCHED }, kg_expand: { data: EXPANDED } });
  const result = await expandWithGraph({
    admin,
    projectId: "proj",
    kbIds: ["kb-1", "kb-1", null],
    query: "Where does Jane Smith work?",
    seedChunks: [{ chunkId: "ch-1" }, { chunkId: "ch-1" }, { chunkId: "ch-2" }],
    mode: "auto",
  });
  assert.deepEqual(result.chunks, [
    { chunkId: "ch-9", sourceId: "src-1", sourceName: "handbook.pdf", kbId: "kb-1", content: "Acme HQ", score: 1.5, page: 4, startMs: null, endMs: null, headingPath: ["About"], via: "graph" },
  ]);
  assert.deepEqual(result.facts, [{ subject: "Jane Smith", relation: "works_at", object: "Acme", confidence: 0.9 }]);
  assert.deepEqual(result.entities.map((e) => e.id), ["ent-jane", "ent-acme"]);
  assert.deepEqual(admin.calls[0], {
    name: "kg_match_query_entities",
    params: { p_project: "proj", p_kb_ids: ["kb-1"], p_query: "Where does Jane Smith work?", p_limit: 5 },
  });
  assert.deepEqual(admin.calls[1].params, {
    p_project: "proj",
    p_kb_ids: ["kb-1"],
    p_seed: ["ent-jane", "ent-acme"],
    p_exclude_chunks: ["ch-1", "ch-2"],
    p_hops: 2,
    p_max_entities: 40,
    p_max_chunks: 8,
  });
});

test("expandWithGraph skips expansion when the router says no", async () => {
  const admin = fakeAdmin({ kg_match_query_entities: { data: [MATCHED[1]] } });
  const result = await expandWithGraph({ admin, projectId: "proj", kbIds: ["kb-1"], query: "Acme refund policy", mode: "auto" });
  assert.deepEqual(result, { chunks: [], facts: [], entities: [{ id: "ent-acme", name: "Acme", type: "Organization", score: 0.9 }] });
  assert.equal(admin.calls.length, 1);
});

test("expandWithGraph does nothing when off or without KBs or query", async () => {
  const admin = fakeAdmin({});
  const empty = { chunks: [], facts: [], entities: [] };
  assert.deepEqual(await expandWithGraph({ admin, projectId: "proj", kbIds: ["kb-1"], query: "Jane", mode: "off" }), empty);
  assert.deepEqual(await expandWithGraph({ admin, projectId: "proj", kbIds: [], query: "Jane", mode: "always" }), empty);
  assert.deepEqual(await expandWithGraph({ admin, projectId: "proj", kbIds: ["kb-1"], query: "  ", mode: "always" }), empty);
  assert.equal(admin.calls.length, 0);
});

test("expandWithGraph never throws on database errors", async () => {
  const failing = fakeAdmin({ kg_match_query_entities: { data: null, error: { message: "boom" } } });
  assert.deepEqual(await expandWithGraph({ admin: failing, projectId: "proj", kbIds: ["kb-1"], query: "Jane", mode: "always" }), {
    chunks: [],
    facts: [],
    entities: [],
    error: "graph_failed",
  });
  const throwing = {
    rpc() {
      throw new Error("network");
    },
  };
  const result = await expandWithGraph({ admin: throwing, projectId: "proj", kbIds: ["kb-1"], query: "Jane", mode: "always" });
  assert.equal(result.error, "graph_failed");
});

test("expandWithGraph passes the abort signal to supabase queries that support it", async () => {
  const signals = [];
  const admin = {
    rpc(name) {
      const response = name === "kg_match_query_entities" ? { data: MATCHED } : { data: EXPANDED };
      return {
        abortSignal(signal) {
          signals.push(signal);
          return Promise.resolve(response);
        },
      };
    },
  };
  const controller = new AbortController();
  const result = await expandWithGraph({ admin, projectId: "proj", kbIds: ["kb-1"], query: "Jane and Acme", mode: "always", signal: controller.signal });
  assert.equal(result.chunks.length, 1);
  assert.deepEqual(signals, [controller.signal, controller.signal]);
});
