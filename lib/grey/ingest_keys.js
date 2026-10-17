// Cache keys for the ingestion pipeline (spec §5.5).
//   parseKey = sha256(content hash + engine + engine version + OCR + media flags)
//   chunkKey = sha256(parseKey + chunking + enrichment + embedding model)
// Keys are derived from what the worker actually does (the routed engine), not the raw
// preset, so a preset change that doesn't change the parse still hits the cache.
import { createHash } from "node:crypto";

// JSON.stringify with sorted object keys, so equal configs hash equally.
export function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

export function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
}

export function parseKey({ contentHash, engine, engineVersion, ocr = false, media = null }) {
  if (!contentHash) throw new Error("parseKey needs a content hash");
  return sha256Hex(
    stableStringify({ v: 1, contentHash, engine: engine || null, engineVersion: engineVersion || null, ocr: Boolean(ocr), media }),
  );
}

// Only the chunking fields that change chunk output take part; prices etc. are ignored.
const CHUNKING_FIELDS = ["strategy", "size", "overlap", "atomicTables", "headingBreadcrumbs"];

export function chunkKey({ parseKey: pk, chunking = {}, contextual = false, contextModel = null, embeddingModel, embeddingDims = null, title = null }) {
  if (!pk) throw new Error("chunkKey needs a parseKey");
  const chunk = {};
  for (const field of CHUNKING_FIELDS) if (chunking?.[field] !== undefined) chunk[field] = chunking[field];
  return sha256Hex(
    stableStringify({
      v: 1,
      parseKey: pk,
      chunking: chunk,
      enrichment: { contextual: Boolean(contextual), model: contextual ? contextModel || null : null },
      embedding: { model: embeddingModel || null, dims: embeddingDims ?? null },
      title: title || null,
    }),
  );
}

// Storage paths under the grey-sources bucket: {project}/{kb}/{source}/...
export function sourcePrefix({ projectId, kbId, sourceId }) {
  return `${projectId}/${kbId}/${sourceId}`;
}

export function parseCachePath(ids, key) {
  return `${sourcePrefix(ids)}/.parsed/${key}.json.gz`;
}

export function transcriptCachePath(ids) {
  return `${sourcePrefix(ids)}/transcript.json`;
}
