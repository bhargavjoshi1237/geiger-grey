import { test } from "node:test";
import assert from "node:assert/strict";
import { markdownToBlocks, plainInline, tokensToBlocks } from "./markdown_blocks.js";

// Hand-written tokens in the shape `marked.lexer` produces (the real lexer is exercised in
// worker/test/markdown_blocks.test.mjs, where `marked` is installed).
const tokens = [
  { type: "heading", raw: "# Title", depth: 1, text: "Title" },
  { type: "space", raw: "\n\n" },
  { type: "paragraph", raw: "Para one\nline two", text: "Para one\nline two" },
  { type: "list", raw: "- a\n- b\n  - c\n\n" },
  { type: "table", raw: "| H1 | H2 |\n| --- | --- |\n| a | b |\n| c | d |\n" },
  { type: "code", raw: "```js\nx=1\n```", lang: "js", text: "x=1" },
  { type: "blockquote", raw: "> quote", text: "quote" },
  { type: "html", raw: "<div>Some <b>html</b></div>" },
  { type: "hr", raw: "---" },
  { type: "heading", raw: "## **Bold** [link](http://x)", depth: 2, text: "**Bold** [link](http://x)" },
];

test("tokens become typed blocks with the page attached", () => {
  const blocks = tokensToBlocks(tokens, { page: 3 });
  assert.deepEqual(
    blocks.map((b) => b.type),
    ["heading", "paragraph", "list", "table", "code", "blockquote", "paragraph", "heading"],
  );
  assert.ok(blocks.every((b) => b.page === 3));
  assert.equal(blocks[0].depth, 1);
  assert.equal(blocks[0].text, "Title");
  assert.equal(blocks[2].text, "- a\n- b\n  - c");
  assert.equal(blocks[6].text, "Some html");
  assert.equal(blocks[7].text, "Bold link");
});

test("tables keep header and rows separately", () => {
  const table = tokensToBlocks(tokens).find((b) => b.type === "table");
  assert.deepEqual(table.header, ["| H1 | H2 |", "| --- | --- |"]);
  assert.deepEqual(table.rows, ["| a | b |", "| c | d |"]);
});

test("markdownToBlocks lexes each page with the injected lexer", () => {
  const seen = [];
  const lexer = (md) => {
    seen.push(md);
    return [{ type: "paragraph", raw: md }];
  };
  const blocks = markdownToBlocks([{ page: 1, markdown: "one" }, { page: 2, markdown: "  " }, { page: 3, markdown: "three" }], { lexer });
  assert.deepEqual(seen, ["one", "three"]);
  assert.deepEqual(blocks.map((b) => [b.page, b.text]), [[1, "one"], [3, "three"]]);
  assert.equal(markdownToBlocks("plain", { lexer })[0].page, null);
  assert.throws(() => markdownToBlocks("x"));
});

test("plainInline strips inline markdown", () => {
  assert.equal(plainInline("`code` and *em* and ![img](x.png)"), "code and em and img");
  assert.equal(plainInline("Set API_KEY_NAME and _this_"), "Set API_KEY_NAME and this");
});
