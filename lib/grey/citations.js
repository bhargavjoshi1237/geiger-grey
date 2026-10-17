// Pure citation mapping (no I/O): resolves the [n] markers in a generated answer against
// the numbered context chunks and returns the shape the Playground UI already renders.

const MARKER_RE = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
const SNIPPET_CHARS = 300;

// Every cited number in first-appearance order, de-duplicated. Handles [1], [1, 2], [1][2].
export function parseCitationIndices(text) {
  const seen = new Set();
  for (const match of String(text ?? "").matchAll(MARKER_RE)) {
    for (const part of match[1].split(",")) {
      const n = Number(part.trim());
      if (Number.isInteger(n)) seen.add(n);
    }
  }
  return [...seen];
}

function snippet(content) {
  const value = String(content ?? "").trim();
  return value.length > SNIPPET_CHARS ? `${value.slice(0, SNIPPET_CHARS).trimEnd()}…` : value || null;
}

// { index, sourceId, chunkId, title, page, startMs, snippet } for context block `index`.
export function toCitation(chunk, index) {
  return {
    index,
    sourceId: chunk?.sourceId ?? null,
    chunkId: chunk?.chunkId ?? null,
    title: chunk?.sourceName ?? chunk?.title ?? null,
    page: chunk?.page ?? null,
    startMs: chunk?.startMs ?? null,
    snippet: snippet(chunk?.content),
  };
}

// All context chunks as citations (index 1..n) — what a stream announces up front so a
// client can resolve markers before the answer is complete.
export function contextCitations(chunks = []) {
  return (chunks || []).map((chunk, i) => toCitation(chunk, i + 1));
}

// The citations actually used in `text`: markers resolved against `chunks` (block n is
// chunks[n - 1]), first-appearance order, out-of-range numbers dropped.
export function mapCitations(text, chunks = []) {
  const list = chunks || [];
  return parseCitationIndices(text)
    .filter((n) => n >= 1 && n <= list.length)
    .map((n) => toCitation(list[n - 1], n));
}
