import { test } from "node:test";
import assert from "node:assert/strict";
import { buildContextMessages, documentWindow, enrichChunks } from "./enrich.js";

const chunks = [
  { ordinal: 0, content: "Alpha section text." },
  { ordinal: 1, content: "Beta section text." },
  { ordinal: 2, content: "   " },
];
const resolved = { model: { id: "fake" }, modelId: "claude-haiku-5-5" };

test("short documents are sent whole; long ones in stable half-overlapping windows", () => {
  assert.equal(documentWindow("short doc", "doc"), "short doc");
  const doc = Array.from({ length: 1000 }, (_, i) => `para${i} `).join("");
  const a = documentWindow(doc, "para500", 1000);
  const b = documentWindow(doc, "para501", 1000);
  assert.equal(a.length, 1000);
  assert.ok(a.includes("para500"));
  assert.equal(a, b); // neighbours share the same window (cacheable prefix)
  assert.equal(documentWindow(doc, "not found", 1000), doc.slice(0, 1000));
});

test("the document part is marked for Anthropic prompt caching", () => {
  const [message] = buildContextMessages({ title: 'A "doc"', window: "WINDOW", chunk: "CHUNK" });
  assert.equal(message.role, "user");
  assert.ok(message.content[0].text.includes('title="A \'doc\'"'));
  assert.deepEqual(message.content[0].providerOptions, { anthropic: { cacheControl: { type: "ephemeral" } } });
  assert.ok(message.content[1].text.includes("CHUNK"));
});

test("no processing model -> skipped with a warning", async () => {
  const out = await enrichChunks({ admin: {}, projectId: "p", documentText: "d", chunks, resolveModel: async () => null, generate: async () => assert.fail() });
  assert.equal(out.contexts, null);
  assert.equal(out.warnings[0].code, "enrichment_unavailable");
});

test("an unusable processing model is a warning, not a failure", async () => {
  const out = await enrichChunks({
    admin: {},
    projectId: "p",
    documentText: "d",
    chunks,
    resolveModel: async () => {
      throw Object.assign(new Error("Add an API key for \"X\" in Model Providers."), { name: "EngineError", code: "no_key" });
    },
  });
  assert.equal(out.contexts, null);
  assert.match(out.warnings[0].message, /Add an API key/);
});

test("contexts per ordinal and token totals", async () => {
  const calls = [];
  const out = await enrichChunks({
    admin: {},
    projectId: "p",
    documentText: "Alpha section text. Beta section text.",
    title: "Doc",
    chunks,
    resolveModel: async () => resolved,
    generate: async (args) => {
      calls.push(args);
      return { text: ` Context for ${args.messages[0].content[1].text.includes("Alpha") ? "alpha" : "beta"}. `, usage: { inputTokens: 10, outputTokens: 5 } };
    },
  });
  assert.equal(calls.length, 2); // blank chunk skipped
  assert.equal(out.contexts.get(0), "Context for alpha.");
  assert.equal(out.contexts.get(1), "Context for beta.");
  assert.equal(out.tokens, 30);
  assert.equal(out.model, "claude-haiku-5-5");
  assert.deepEqual(out.warnings, []);
  assert.equal(calls[0].maxOutputTokens, 160);
  assert.equal("temperature" in calls[0], false);
});

test("a rejected key stops early with one warning", async () => {
  let calls = 0;
  const out = await enrichChunks({
    admin: {},
    projectId: "p",
    documentText: "d",
    chunks: Array.from({ length: 10 }, (_, i) => ({ ordinal: i, content: `c${i}` })),
    concurrency: 1,
    resolveModel: async () => resolved,
    generate: async () => {
      calls += 1;
      throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
    },
  });
  assert.equal(calls, 1);
  assert.equal(out.contexts.size, 0);
  assert.equal(out.warnings[0].code, "enrichment_failed");
});

test("partial failures keep the successful contexts", async () => {
  const out = await enrichChunks({
    admin: {},
    projectId: "p",
    documentText: "d",
    chunks: chunks.slice(0, 2),
    concurrency: 1,
    resolveModel: async () => resolved,
    generate: async (args) => {
      if (args.messages[0].content[1].text.includes("Beta")) throw Object.assign(new Error("busy"), { statusCode: 503 });
      return { text: "ok", usage: { totalTokens: 7 } };
    },
  });
  assert.equal(out.contexts.get(0), "ok");
  assert.equal(out.contexts.has(1), false);
  assert.equal(out.tokens, 7);
  assert.equal(out.warnings[0].code, "enrichment_partial");
});
