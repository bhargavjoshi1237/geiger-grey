import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkKey, parseCachePath, parseKey, stableStringify, transcriptCachePath } from "./ingest_keys.js";

const base = { contentHash: "abc", engine: "unpdf", engineVersion: "1.9.0+1" };

test("stableStringify sorts keys and drops undefined", () => {
  assert.equal(stableStringify({ b: 1, a: { d: 2, c: [1, { z: 1, y: 2 }] }, u: undefined }), '{"a":{"c":[1,{"y":2,"z":1}],"d":2},"b":1}');
});

test("parseKey is deterministic and sensitive to every input", () => {
  const k = parseKey(base);
  assert.match(k, /^[0-9a-f]{64}$/);
  assert.equal(parseKey({ ...base }), k);
  assert.notEqual(parseKey({ ...base, contentHash: "abd" }), k);
  assert.notEqual(parseKey({ ...base, engine: "mammoth" }), k);
  assert.notEqual(parseKey({ ...base, engineVersion: "2" }), k);
  assert.notEqual(parseKey({ ...base, ocr: true }), k);
  assert.notEqual(parseKey({ ...base, media: { diarize: true } }), k);
  assert.equal(parseKey({ ...base, media: { b: 1, a: 2 } }), parseKey({ ...base, media: { a: 2, b: 1 } }));
});

test("parseKey requires a content hash", () => {
  assert.throws(() => parseKey({ engine: "x" }));
});

test("chunkKey changes with chunking, enrichment and embedding model only", () => {
  const pk = parseKey(base);
  const args = { parseKey: pk, chunking: { strategy: "recursive", size: 512, overlap: 64 }, embeddingModel: "text-embedding-3-large", embeddingDims: 1024 };
  const k = chunkKey(args);
  assert.equal(chunkKey({ ...args, chunking: { ...args.chunking, unrelated: true } }), k);
  assert.notEqual(chunkKey({ ...args, chunking: { ...args.chunking, size: 256 } }), k);
  assert.notEqual(chunkKey({ ...args, contextual: true, contextModel: "claude-haiku-5-5" }), k);
  assert.notEqual(chunkKey({ ...args, embeddingModel: "voyage-3.5" }), k);
  assert.notEqual(chunkKey({ ...args, embeddingDims: 512 }), k);
  // the context model only matters while enrichment is on
  assert.equal(chunkKey({ ...args, contextModel: "m" }), k);
});

test("cache paths live under the source folder", () => {
  const ids = { projectId: "p", kbId: "k", sourceId: "s" };
  assert.equal(parseCachePath(ids, "abc"), "p/k/s/.parsed/abc.json.gz");
  assert.equal(transcriptCachePath(ids), "p/k/s/transcript.json");
});
