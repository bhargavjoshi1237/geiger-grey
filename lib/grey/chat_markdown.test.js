import test from "node:test";
import assert from "node:assert/strict";
import { parseInline, parseMarkdown } from "./chat_markdown.js";

const text = (t) => ({ type: "text", text: t });

test("parseInline: emphasis, code, strike and links", () => {
  assert.deepEqual(parseInline("**Bold** and *it* with `x = 1` ~~old~~"), [
    { type: "strong", children: [text("Bold")] },
    text(" and "),
    { type: "em", children: [text("it")] },
    text(" with "),
    { type: "code", text: "x = 1" },
    text(" "),
    { type: "del", children: [text("old")] },
  ]);
  assert.deepEqual(parseInline("See [docs](https://grey.dev/a) now"), [
    text("See "),
    { type: "link", href: "https://grey.dev/a", children: [text("docs")] },
    text(" now"),
  ]);
});

test("parseInline: citation markers, including lists and runs", () => {
  assert.deepEqual(parseInline("Refunds take 5 days [1][2], see [3, 4]."), [
    text("Refunds take 5 days "),
    { type: "cite", n: 1 },
    { type: "cite", n: 2 },
    text(", see "),
    { type: "cite", n: 3 },
    { type: "cite", n: 4 },
    text("."),
  ]);
});

test("parseInline: no emphasis inside words or arithmetic; bare URLs drop trailing punctuation", () => {
  assert.deepEqual(parseInline("snake_case_name and 2*3*4"), [text("snake_case_name and 2*3*4")]);
  assert.deepEqual(parseInline("Go to https://grey.dev/x."), [
    text("Go to "),
    { type: "link", href: "https://grey.dev/x", children: [text("https://grey.dev/x")] },
    text("."),
  ]);
  assert.deepEqual(parseInline("[x](javascript:alert(1))"), [text("[x](javascript:alert(1))")]);
});

test("parseMarkdown: headings, paragraphs and rules; a list may follow a paragraph line directly", () => {
  const blocks = parseMarkdown("## Summary\nFirst line\nsecond line\n\n---\nPoints:\n- one\n- two");
  assert.deepEqual(blocks.map((b) => b.type), ["heading", "paragraph", "hr", "paragraph", "list"]);
  assert.equal(blocks[0].level, 2);
  assert.deepEqual(blocks[1].inline, [text("First line\nsecond line")]);
  assert.equal(blocks[4].items.length, 2);
});

test("parseMarkdown: ordered lists keep their start, nested lists nest", () => {
  const [list] = parseMarkdown("3. Three\n   - sub a\n   - sub b\n4. Four");
  assert.equal(list.ordered, true);
  assert.equal(list.start, 3);
  assert.equal(list.items.length, 2);
  const [para, nested] = list.items[0].blocks;
  assert.deepEqual(para.inline, [text("Three")]);
  assert.equal(nested.type, "list");
  assert.equal(nested.ordered, false);
  assert.equal(nested.items.length, 2);
});

test("parseMarkdown: fenced code, closed and still streaming", () => {
  const [closed, after] = parseMarkdown("```js\nconst a = 1;\n```\nDone");
  assert.deepEqual(closed, { type: "code", lang: "js", text: "const a = 1;", open: false });
  assert.equal(after.type, "paragraph");
  const [open] = parseMarkdown("```\nline 1\nline 2");
  assert.deepEqual(open, { type: "code", lang: null, text: "line 1\nline 2", open: true });
});

test("parseMarkdown: GFM tables with alignment and short rows", () => {
  const [table] = parseMarkdown("| Name | Score |\n|:-----|------:|\n| Ann | **9** |\n| Bo |");
  assert.equal(table.type, "table");
  assert.deepEqual(table.align, ["left", "right"]);
  assert.deepEqual(table.header, [[text("Name")], [text("Score")]]);
  assert.deepEqual(table.rows[0][1], [{ type: "strong", children: [text("9")] }]);
  assert.deepEqual(table.rows[1][1], []);
});

test("parseMarkdown: block quotes parse their content", () => {
  const [quote] = parseMarkdown("> Quoted **text**\n> - item");
  assert.equal(quote.type, "quote");
  assert.deepEqual(quote.blocks.map((b) => b.type), ["paragraph", "list"]);
});
