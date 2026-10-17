import { test } from "node:test";
import assert from "node:assert/strict";
import { filterTextLayerPages, routeDocument, routePage, MIN_TEXT_LAYER_CHARS } from "./ocr_routing.js";

const long = "x".repeat(MIN_TEXT_LAYER_CHARS);
const short = "x".repeat(MIN_TEXT_LAYER_CHARS - 1);

test("without OCR, layout presets fall back to text with a warning and Fast billing", () => {
  for (const parser of ["layout", "vlm", "auto"]) {
    const r = routeDocument({ parser, format: "pdf" });
    assert.equal(r.engine, "text");
    assert.equal(r.tierDowngraded, true);
    assert.deepEqual(r.warnings.map((w) => w.code), ["layout_unavailable"]);
    assert.equal(r.pageRouting, true);
  }
});

test("text parser needs no warning and keeps its tier", () => {
  const r = routeDocument({ parser: "text", format: "pdf" });
  assert.equal(r.engine, "text");
  assert.equal(r.tierDowngraded, false);
  assert.deepEqual(r.warnings, []);
});

test("layout warning only for layout-sensitive formats", () => {
  assert.equal(routeDocument({ parser: "layout", format: "office" }).warnings.length, 1);
  const md = routeDocument({ parser: "layout", format: "plain" });
  assert.equal(md.warnings.length, 0);
  assert.equal(md.tierDowngraded, true);
  assert.equal(md.pageRouting, false);
});

test("images fail without OCR and route to OCR when available", () => {
  assert.equal(routeDocument({ parser: "text", format: "image" }).error.code, "image_ocr_unavailable");
  assert.equal(routeDocument({ parser: "text", format: "image", ocrAvailable: true }).engine, "ocr");
});

test("with OCR available: layout/vlm -> OCR, auto -> per page", () => {
  assert.equal(routeDocument({ parser: "layout", format: "pdf", ocrAvailable: true }).engine, "ocr");
  assert.equal(routeDocument({ parser: "vlm", format: "pdf", ocrAvailable: true }).engine, "ocr");
  assert.equal(routeDocument({ parser: "auto", format: "pdf", ocrAvailable: true }).engine, "auto");
  assert.equal(routeDocument({ parser: "text", format: "pdf", ocrAvailable: true }).engine, "text");
});

test("routePage: text layer threshold", () => {
  assert.equal(routePage({ parser: "auto", textChars: 200, ocrAvailable: true }), "text");
  assert.equal(routePage({ parser: "auto", textChars: 199, ocrAvailable: true }), "ocr");
  assert.equal(routePage({ parser: "text", ocr: true, textChars: 10, ocrAvailable: true }), "ocr");
  assert.equal(routePage({ parser: "text", ocr: false, textChars: 10, ocrAvailable: true }), "skip");
  assert.equal(routePage({ parser: "auto", textChars: 10, ocrAvailable: false }), "skip");
});

test("short pages are skipped with ocr_unavailable", () => {
  const r = filterTextLayerPages([{ page: 1, markdown: long }, { page: 2, markdown: short }, { page: 3, markdown: "" }], { parser: "text" });
  assert.deepEqual(r.pages.map((p) => p.page), [1]);
  assert.deepEqual(r.skipped, [2, 3]);
  assert.deepEqual(r.warnings.map((w) => w.code), ["ocr_unavailable"]);
  assert.equal(r.error, null);
});

test("a PDF with no text at all fails", () => {
  const r = filterTextLayerPages([{ page: 1, markdown: "  " }, { page: 2, markdown: "" }], { parser: "text" });
  assert.equal(r.error.code, "pdf_no_text");
  assert.equal(r.pages.length, 0);
});

test("all-short PDFs keep their non-empty pages instead of failing", () => {
  const r = filterTextLayerPages([{ page: 1, markdown: "Title slide" }, { page: 2, markdown: "" }], { parser: "text" });
  assert.deepEqual(r.pages.map((p) => p.page), [1]);
  assert.deepEqual(r.skipped, [2]);
  assert.equal(r.error, null);
  assert.equal(r.warnings[0].code, "ocr_unavailable");
});
