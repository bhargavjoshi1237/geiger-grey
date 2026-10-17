// OCR adapter (spec §6.4) — interface only this phase. When the self-hosted OCR model exists,
// GREY_OCR_URL points at it and routing (lib/grey/ocr_routing.js) sends layout/vlm documents
// and low-text pages here. Until then every call fails with a permanent ocr_not_configured.
import { JobError, isRetryableStatus } from "../../../lib/grey/ingest_errors.js";

const TIMEOUT_MS = 10 * 60_000;

// -> { pages: [{ page, markdown }] }
export async function parseWithOcrService({ fileUrl, mime, pages = null, signal, ocrUrl = process.env.GREY_OCR_URL, fetchImpl = globalThis.fetch }) {
  if (!ocrUrl) {
    throw new JobError("ocr_not_configured", "OCR isn't available yet.", { retryable: false });
  }
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  let res;
  try {
    res = await fetchImpl(ocrUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fileUrl, mime, pages }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new JobError("ocr_unavailable", "The OCR service couldn't be reached.", { retryable: true, cause: err });
  }
  if (!res.ok) {
    throw new JobError("ocr_failed", `The OCR service failed (HTTP ${res.status}).`, { retryable: isRetryableStatus(res.status) });
  }
  const json = await res.json().catch(() => null);
  const out = Array.isArray(json?.pages) ? json.pages : null;
  if (!out) throw new JobError("ocr_failed", "The OCR service returned an unexpected response.", { retryable: false });
  return { pages: out.map((p, i) => ({ page: Number(p.page) || i + 1, markdown: String(p.markdown || "") })) };
}
