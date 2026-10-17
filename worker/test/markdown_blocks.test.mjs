// markdownToBlocks with the real `marked` lexer, then the chunker with the real tokenizer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { marked } from "marked";
import { countTokens } from "gpt-tokenizer";
import { markdownToBlocks } from "../../lib/grey/markdown_blocks.js";
import { chunkDocument } from "../../lib/grey/chunker.js";
import { parseDocx } from "../ingest/parse/office.mjs";
import { buildDocx } from "./fixtures/build.mjs";

const lexer = (md) => marked.lexer(md);

test("marked tokens map to blocks", () => {
  const md = "# Title\n\nPara one\nline two\n\n## Sub\n\n- a\n- b\n  - c\n\n| H1 | H2 |\n| --- | --- |\n| a | b |\n\n```js\nx=1\n```\n\n> quote\n\n---\n\nSetext\n======\n";
  const blocks = markdownToBlocks([{ page: 4, markdown: md }], { lexer });
  assert.deepEqual(
    blocks.map((b) => b.type),
    ["heading", "paragraph", "heading", "list", "table", "code", "blockquote", "heading"],
  );
  assert.equal(blocks[0].page, 4);
  assert.equal(blocks[3].text, "- a\n- b\n  - c");
  assert.deepEqual(blocks[4].rows, ["| a | b |"]);
  assert.equal(blocks[7].text, "Setext");
  assert.equal(blocks[7].depth, 1);
});

test("a parsed DOCX chunks with breadcrumbs and an atomic table", async () => {
  const { pages } = await parseDocx(buildDocx());
  const blocks = markdownToBlocks(pages, { lexer });
  const { chunks } = chunkDocument(blocks, { size: 512, overlap: 64, atomicTables: true, headingBreadcrumbs: true }, { countTokens, title: "Handbook" });
  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks[0].heading_path, ["Employee Handbook"]);
  assert.deepEqual(chunks[1].heading_path, ["Employee Handbook", "Leave"]);
  assert.equal(chunks[1].breadcrumb, "Handbook > Employee Handbook > Leave");
  assert.equal(chunks[1].metadata.table, true);
  assert.match(chunks[1].content, /\| Sick \| 10 \|/);
  assert.equal(chunks[1].token_count, countTokens(chunks[1].content));
});

test("real tokenizer: budgets hold on a long document", () => {
  const paragraph = "Grey turns documents into searchable chunks. ".repeat(40);
  const md = Array.from({ length: 8 }, (_, i) => `## Part ${i}\n\n${paragraph}\n\n${paragraph}`).join("\n\n");
  const { chunks } = chunkDocument(markdownToBlocks(md, { lexer }), { size: 256, overlap: 32 }, { countTokens });
  assert.ok(chunks.length > 8);
  for (const c of chunks) assert.ok(c.token_count <= 256, `chunk ${c.ordinal}: ${c.token_count}`);
});
