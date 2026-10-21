// Pure parser routing (spec §6.3 / §6.4). Until the self-hosted OCR service exists
// (GREY_OCR_URL unset) every document goes through the text engines; once it exists,
// `layout`/`vlm` route to it and `auto` routes page by page on the text-layer size.
// Image sources don't come through here: the worker's image branch (worker/ingest/image.mjs)
// indexes them with a vision caption and/or an image embedding. The `image` format below is
// only the OCR-service route for callers that ask for one.

export const MIN_TEXT_LAYER_CHARS = 200;
export const LAYOUT_PARSERS = new Set(["layout", "vlm", "auto"]);

// Formats where layout-aware parsing would differ from the text engine.
const LAYOUT_SENSITIVE = new Set(["pdf", "office"]);

export const ROUTING_WARNINGS = {
  layout_unavailable: "Layout-aware parsing isn't available yet — parsed as plain text.",
  ocr_unavailable: "Some pages have little or no text layer (likely scanned) and were skipped — OCR isn't available yet.",
};

export const ROUTING_ERRORS = {
  image_ocr_unavailable: "Image OCR isn't available — images are indexed with a vision caption or an image embedding instead.",
  pdf_no_text: "This PDF has no text layer; OCR isn't available yet.",
};

const warning = (code) => ({ stage: "parse", code, message: ROUTING_WARNINGS[code] });

// Document-level decision.
//   format: 'pdf' | 'office' | 'spreadsheet' | 'html' | 'plain' | 'notes' | 'image' (OCR route only)
// -> { engine: 'text'|'ocr'|'auto', pageRouting, tierDowngraded, warnings, error }
//   engine 'auto'  -> decide per page with routePage()
//   pageRouting    -> text-engine PDFs still apply the per-page text-layer rule
//   tierDowngraded -> a layout/vlm/auto preset was served by the text engine (bill the Fast tier)
export function routeDocument({ parser = "text", format, ocrAvailable = false } = {}) {
  const wantsLayout = LAYOUT_PARSERS.has(parser);

  if (format === "image") {
    return ocrAvailable
      ? { engine: "ocr", pageRouting: false, tierDowngraded: false, warnings: [], error: null }
      : {
          engine: null,
          pageRouting: false,
          tierDowngraded: false,
          warnings: [],
          error: { code: "image_ocr_unavailable", message: ROUTING_ERRORS.image_ocr_unavailable },
        };
  }

  if (format === "pdf" && ocrAvailable && (parser === "layout" || parser === "vlm")) {
    return { engine: "ocr", pageRouting: false, tierDowngraded: false, warnings: [], error: null };
  }
  if (format === "pdf" && ocrAvailable && parser === "auto") {
    return { engine: "auto", pageRouting: true, tierDowngraded: false, warnings: [], error: null };
  }

  const warnings = wantsLayout && LAYOUT_SENSITIVE.has(format) ? [warning("layout_unavailable")] : [];
  return { engine: "text", pageRouting: format === "pdf", tierDowngraded: wantsLayout, warnings, error: null };
}

// Per-page decision for PDFs: 'text' | 'ocr' | 'skip'.
export function routePage({ parser = "text", ocr = false, textChars = 0, ocrAvailable = false } = {}) {
  if (textChars >= MIN_TEXT_LAYER_CHARS) return "text";
  if (ocrAvailable && (LAYOUT_PARSERS.has(parser) || ocr)) return "ocr";
  return "skip";
}

// Applies routePage to a text-engine PDF. Pages that would be skipped are kept when skipping
// them would drop every page that has any text (a short-text deck is better indexed than lost);
// a PDF with no text at all is an error.
// pages: [{ page, markdown }] -> { pages, skipped: number[], warnings, error }
export function filterTextLayerPages(pages, { parser, ocr, ocrAvailable = false } = {}) {
  const total = pages.reduce((n, p) => n + (p.markdown || "").trim().length, 0);
  if (!total) {
    return { pages: [], skipped: pages.map((p) => p.page), warnings: [], error: { code: "pdf_no_text", message: ROUTING_ERRORS.pdf_no_text } };
  }
  const kept = [];
  const skipped = [];
  for (const p of pages) {
    const chars = (p.markdown || "").trim().length;
    if (routePage({ parser, ocr, textChars: chars, ocrAvailable }) === "skip") skipped.push(p.page);
    else kept.push(p);
  }
  if (!kept.length) {
    const nonEmpty = pages.filter((p) => (p.markdown || "").trim());
    return {
      pages: nonEmpty,
      skipped: pages.filter((p) => !(p.markdown || "").trim()).map((p) => p.page),
      warnings: [warning("ocr_unavailable")],
      error: null,
    };
  }
  return { pages: kept, skipped, warnings: skipped.length ? [warning("ocr_unavailable")] : [], error: null };
}
