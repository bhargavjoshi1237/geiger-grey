// Parse stage dispatcher (spec §6.2–6.4): format detection, routing (text engines now, the OCR
// service later), and one entry point that returns { pages: [{ page, markdown }], ... }.
import { createRequire } from "node:module";
import { JobError } from "../../../lib/grey/ingest_errors.js";
import { filterTextLayerPages, routeDocument, routePage } from "../../../lib/grey/ocr_routing.js";
import { parsePdf } from "./pdf_text.mjs";
import { parseDocx, parseXlsx, parseWithOfficeParser } from "./office.mjs";
import { parseHtml } from "./html.mjs";
import { decodeText, parsePlain } from "./plain.mjs";
import { parseNotesBoard } from "./notes_board.mjs";
import { parseWithOcrService } from "./ocr_service.mjs";

// Bump when parser output changes so cached parses are rebuilt.
export const PARSER_REVISION = 1;

const require = createRequire(import.meta.url);
const pkg = require("../../package.json");

const ENGINE_PACKAGES = {
  unpdf: "unpdf",
  mammoth: "mammoth",
  exceljs: "exceljs",
  officeparser: "officeparser",
  readability: "@mozilla/readability",
  plain: null,
  notes: null,
  ocr: null,
};

const MIME_FORMATS = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "office",
  "application/vnd.oasis.opendocument.text": "office",
  "application/vnd.oasis.opendocument.presentation": "office",
  "application/vnd.oasis.opendocument.spreadsheet": "office",
  "application/rtf": "office",
  "text/rtf": "office",
  "application/epub+zip": "office",
  "application/msword": "legacy",
  "application/vnd.ms-excel": "legacy",
  "application/vnd.ms-powerpoint": "legacy",
  "text/html": "html",
  "application/xhtml+xml": "html",
  "text/markdown": "markdown",
  "text/x-markdown": "markdown",
  "text/csv": "csv",
  "text/tab-separated-values": "csv",
  "application/json": "json",
  "text/plain": "text",
  "application/x-notes-board": "notes",
};

const EXT_FORMATS = {
  pdf: "pdf",
  docx: "docx",
  xlsx: "xlsx",
  pptx: "office",
  odt: "office",
  odp: "office",
  ods: "office",
  rtf: "office",
  epub: "office",
  doc: "legacy",
  xls: "legacy",
  ppt: "legacy",
  html: "html",
  htm: "html",
  xhtml: "html",
  md: "markdown",
  markdown: "markdown",
  csv: "csv",
  tsv: "csv",
  json: "json",
  txt: "text",
  text: "text",
  log: "text",
};

