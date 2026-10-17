import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSearchText, chunkDocument, normalizeChunking, splitTableRows, splitText } from "./chunker.js";

// One token per whitespace-separated word keeps budgets easy to reason about.
const countTokens = (t) => (String(t).match(/\S+/g) || []).length;
const words = (n, w = "word") => Array.from({ length: n }, (_, i) => `${w}${i}`).join(" ");
const sentences = (n, len = 9) => Array.from({ length: n }, (_, i) => `${words(len, `s${i}w`)}.`).join(" ");

const h = (depth, text, page = 1) => ({ type: "heading", depth, text, page });
const p = (text, page = 1) => ({ type: "paragraph", text, page });
const table = (rows, cols = 3, page = 1) => {
  const header = [`| ${Array.from({ length: cols }, (_, i) => `H${i}`).join(" | ")} |`, `| ${Array(cols).fill("---").join(" | ")} |`];
  const body = Array.from({ length: rows }, (_, r) => `| ${Array.from({ length: cols }, (_, c) => `r${r}c${c}`).join(" | ")} |`);
  return { type: "table", text: [...header, ...body].join("\n"), header, rows: body, page };
};

const cfg = (extra = {}) => ({ strategy: "recursive", size: 50, overlap: 10, atomicTables: true, headingBreadcrumbs: true, ...extra });

test("normalizeChunking clamps and defaults", () => {
  assert.deepEqual(normalizeChunking({}), { strategy: "recursive", size: 512, overlap: 64, atomicTables: true, headingBreadcrumbs: true });
  assert.equal(normalizeChunking({ size: 100, overlap: 90 }).overlap, 50);
  assert.equal(normalizeChunking({ strategy: "bogus" }).strategy, "recursive");
});

test("heading breadcrumbs land in search_text and heading_path", () => {
  const { chunks } = chunkDocument([h(1, "Guide"), h(2, "Setup"), p("Install the thing.")], cfg(), { countTokens, title: "Manual" });
  assert.equal(chunks.length, 1);
  assert.deepEqual(chunks[0].heading_path, ["Guide", "Setup"]);
  assert.equal(chunks[0].breadcrumb, "Manual > Guide > Setup");
  assert.equal(chunks[0].content, "## Setup\n\nInstall the thing.");
  assert.equal(chunks[0].search_text, "Manual > Guide > Setup\n\n## Setup\n\nInstall the thing.");
});

test("breadcrumbs can be turned off", () => {
  const { chunks } = chunkDocument([h(1, "Guide"), p("Body text.")], cfg({ headingBreadcrumbs: false }), { countTokens, title: "Manual" });
  assert.equal(chunks[0].breadcrumb, null);
  assert.equal(chunks[0].search_text, chunks[0].content);
});

test("heading levels pop correctly", () => {
  const { chunks } = chunkDocument([h(1, "A"), h(2, "B"), p("one"), h(2, "C"), p("two"), h(1, "D"), p("three")], cfg(), { countTokens });
  assert.deepEqual(chunks.map((c) => c.heading_path), [["A", "B"], ["A", "C"], ["D"]]);
});

test("sections never share a chunk and heading-only sections produce nothing", () => {
  const { chunks } = chunkDocument([p("intro"), h(1, "Empty"), h(2, "Child"), p("child body")], cfg(), { countTokens });
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].heading_path, null);
  assert.deepEqual(chunks[1].heading_path, ["Empty", "Child"]);
});

test("overlap is carried forward within a section only", () => {
  const blocks = [h(1, "One"), p(sentences(4)), p(sentences(4)), p(sentences(4)), h(1, "Two"), p(sentences(4))];
  const { chunks } = chunkDocument(blocks, cfg({ size: 60, overlap: 10 }), { countTokens });
  const one = chunks.filter((c) => c.heading_path?.[0] === "One");
  const two = chunks.filter((c) => c.heading_path?.[0] === "Two");
  assert.ok(one.length >= 2);
  // second chunk of section One starts with the tail of the first
  const carried = one[1].content.split("\n\n")[0];
  assert.ok(countTokens(carried) > 0 && countTokens(carried) <= 10);
  assert.ok(one[0].content.endsWith(carried));
  // the first chunk of section Two does not start with section One's tail
  assert.ok(two[0].content.startsWith("# Two"));
});

test("token budget is never exceeded outside tables", () => {
  const blocks = [];
  for (let s = 0; s < 6; s += 1) {
    blocks.push(h(1 + (s % 3), `Section ${s}`, s + 1));
    for (let b = 0; b < 5; b += 1) blocks.push(p(sentences(1 + ((s * 7 + b * 3) % 9), 4 + ((s + b) % 11)), s + 1));
    blocks.push(p(words(200 + s * 13), s + 1));
  }
  for (const size of [32, 50, 128]) {
    const { chunks } = chunkDocument(blocks, cfg({ size, overlap: Math.floor(size / 4) }), { countTokens });
    assert.ok(chunks.length > 0);
    for (const c of chunks) {
      assert.ok(c.token_count <= size, `chunk ${c.ordinal} has ${c.token_count} > ${size}`);
      assert.equal(c.token_count, countTokens(c.content));
    }
    assert.deepEqual(chunks.map((c) => c.ordinal), chunks.map((_, i) => i));
  }
});

