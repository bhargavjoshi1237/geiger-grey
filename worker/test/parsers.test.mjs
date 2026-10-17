import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDocx, buildPdf, buildPptx, buildXlsx, HTML_FIXTURE } from "./fixtures/build.mjs";
import { parsePdf, normalizePdfText } from "../ingest/parse/pdf_text.mjs";
import { cellToText, cleanOfficeMarkdown, parseDocx, parseWithOfficeParser, parseXlsx } from "../ingest/parse/office.mjs";
import { parseHtml } from "../ingest/parse/html.mjs";
import { csvToMarkdown, detectDelimiter, parseCsv, parsePlain } from "../ingest/parse/plain.mjs";
import { renderNotesBoard } from "../ingest/parse/notes_board.mjs";
import { parseWithOcrService } from "../ingest/parse/ocr_service.mjs";
import { assertSupported, detectFormat, engineFor, engineVersion, parseDocument, routingFormat } from "../ingest/parse/index.mjs";
import { routeDocument } from "../../lib/grey/ocr_routing.js";

test("PDF: text per page", async () => {
  const out = await parsePdf(buildPdf());
  assert.equal(out.paginated, true);
  assert.equal(out.totalPages, 2);
  assert.equal(out.pages[0].page, 1);
  assert.match(out.pages[0].markdown, /proper text layer/);
  assert.ok(out.pages[0].markdown.length >= 200);
  assert.equal(out.pages[1].markdown, "Short");
});

test("PDF: corrupt input is a permanent JobError", async () => {
  await assert.rejects(parsePdf(Buffer.from("not a pdf")), (err) => err.name === "JobError" && err.code === "corrupt_file" && !err.retryable);
});

test("normalizePdfText trims lines and re-joins hyphenation", () => {
  assert.equal(normalizePdfText("  exam-\nple   text \n\n\n\nnext "), "example text\n\nnext");
});

test("parseDocument applies the 200-character rule to text-engine PDFs", async () => {
  const routing = routeDocument({ parser: "layout", format: "pdf" });
  const out = await parseDocument({ format: "pdf", routing, buffer: buildPdf(), parser: "layout" });
  assert.deepEqual(out.pages.map((p) => p.page), [1]);
  assert.deepEqual(out.warnings.map((w) => w.code).sort(), ["layout_unavailable", "ocr_unavailable"]);
  assert.deepEqual(out.warnings.find((w) => w.code === "ocr_unavailable").pages, [2]);
  assert.equal(out.totalPages, 2);
});

test("parseDocument fails a PDF with no text layer", async () => {
  const routing = routeDocument({ parser: "text", format: "pdf" });
  await assert.rejects(parseDocument({ format: "pdf", routing, buffer: buildPdf([" ", " "]) }), (err) => err.code === "pdf_no_text");
});