const extensionOf = (name) => {
  const match = /\.([a-z0-9]+)$/i.exec(String(name || "").split(/[?#]/)[0]);
  return match ? match[1].toLowerCase() : "";
};

// head: optional first bytes of the file, for sniffing when mime/extension say nothing useful.
export function detectFormat({ mime, name, origin, kind, head } = {}) {
  if (origin === "notes") return "notes";
  const type = String(mime || "").split(";")[0].trim().toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("video/")) return "video";
  if (MIME_FORMATS[type]) return MIME_FORMATS[type];
  const ext = EXT_FORMATS[extensionOf(name)];
  if (ext) return ext;
  if (kind === "image" || kind === "audio" || kind === "video") return kind;
  if (type.startsWith("text/")) return "text";
  if (head?.length) {
    const start = Buffer.from(head.subarray(0, 5)).toString("latin1");
    if (start === "%PDF-") return "pdf";
    const sample = head.subarray(0, 4096);
    if (!sample.includes(0)) {
      const text = Buffer.from(sample).toString("utf8").trimStart().toLowerCase();
      return text.startsWith("<!doctype html") || text.startsWith("<html") ? "html" : "text";
    }
  }
  return "unknown";
}

// Format -> the category lib/grey/ocr_routing.js reasons about.
export function routingFormat(format) {
  if (format === "pdf") return "pdf";
  if (format === "docx" || format === "office") return "office";
  if (format === "xlsx") return "spreadsheet";
  if (format === "html") return "html";
  if (format === "notes") return "notes";
  if (format === "image") return "image";
  return "plain";
}

export function engineFor(format, routing) {
  if (routing?.engine === "ocr") return "ocr";
  switch (format) {
    case "pdf":
      return routing?.engine === "auto" ? "unpdf+ocr" : "unpdf";
    case "docx":
      return "mammoth";
    case "xlsx":
      return "exceljs";
    case "office":
      return "officeparser";
    case "html":
      return "readability";
    case "notes":
      return "notes";
    default:
      return "plain";
  }
}

export function engineVersion(engine) {
  const names = String(engine).split("+");
  const versions = names.map((name) => {
    const dep = ENGINE_PACKAGES[name];
    return dep ? `${name}@${pkg.dependencies?.[dep] || "?"}` : name;
  });
  return `${versions.join("+")}#r${PARSER_REVISION}`;
}

export function assertSupported(format) {
  if (format === "legacy") {
    throw new JobError("unsupported_format", "Legacy Office files (.doc, .xls, .ppt) aren't supported — save the file as .docx, .xlsx or .pptx and upload it again.");
  }
  if (format === "audio" || format === "video") {
    throw new JobError("unsupported_format", "Audio and video links aren't supported — upload the file instead.");
  }
  if (format === "unknown") {
    throw new JobError("unsupported_format", "This file type isn't supported yet.");
  }
}

async function parseWithTextEngine({ format, buffer, text, url, board }) {
  switch (format) {
    case "pdf":
      return parsePdf(buffer);
    case "docx":
      return parseDocx(buffer);
    case "xlsx":
      return parseXlsx(buffer);
    case "office":
      return parseWithOfficeParser(buffer);
    case "html":
      return parseHtml({ html: text ?? decodeText(buffer), url });
    case "notes":
      return parseNotesBoard(board);
    case "markdown":
    case "text":
    case "csv":
    case "json":
      return parsePlain({ buffer, text, format });
    default:
      throw new JobError("unsupported_format", "This file type isn't supported yet.");
  }
}

// -> { pages, paginated, totalPages, title, warnings }
export async function parseDocument({ format, routing, buffer = null, text = null, url = null, board = null, fileUrl = null, mime = null, parser = "text", ocr = false, ocrUrl = "", signal }) {
  assertSupported(format);
  const ocrAvailable = Boolean(ocrUrl);
  const warnings = [...(routing?.warnings || [])];

  if (routing?.engine === "ocr") {
    const out = await parseWithOcrService({ fileUrl, mime, signal, ocrUrl });
    return { ...out, paginated: true, totalPages: out.pages.length, title: null, warnings };
  }

  const parsed = await parseWithTextEngine({ format, buffer, text, url, board });
  let pages = parsed.pages.map((p) => ({ page: p.page ?? null, markdown: String(p.markdown || "") }));

  if (format === "pdf" && routing?.engine === "auto") {
    // Low-text pages go to the OCR service; the rest keep their text layer.
    const needOcr = pages.filter((p) => routePage({ parser, ocr, textChars: p.markdown.trim().length, ocrAvailable }) === "ocr").map((p) => p.page);
    if (needOcr.length) {
      const ocrPages = await parseWithOcrService({ fileUrl, mime, pages: needOcr, signal, ocrUrl });
      const byPage = new Map(ocrPages.pages.map((p) => [p.page, p.markdown]));
      pages = pages.map((p) => (byPage.has(p.page) ? { ...p, markdown: byPage.get(p.page) } : p));
    }
  } else if (routing?.pageRouting) {
    const filtered = filterTextLayerPages(pages, { parser, ocr, ocrAvailable });
    if (filtered.error) throw new JobError(filtered.error.code, filtered.error.message);
    if (filtered.skipped.length && filtered.warnings.length) {
      warnings.push(...filtered.warnings.map((w) => ({ ...w, pages: filtered.skipped.slice(0, 50) })));
    }
    pages = filtered.pages;
  }

  return {
    pages,
    paginated: Boolean(parsed.paginated),
    totalPages: parsed.totalPages ?? (parsed.paginated ? parsed.pages.length : null),
    title: parsed.title || null,
    warnings,
  };
}

export { routeDocument };