test("a heading never ends up alone in a chunk", () => {
  const { chunks } = chunkDocument([h(2, "Title"), p(words(50))], cfg({ size: 50 }), { countTokens });
  assert.ok(chunks.every((c) => c.content !== "## Title"));
  assert.ok(chunks[0].content.startsWith("## Title\n\nword0"));
  assert.ok(chunks.every((c) => c.token_count <= 50));
});

test("atomic tables stay whole up to 2x size", () => {
  const t = table(20); // header 2 lines of 7 tokens + 20 rows of 7 tokens = 154 tokens
  const tokens = countTokens(t.text);
  const size = Math.ceil(tokens / 1.5);
  const { chunks } = chunkDocument([h(1, "Data"), t], cfg({ size }), { countTokens });
  const tableChunks = chunks.filter((c) => c.metadata.table);
  assert.equal(tableChunks.length, 1);
  assert.ok(tableChunks[0].token_count > size);
  assert.ok(tableChunks[0].content.includes("r19c2"));
});

test("tables over 2x size split by rows and repeat the header", () => {
  const t = table(40);
  const { chunks } = chunkDocument([t], cfg({ size: 50 }), { countTokens });
  assert.ok(chunks.length > 1);
  for (const c of chunks) {
    assert.ok(c.content.startsWith(`${t.header[0]}\n${t.header[1]}\n`));
    assert.ok(c.token_count <= 50);
    assert.equal(c.metadata.table, true);
  }
  const rows = chunks.flatMap((c) => c.content.split("\n").slice(2));
  assert.deepEqual(rows, t.rows);
});

test("non-atomic tables split at size with the header repeated", () => {
  const t = table(12); // 98 tokens
  const { chunks } = chunkDocument([t], cfg({ size: 50, atomicTables: false }), { countTokens });
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every((c) => c.content.startsWith(t.header[0])));
});

test("oversized paragraphs split on sentences", () => {
  const text = sentences(12, 9); // 120 tokens
  const parts = splitText(text, 50, countTokens);
  assert.ok(parts.length >= 3);
  assert.ok(parts.every((x) => countTokens(x) <= 50));
  assert.ok(parts.every((x) => x.endsWith(".")));
});

test("splitText hard-splits unbreakable text", () => {
  const parts = splitText("x".repeat(100), 1, (t) => Math.ceil(t.length / 10));
  assert.equal(parts.length, 10);
  assert.ok(parts.every((x) => x.length === 10));
});

test("splitTableRows keeps every row exactly once", () => {
  const t = table(9);
  const parts = splitTableRows(t, 25, countTokens);
  assert.deepEqual(parts.flatMap((x) => x.split("\n").slice(2)), t.rows);
});

test("page strategy: one chunk per page", () => {
  const blocks = [h(1, "A", 1), p("one", 1), p("more one", 1), p("two", 2), h(2, "B", 3), p("three", 3)];
  const { chunks, meta } = chunkDocument(blocks, cfg({ strategy: "page" }), { countTokens });
  assert.equal(meta.strategy, "page");
  assert.deepEqual(chunks.map((c) => c.page), [1, 2, 3]);
  assert.equal(chunks[0].content, "# A\n\none\n\nmore one");
  assert.deepEqual(chunks[1].heading_path, ["A"]);
  assert.deepEqual(chunks[2].heading_path, ["A", "B"]);
});

test("page strategy splits oversized pages", () => {
  const { chunks } = chunkDocument([p(sentences(20), 1)], cfg({ strategy: "page", size: 50 }), { countTokens });
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((c) => c.page === 1 && c.token_count <= 50));
});

test("fixed strategy: token windows with overlap", () => {
  const blocks = [p(words(100), 1), p(words(100, "other"), 2)];
  const { chunks, meta } = chunkDocument(blocks, cfg({ strategy: "fixed", size: 50, overlap: 10 }), { countTokens });
  assert.equal(meta.strategy, "fixed");
  assert.ok(chunks.length >= 4);
  assert.ok(chunks.every((c) => c.token_count <= 50));
  for (let i = 1; i < chunks.length; i += 1) {
    const prevTail = chunks[i - 1].content.split(/\s+/).slice(-10);
    const head = chunks[i].content.split(/\s+/).slice(0, 10);
    assert.deepEqual(head, prevTail);
  }
  assert.equal(chunks[0].page, 1);
  assert.equal(chunks[chunks.length - 1].page, 2);
});

test("semantic falls back to recursive and says so", () => {
  const { chunks, meta } = chunkDocument([p("hello world")], cfg({ strategy: "semantic" }), { countTokens });
  assert.equal(meta.strategy, "recursive");
  assert.equal(meta.requested, "semantic");
  assert.equal(meta.fallback, "semantic");
  assert.equal(chunks.length, 1);
});

test("pages are tracked with pageEnd when a chunk spans pages", () => {
  const { chunks } = chunkDocument([p("a b c", 1), p("d e f", 2)], cfg(), { countTokens });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].page, 1);
  assert.equal(chunks[0].metadata.pageEnd, 2);
});

test("empty input produces no chunks", () => {
  assert.deepEqual(chunkDocument([], cfg(), { countTokens }).chunks, []);
  assert.deepEqual(chunkDocument([p("   ")], cfg(), { countTokens }).chunks, []);
});

test("buildSearchText joins breadcrumb, context and content", () => {
  assert.equal(buildSearchText({ breadcrumb: "A > B", context: "About X.", content: "Body" }), "A > B\n\nAbout X.\n\nBody");
  assert.equal(buildSearchText({ content: "Body" }), "Body");
});
