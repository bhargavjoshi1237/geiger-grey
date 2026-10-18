import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildContextBlocks,
  buildSystemPrompt,
  estimateTokens,
  formatTimestamp,
  truncateToTokens,
  windowHistory,
} from "./prompt.js";

const chunk = (id, content, extra = {}) => ({ chunkId: id, sourceId: `s-${id}`, sourceName: `Doc ${id}`, content, ...extra });

test("formatTimestamp: mm:ss and h:mm:ss", () => {
  assert.equal(formatTimestamp(0), "00:00");
  assert.equal(formatTimestamp(75_000), "01:15");
  assert.equal(formatTimestamp(3_725_000), "1:02:05");
  assert.equal(formatTimestamp(null), "00:00");
});

test("truncateToTokens: keeps short text, cuts long text with an ellipsis", () => {
  assert.equal(truncateToTokens("short", 10), "short");
  const long = "word ".repeat(100);
  const cut = truncateToTokens(long, 10);
  assert.ok(cut.endsWith("…"));
  assert.ok(cut.length <= 41);
});

test("buildContextBlocks: numbered headers with page and timestamp", () => {
  const { text, chunks } = buildContextBlocks([
    chunk("a", "Alpha", { page: 4 }),
    chunk("b", "Beta", { startMs: 195_000 }),
    chunk("c", "Gamma", { page: 2, startMs: 10_000 }),
    chunk("d", "Delta"),
  ]);
  assert.equal(chunks.length, 4);
  assert.equal(
    text,
    "[1] Doc a — p. 4\nAlpha\n\n[2] Doc b — 03:15\nBeta\n\n[3] Doc c — p. 2 | 00:10\nGamma\n\n[4] Doc d\nDelta",
  );
});

test("buildContextBlocks: stops at the budget, caps each chunk, skips empty chunks", () => {
  const big = "x".repeat(4000 * 4);
  const { text, chunks } = buildContextBlocks(
    [chunk("e", ""), chunk("a", big), chunk("b", "small"), chunk("c", big)],
    { budgetTokens: 1300, perChunkTokens: 1200 },
  );
  assert.deepEqual(chunks.map((c) => c.chunkId), ["a", "b"]);
  assert.ok(text.startsWith("[1] Doc a\n"));
  assert.ok(text.includes("[2] Doc b\nsmall"));
  assert.ok(estimateTokens(text) <= 1300);
});

test("buildContextBlocks: always keeps the first chunk, trimmed to the budget", () => {
  const { chunks, text } = buildContextBlocks([chunk("a", "y ".repeat(2000))], { budgetTokens: 50 });
  assert.equal(chunks.length, 1);
  assert.ok(estimateTokens(text) <= 52);
});

test("buildContextBlocks: reports each block's size and how much of a trimmed chunk went in", () => {
  const long = "word ".repeat(2000);
  const context = buildContextBlocks([chunk("a", long), chunk("b", "short text")], { budgetTokens: 6000, perChunkTokens: 100 });
  assert.equal(context.budgetTokens, 6000);
  assert.equal(context.sizes.length, 2);
  const [a, b] = context.sizes;
  assert.equal(a.truncated, true);
  assert.equal(b.truncated, false);
  assert.equal(b.chars, "short text".length);
  // content.slice(0, chars) + "…" is exactly the trimmed body the model received.
  assert.ok(context.text.startsWith(`[1] Doc a\n${long.slice(0, a.chars)}…\n\n[2] Doc b\nshort text`));
  assert.equal(context.tokens, a.tokens + 1 + b.tokens);
});

test("buildSystemPrompt: grounding rules then the pipeline prompt; context in the user turn", () => {
  const { system, user } = buildSystemPrompt({
    systemPrompt: "You are the Acme support bot.",
    citations: true,
    context: "[1] Doc\nBody",
    question: "How do refunds work?",
  });
  assert.match(system, /only the numbered context passages/);
  assert.match(system, /\[1\] or \[2\]\[3\]/);
  assert.ok(system.endsWith("You are the Acme support bot."));
  assert.equal(user, "Context:\n[1] Doc\nBody\n\nQuestion: How do refunds work?");
});

