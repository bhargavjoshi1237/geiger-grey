import test from "node:test";
import assert from "node:assert/strict";
import {
  citationLocation,
  contextSummary,
  contextText,
  groupConversations,
  passageText,
  replyNotice,
  replyMetrics,
  replySource,
} from "./playground.js";

const NOW = new Date("2026-10-18T15:00:00");
const conv = (id, updatedAt) => ({ id, updatedAt });
const reply = (over = {}) => ({ role: "assistant", content: "Answer", metadata: {}, ...over });

test("groupConversations: newest first, bucketed by calendar day, empty groups dropped", () => {
  const groups = groupConversations(
    [
      conv("old", "2026-07-01T10:00:00"),
      conv("today-early", "2026-10-18T08:00:00"),
      conv("yesterday", "2026-10-17T23:30:00"),
      conv("today-late", "2026-10-18T14:00:00"),
      conv("week", "2026-10-13T09:00:00"),
    ],
    NOW,
  );
  assert.deepEqual(
    groups.map((g) => [g.label, g.items.map((c) => c.id)]),
    [
      ["Today", ["today-late", "today-early"]],
      ["Yesterday", ["yesterday"]],
      ["Previous 7 days", ["week"]],
      ["Older", ["old"]],
    ],
  );
});

test("replyNotice: empty and cut-off length stops point at Max tokens", () => {
  const empty = replyNotice(reply({ content: "", tokensOut: 1024, metadata: { finishReason: "length" } }));
  assert.equal(empty.tone, "warning");
  assert.equal(empty.fixInPipeline, true);
  assert.match(empty.text, /whole output limit \(1,024 tokens\)/);
  assert.match(replyNotice(reply({ metadata: { finishReason: "length" } })).text, /Cut off/);
});

test("replyNotice: errors, stops, and nothing for clean or pending replies", () => {
  assert.equal(replyNotice(reply({ metadata: { error: "provider_timeout" } })).tone, "danger");
  assert.equal(replyNotice(reply({ metadata: { aborted: true } })).tone, "neutral");
  assert.equal(replyNotice(reply({ metadata: { finishReason: "stop" } })), null);
  assert.equal(replyNotice(reply({ pending: true, content: "", metadata: { finishReason: "length" } })), null);
  assert.equal(replyNotice({ role: "user", content: "hi" }), null);
});

test("replySource: flags knowledge-base misses and general-knowledge answers", () => {
  assert.equal(replySource(reply({ metadata: { noContext: true } })), "Not found in the knowledge base");
  assert.equal(replySource(reply({ metadata: { knowledgeOnly: false } })), "General knowledge allowed");
  assert.equal(replySource(reply({ metadata: { knowledgeOnly: false, noContext: true } })), "Answered from general knowledge");
  assert.equal(replySource(reply()), null);
});

test("replyMetrics: embedding and generation time with tokens per second", () => {
  const metrics = replyMetrics(
    reply({
      latencyMs: 5413,
      tokensIn: 3347,
      tokensOut: 540,
      metadata: {
        model: "deepseek-flash",
        stats: {
          embedding: { model: "nomic-embed-text-v1.5", ms: 1175, tokens: 9 },
          generation: { ms: 3800, firstTokenMs: 200 },
        },
      },
    }),
  );
  assert.deepEqual(metrics, [
    {
      key: "embedding",
      label: "Embedding",
      time: "1.2s",
      rate: "7.7 tok/s",
      detail: ["nomic-embed-text-v1.5", "9 query tokens in 1.2s"],
    },
    {
      key: "generation",
      label: "LLM",
      time: "3.8s",
      rate: "150 tok/s",
      detail: ["deepseek-flash", "First token after 200ms", "3,347 tokens in · 540 out", "Whole reply 5.4s"],
    },
  ]);
});

test("replyMetrics: only what's known — embedding while streaming, no rate without tokens", () => {
  const streaming = replyMetrics(reply({ pending: true, metadata: { stats: { embedding: { model: null, ms: 80, tokens: 0 } } } }));
  assert.deepEqual(streaming, [{ key: "embedding", label: "Embedding", time: "80ms", rate: null, detail: ["Query embedding"] }]);
  const noFirstToken = replyMetrics(reply({ tokensOut: 100, metadata: { stats: { generation: { ms: 2000, firstTokenMs: null } } } }));
  assert.equal(noFirstToken[0].rate, "50 tok/s");
  assert.deepEqual(replyMetrics(reply()), []);
  assert.deepEqual(replyMetrics({ role: "user" }), []);
});

const passage = (index, over = {}) => ({ index, chunkId: `c${index}`, title: "Novel.txt", page: null, startMs: null, snippet: "Preview…", tokens: 500, ...over });

test("contextSummary: how the passages were chosen and the share of the token budget", () => {
  const passages = [1, 2, 3, 4, 5, 6].map((n) => passage(n));
  assert.equal(
    contextSummary({ passages, tokens: 3226, budgetTokens: 6000, retrieved: 6, candidates: 32 }),
    "Best 6 of 32 matches · 54% of the 6,000-token budget",
  );
  assert.equal(
    contextSummary({ passages, tokens: 6000, budgetTokens: 6000, retrieved: 12, candidates: 40 }),
    "6 of the top 12 matches fit the budget · 100% of the 6,000-token budget",
  );
  assert.equal(contextSummary({ passages: [passage(1)], tokens: 10, retrieved: 1, candidates: 1 }), "All 1 match");
  assert.equal(contextSummary({ passages: [] }), null);
  assert.equal(contextSummary(undefined), null);
});

test("passageText / contextText: the text as sent, trimmed blocks cut where the engine cut them", () => {
  const contents = new Map([["c1", "Full first passage."], ["c2", "The second passage runs long."]]);
  const trimmed = passage(2, { truncated: true, chars: 18, page: 4 });
  assert.deepEqual(passageText(passage(1), contents), { text: "Full first passage.", full: true });
  assert.deepEqual(passageText(trimmed, contents), { text: "The second passage…", full: true });
  assert.deepEqual(passageText(passage(3), contents), { text: "Preview…", full: false });
  assert.deepEqual(passageText(passage(1), undefined), { text: "Preview…", full: false });
  assert.equal(
    contextText([passage(1), trimmed], contents),
    "[1] Novel.txt\nFull first passage.\n\n[2] Novel.txt — p. 4\nThe second passage…",
  );
});

test("citationLocation: page, else timestamp, else nothing", () => {
  assert.equal(citationLocation({ page: 12 }), "p. 12");
  assert.equal(citationLocation({ page: null, startMs: 75_000 }), "1m 15s");
  assert.equal(citationLocation({ page: null, startMs: null }), null);
});
