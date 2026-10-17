// PDF text layer per page via unpdf (MIT; PDF.js underneath). No OCR: pages with little or no
// text layer are dealt with by filterTextLayerPages() in lib/grey/ocr_routing.js.
import { extractText, getDocumentProxy } from "unpdf";
import { JobError } from "../../../lib/grey/ingest_errors.js";

// Line-level cleanup: trim, re-join words hyphenated across lines, drop runs of blank lines.
// Lines are kept (not reflowed) so the chunker can still split at line boundaries.
export function normalizePdfText(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .join("\n")
    .replace(/([A-Za-z])-\n([a-z])/g, "$1$2")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// -> { pages: [{ page, markdown }], paginated: true, totalPages }
export async function parsePdf(buffer) {
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(buffer));
  } catch (err) {
    const locked = /password/i.test(err?.message || "") || err?.name === "PasswordException";
    throw new JobError(
      locked ? "pdf_encrypted" : "corrupt_file",
      locked ? "This PDF is password-protected." : "This PDF couldn't be read — it may be damaged.",
      { cause: err },
    );
  }
  try {
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    const pages = (Array.isArray(text) ? text : [text]).map((t, i) => ({ page: i + 1, markdown: normalizePdfText(t) }));
    return { pages, paginated: true, totalPages: totalPages || pages.length };
  } catch (err) {
    throw new JobError("corrupt_file", "This PDF couldn't be read — it may be damaged.", { cause: err });
  } finally {
    await pdf?.destroy?.().catch?.(() => {});
  }
}