test("buildSystemPrompt: knowledge-only by default forbids training knowledge", () => {
  const { system } = buildSystemPrompt({ context: "[1] Doc\nBody", question: "q" });
  assert.match(system, /only source/);
  assert.match(system, /even when you know them/);
  assert.doesNotMatch(system, /general knowledge/);
});

test("buildSystemPrompt: knowledge-only off allows flagged general knowledge", () => {
  const { system, user } = buildSystemPrompt({ context: "[1] Doc\nBody", question: "q", knowledgeOnly: false });
  assert.match(system, /general knowledge where they fall short/);
  assert.match(system, /Beyond the provided sources/);
  assert.doesNotMatch(system, /only source/);
  assert.equal(user, "Context:\n[1] Doc\nBody\n\nQuestion: q");
});

test("buildSystemPrompt: empty context says no passages matched", () => {
  const { user } = buildSystemPrompt({ context: "", question: "Who is Ayanokoji?", knowledgeOnly: false });
  assert.equal(user, "Context:\nNone — no passages in the connected knowledge bases matched this question.\n\nQuestion: Who is Ayanokoji?");
});

test("buildSystemPrompt: citations off asks for no markers", () => {
  const { system } = buildSystemPrompt({ citations: false, context: "c", question: "q" });
  assert.match(system, /Do not include citation markers/);
  assert.doesNotMatch(system, /Cite the passages/);
});

test("buildSystemPrompt: substitutes {{context}} / {{question}} once, without $-pattern expansion", () => {
  const { system, user } = buildSystemPrompt({
    systemPrompt: "Context:\n{{ context }}\nQ: {{question}}",
    context: "Price is $& and {{question}}",
    question: "What is the price?",
  });
  assert.ok(system.includes("Context:\nPrice is $& and {{question}}\nQ: What is the price?"));
  assert.equal(user, "What is the price?");
});

test("buildSystemPrompt: facts become a Known relationships block", () => {
  const { system, user } = buildSystemPrompt({
    context: "[1] Doc\nBody",
    question: "Who works with Acme?",
    facts: "- Jane — works_at → Acme",
  });
  assert.match(system, /Known relationships/);
  assert.equal(
    user,
    "Context:\n[1] Doc\nBody\n\nKnown relationships:\n- Jane — works_at → Acme\n\nQuestion: Who works with Acme?",
  );
  assert.doesNotMatch(buildSystemPrompt({ context: "c", question: "q" }).user, /Known relationships/);
});

test("windowHistory: keeps the last N turns, drops oldest over budget, starts on a user turn", () => {
  const messages = [];
  for (let i = 0; i < 10; i++) {
    messages.push({ role: "user", content: `q${i}` }, { role: "assistant", content: `a${i}`, extra: true });
  }
  const window = windowHistory(messages, { turns: 2 });
  assert.deepEqual(window, [
    { role: "user", content: "q8" },
    { role: "assistant", content: "a8" },
    { role: "user", content: "q9" },
    { role: "assistant", content: "a9" },
  ]);

  const long = [
    { role: "user", content: "x".repeat(400) },
    { role: "assistant", content: "y".repeat(400) },
    { role: "user", content: "short" },
  ];
  assert.deepEqual(windowHistory(long, { budgetTokens: 120 }), [{ role: "user", content: "short" }]);
});

test("windowHistory: ignores empty, system and malformed messages", () => {
  assert.deepEqual(
    windowHistory([
      { role: "assistant", content: "leading" },
      { role: "system", content: "s" },
      { role: "user", content: "  " },
      null,
      { role: "user", content: "hi" },
    ]),
    [{ role: "user", content: "hi" }],
  );
});