test("DOCX: headings and tables survive as Markdown", async () => {
  const { pages, paginated } = await parseDocx(buildDocx());
  assert.equal(paginated, false);
  const md = pages[0].markdown;
  assert.match(md, /^# Employee Handbook/m);
  assert.match(md, /^## Leave/m);
  assert.match(md, /\| Type \| Days \|\n\| --- \| --- \|\n\| Annual \| 25 \|/);
});

test("PPTX: one page per slide", async () => {
  const out = await parseWithOfficeParser(buildPptx());
  assert.equal(out.paginated, true);
  assert.deepEqual(out.pages.map((p) => p.page), [1, 2]);
  assert.equal(out.pages[0].markdown, "# Quarterly results\n\nRevenue grew 12 percent.");
  assert.match(out.pages[1].markdown, /Hire two engineers/);
});

test("officeparser markdown cleanup", () => {
  assert.equal(cleanOfficeMarkdown("---\n\n# Title {#title}\n\nBody"), "# Title\n\nBody");
});

test("XLSX: one table per non-empty sheet", async () => {
  const { pages } = await parseXlsx(await buildXlsx());
  assert.deepEqual(pages.map((p) => p.page), [1, 2]);
  assert.match(pages[0].markdown, /^## Prices\n\n\| Product \| Price \| Updated \|/);
  assert.match(pages[0].markdown, /\| Widget \| 9\.5 \| 2026-01-02 \|/);
  assert.match(pages[0].markdown, /\| Gadget \\\| Pro \| 19 \|  \|/);
  assert.match(pages[1].markdown, /\| Rich text \|/);
});

test("cellToText handles exceljs value shapes", () => {
  assert.equal(cellToText(null), "");
  assert.equal(cellToText({ formula: "A1", result: 3 }), "3");
  assert.equal(cellToText({ text: "link", hyperlink: "https://x" }), "link");
  assert.equal(cellToText({ error: "#DIV/0!" }), "#DIV/0!");
});

test("HTML: Readability picks the article, scripts and navigation are dropped", () => {
  const { pages, title } = parseHtml({ html: HTML_FIXTURE, url: "https://example.com/notes" });
  const md = pages[0].markdown;
  assert.equal(title, "Release notes");
  assert.match(md, /^# Release notes/);
  assert.match(md, /three times faster/);
  assert.match(md, /\| Plan \| Seats \|/);
  assert.match(md, /Diagram of the index/);
  assert.ok(!md.includes("alert(1)"));
  assert.ok(!md.includes("data:image"));
  assert.ok(!md.includes("Copyright"));
  assert.equal((md.match(/^# Release notes/gm) || []).length, 1);
});

test("CSV becomes a Markdown table; quotes and delimiters handled", () => {
  assert.deepEqual(parseCsv('a,"b ""q"", c"\r\n1,2\n'), [["a", 'b "q", c'], ["1", "2"]]);
  assert.equal(detectDelimiter("a;b;c\n1;2;3"), ";");
  assert.equal(csvToMarkdown("name,age\nAda,36\nBob|x,1"), "| name | age |\n| --- | --- |\n| Ada | 36 |\n| Bob\\|x | 1 |");
  const { pages } = parsePlain({ text: "# Title\r\n\r\nBody", format: "markdown" });
  assert.equal(pages[0].markdown, "# Title\n\nBody");
});

test("Notes boards render name, node text and edges", () => {
  const md = renderNotesBoard({
    name: "Launch plan",
    description: "Q3",
    nodes: [
      { id: "b", position: { x: 0, y: 100 }, data: { label: "<p>Ship <b>beta</b></p>" } },
      { id: "a", position: { x: 0, y: 0 }, data: { label: "Research", url: "https://example.com" } },
      { id: "t", position: { x: 0, y: 200 }, type: "todo", data: { items: [{ text: "Write docs", done: true }, "Tweet"] } },
    ],
    edges: [{ source: "a", target: "b" }, { source: "a", target: "missing" }],
  });
  assert.equal(
    md,
    "# Launch plan\n\nQ3\n\nResearch\n\nhttps://example.com\n\nShip beta\n\n- [x] Write docs\n- [ ] Tweet\n\n## Connections\n\n- Research → Ship beta",
  );
});

test("format detection by mime, extension and sniffing", () => {
  assert.equal(detectFormat({ mime: "application/pdf" }), "pdf");
  assert.equal(detectFormat({ mime: "application/octet-stream", name: "Report.DOCX" }), "docx");
  assert.equal(detectFormat({ mime: "text/html; charset=utf-8" }), "html");
  assert.equal(detectFormat({ mime: "audio/mpeg" }), "audio");
  assert.equal(detectFormat({ mime: "image/png" }), "image");
  assert.equal(detectFormat({ origin: "notes" }), "notes");
  assert.equal(detectFormat({ name: "old.doc" }), "legacy");
  assert.equal(detectFormat({ name: "x", head: Buffer.from("%PDF-1.7 ...") }), "pdf");
  assert.equal(detectFormat({ name: "x", head: Buffer.from("<!DOCTYPE html><html>") }), "html");
  assert.equal(detectFormat({ name: "x", head: Buffer.from("plain words") }), "text");
  assert.equal(detectFormat({ name: "x", head: Buffer.from([0, 1, 2, 3]) }), "unknown");
  assert.throws(() => assertSupported("legacy"), (e) => e.code === "unsupported_format");
  assert.throws(() => assertSupported("unknown"), (e) => e.code === "unsupported_format");
});

test("routing format and engine identity", () => {
  assert.equal(routingFormat("docx"), "office");
  assert.equal(routingFormat("csv"), "plain");
  assert.equal(engineFor("pdf", { engine: "text" }), "unpdf");
  assert.equal(engineFor("pdf", { engine: "ocr" }), "ocr");
  assert.match(engineVersion("unpdf"), /^unpdf@\d+\.\d+\.\d+#r\d+$/);
  assert.match(engineVersion("plain"), /^plain#r\d+$/);
});

test("OCR adapter: unset GREY_OCR_URL is a permanent ocr_not_configured", async () => {
  await assert.rejects(parseWithOcrService({ fileUrl: "https://x", mime: "application/pdf", ocrUrl: "" }), (e) => e.code === "ocr_not_configured" && e.retryable === false);
});

test("OCR adapter: calls the service when configured", async () => {
  let body;
  const out = await parseWithOcrService({
    fileUrl: "https://x/file.pdf",
    mime: "application/pdf",
    pages: [2],
    ocrUrl: "https://ocr.internal.test/parse",
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return { ok: true, status: 200, json: async () => ({ pages: [{ page: 2, markdown: "scanned" }] }) };
    },
  });
  assert.deepEqual(body, { fileUrl: "https://x/file.pdf", mime: "application/pdf", pages: [2] });
  assert.deepEqual(out.pages, [{ page: 2, markdown: "scanned" }]);
});
