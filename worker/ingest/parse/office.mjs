// Office formats (spec §6.2):
//   DOCX        mammoth -> HTML -> turndown (GFM tables via the shared turndown setup)
//   XLSX        exceljs -> one Markdown table per sheet (page = sheet number)
//   PPTX / ODF / RTF / EPUB   officeparser AST -> Markdown (page = slide number for decks)
import mammoth from "mammoth";
import ExcelJS from "exceljs";
import { parseOffice } from "officeparser";
import { JobError } from "../../../lib/grey/ingest_errors.js";
import { htmlToMarkdown } from "./html.mjs";
import { markdownTable } from "./plain.mjs";

const corrupt = (label, err) =>
  new JobError("corrupt_file", `This ${label} file couldn't be read — it may be damaged or password-protected.`, { cause: err });

export async function parseDocx(buffer) {
  let html;
  try {
    // Images are dropped (alt text is kept by turndown); never inline base64 data.
    const result = await mammoth.convertToHtml(
      { buffer },
      { convertImage: mammoth.images.imgElement(async () => ({ src: "" })) },
    );
    html = result.value;
  } catch (err) {
    throw corrupt("Word", err);
  }
  return { pages: [{ page: null, markdown: htmlToMarkdown(html) }], paginated: false };
}

// exceljs cell value -> display text.
export function cellToText(value) {
  if (value == null) return "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if (Array.isArray(value.richText)) return value.richText.map((r) => r.text || "").join("");
    if ("result" in value) return cellToText(value.result);
    if ("text" in value) return cellToText(value.text);
    if ("error" in value) return String(value.error || "");
    if ("formula" in value || "sharedFormula" in value) return "";
    return "";
  }
  return String(value);
}

export async function parseXlsx(buffer) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch (err) {
    throw corrupt("Excel", err);
  }
  const pages = [];
  let sheetNumber = 0;
  wb.eachSheet((sheet) => {
    sheetNumber += 1;
    if (sheet.state && sheet.state !== "visible") return;
    const rows = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      // row.values is 1-based
      const values = (Array.isArray(row.values) ? row.values.slice(1) : []).map(cellToText);
      if (values.some((v) => v.trim())) rows.push(values);
    });
    if (!rows.length) return;
    const [header, ...body] = rows;
    pages.push({ page: sheetNumber, markdown: `## ${sheet.name}\n\n${markdownTable(header, body)}` });
  });
  return { pages, paginated: false };
}

// officeparser's Markdown adds "{#anchor}" to headings and "---" between slides.
export function cleanOfficeMarkdown(markdown) {
  return String(markdown || "")
    .replace(/^(#{1,6} .*?)[ \t]*\{#[^}\n]*\}[ \t]*$/gm, "$1")
    .replace(/^\s*---\s*\n/, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function toMarkdown(ast, content) {
  const view = { ...ast, content };
  const out = await ast.to.call(view, "md");
  return cleanOfficeMarkdown(out?.value ?? out);
}

// Decks become one page per slide; everything else one flowing page.
export async function parseWithOfficeParser(buffer, { label = "document" } = {}) {
  let ast;
  try {
    ast = await parseOffice(buffer, {
      ocr: false,
      extractAttachments: false,
      includeRawContent: false,
      ignoreNotes: false,
      ignoreComments: true,
    });
  } catch (err) {
    throw corrupt(label, err);
  }
  const nodes = Array.isArray(ast?.content) ? ast.content : [];
  const slides = nodes.filter((n) => n?.type === "slide");
  if (slides.length && slides.length === nodes.length) {
    const pages = [];
    for (const [i, slide] of slides.entries()) {
      const markdown = await toMarkdown(ast, [slide]);
      pages.push({ page: Number(slide.metadata?.slideNumber) || i + 1, markdown });
    }
    return { pages, paginated: true, totalPages: pages.length };
  }
  return { pages: [{ page: null, markdown: await toMarkdown(ast, nodes) }], paginated: false };
}
