// worker/ingest/image.mjs helpers and the stage on its own (the full job runs in run.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildImageChunk, imageChunkContent, isImageSource, prepareImage, uploadThumbnail } from "../ingest/image.mjs";

const NORMALIZED = {
  image: { bytes: Buffer.from("jpeg"), data: "anBlZw==", mimeType: "image/jpeg", width: 640, height: 480 },
  thumbnail: { bytes: Buffer.from("thumb"), mimeType: "image/jpeg", width: 384, height: 288 },
  dhash: "0123456789abcdef",
  source: { width: 1280, height: 960, format: "png" },
};

test("images are routed by declared kind or mime", () => {
  assert.equal(isImageSource({ kind: "image", mime: null }), true);
  assert.equal(isImageSource({ kind: "document", mime: "image/webp" }), true);
  assert.equal(isImageSource({ kind: "document", mime: "IMAGE/PNG; charset=binary" }), true);
  assert.equal(isImageSource({ kind: "document", mime: "application/pdf" }), false);
  assert.equal(isImageSource(null), false);
});

test("chunk content: caption, then visible text, else the title", () => {
  assert.equal(imageChunkContent({ caption: "A pump.", ocrText: "P-100", title: "pump" }), "A pump.\n\nText in the image:\nP-100");
  assert.equal(imageChunkContent({ caption: "A pump.", ocrText: null, title: "pump" }), "A pump.");
  assert.equal(imageChunkContent({ caption: null, ocrText: "P-100", title: "pump" }), "Text in the image:\nP-100");
  assert.equal(imageChunkContent({ caption: null, ocrText: null, title: "pump" }), "Image: pump");
  assert.equal(imageChunkContent({ caption: "", ocrText: "", title: null }), "Image: untitled");
});

test("the image chunk matches spec §4", () => {
  const chunk = buildImageChunk({
    title: "pump",
    analysis: { caption: "A pump.", ocrText: null, tags: ["pump"], model: "vision-1" },
    embedded: "caption",
    normalized: NORMALIZED,
    thumbPath: "p1/k1/s1/.thumb.jpg",
    countTokens: (text) => text.length,
  });
  assert.deepEqual(chunk, {
    ordinal: 0,
    modality: "image",
    content: "A pump.",
    token_count: 7,
    page: null,
    start_ms: null,
    end_ms: null,
    heading_path: null,
    breadcrumb: "pump",
    search_text: "pump\n\nA pump.",
    metadata: {
      image: { thumbPath: "p1/k1/s1/.thumb.jpg", width: 640, height: 480, dhash: "0123456789abcdef", caption: "A pump.", ocrText: null, tags: ["pump"], embedded: "caption", model: "vision-1" },
    },
  });
  const bare = buildImageChunk({ title: "pump", analysis: null, embedded: "pixels", normalized: NORMALIZED, thumbPath: null, countTokens: () => 3 });
  assert.equal(bare.content, "Image: pump");
  assert.deepEqual(bare.metadata.image.tags, []);
  assert.equal(bare.metadata.image.caption, null);
  assert.equal(bare.metadata.image.model, null);
});

test("uploadThumbnail upserts a JPEG into grey-sources and never throws", async () => {
  const uploads = [];
  const admin = (result) => ({
    storage: {
      from: (bucket) => ({
        upload: async (objectPath, body, options) => {
          uploads.push({ bucket, objectPath, body, options });
          if (result instanceof Error) throw result;
          return result;
        },
      }),
    },
  });
  assert.equal(await uploadThumbnail({ admin: admin({ error: null }), path: "p1/k1/s1/.thumb.jpg", bytes: Buffer.from("x") }), true);
  assert.deepEqual(uploads[0].options, { upsert: true, contentType: "image/jpeg" });
  assert.equal(uploads[0].bucket, "grey-sources");
  assert.equal(uploads[0].objectPath, "p1/k1/s1/.thumb.jpg");
  assert.equal(await uploadThumbnail({ admin: admin({ error: { message: "denied" } }), path: "a", bytes: Buffer.from("x") }), false);
  assert.equal(await uploadThumbnail({ admin: admin(new Error("network")), path: "a", bytes: Buffer.from("x") }), false);
});

// A minimal stage, as runIngestionJob builds it.
async function stageFor({ storagePath = "p1/k1/s1/pump.png", deps = {} } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "grey-image-"));
  const warnings = [];
  const usage = [];
  const sink = { thumbs: [], described: [] };
  const stage = {
    admin: {},
    pool: {},
    config: {},
    signal: new AbortController().signal,
    ids: { projectId: "p1", kbId: "k1", sourceId: "s1" },
    meta: {},
    log: { warn() {} },
    tempDir: async () => dir,
    throwIfAborted: () => {},
    checkpoint: async () => {},
    record: async (event) => event && usage.push(event),
    warn: (stageName, code, message) => warnings.push({ stage: stageName, code, message }),
    deps: {
      db: { processingModelSettings: async () => ({ providerId: "prov-llm", model: "vision-1" }) },
      fetchSourceFile: async ({ tmpDir }) => {
        const filePath = path.join(tmpDir, "source");
        await writeFile(filePath, "bytes");
        return { filePath, contentHash: "h1", mime: "image/png" };
      },
      normalizeImage: async () => NORMALIZED,
      uploadThumbnail: async (args) => (sink.thumbs.push(args), true),
      kbImageSupport: async () => ({ supported: true, model: "voyage-multimodal-3.5", format: "voyage" }),
      readCache: async () => null,
      writeCache: async () => true,
      getProcessingModel: async () => ({ model: {}, modelId: "vision-1" }),
      describeImage: async (args) => (sink.described.push(args), { caption: "A pump.", ocrText: null, tags: [], tokens: 40, model: "vision-1" }),
      countTokens: (text) => text.length,
      ...deps,
    },
  };
  const source = { id: "s1", name: "pump.png", kind: "image", mime: "image/png", storage_path: storagePath };
  const run = (extra = {}) => prepareImage(stage, { source, kb: { id: "k1" }, preset: { prices: { perPage: 0.002 } }, tier: "fast", title: "pump", ...extra });
  return { run, stage, warnings, usage, sink, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test("prepareImage returns one chunk, the source facts and the pixels to embed", async () => {
  const s = await stageFor();
  try {
    const prepared = await s.run();
    assert.equal(prepared.chunks.length, 1);
    assert.equal(prepared.pageCount, 1);
    assert.equal(prepared.engine, "image");
    assert.equal(prepared.contentHash, "h1");
    assert.match(prepared.parseKey, /^[0-9a-f]{64}$/);
    assert.deepEqual(prepared.image, { width: 640, height: 480, dhash: "0123456789abcdef", thumbPath: "p1/k1/s1/.thumb.jpg", embedded: "pixels" });
    assert.deepEqual(prepared.pixels, { data: "anBlZw==", mimeType: "image/jpeg" });
    assert.equal(prepared.embeddingModel, "voyage-multimodal-3.5");
    assert.equal(s.sink.described[0].image.data, "anBlZw==");
    assert.deepEqual(s.usage.map((u) => [u.kind, u.quantity]), [["contextual_tokens", 40], ["page", 1]]);
    assert.deepEqual(s.stage.meta.parse, { format: "image", engine: "image", cached: false });
  } finally {
    await s.cleanup();
  }
});

test("prepareImage reuses a file prepareDocument already fetched", async () => {
  const s = await stageFor({ deps: { fetchSourceFile: async () => assert.fail("must not fetch twice") } });
  try {
    const dir = await s.stage.tempDir();
    const filePath = path.join(dir, "fetched");
    await writeFile(filePath, "bytes");
    const prepared = await s.run({ fetched: { filePath, contentHash: "h2", mime: "image/png" } });
    assert.equal(prepared.contentHash, "h2");
  } finally {
    await s.cleanup();
  }
});

test("the preview never overwrites the original upload", async () => {
  const s = await stageFor({ storagePath: "p1/k1/s1/.thumb.jpg" });
  try {
    const prepared = await s.run();
    assert.equal(s.sink.thumbs.length, 0);
    assert.equal(prepared.image.thumbPath, null);
    assert.deepEqual(s.warnings.map((w) => w.code), ["thumbnail_failed"]);
  } finally {
    await s.cleanup();
  }
});

test("a caption that comes back empty counts as a failed caption", async () => {
  const s = await stageFor({
    deps: {
      kbImageSupport: async () => ({ supported: false, model: null, format: null }),
      describeImage: async () => ({ caption: "", ocrText: null, tags: [], tokens: 12, model: "vision-1" }),
    },
  });
  try {
    await assert.rejects(s.run(), (err) => err.code === "image_needs_vision");
    assert.deepEqual(s.warnings.map((w) => w.code), ["caption_failed"]);
    assert.equal(s.warnings[0].message, "The image couldn't be described: The vision model returned no description.");
    assert.deepEqual(s.usage.map((u) => u.kind), ["contextual_tokens"]); // the tokens were still spent
  } finally {
    await s.cleanup();
  }
});

test("a job that can't be indexed leaves no preview behind", async () => {
  const s = await stageFor({ deps: { kbImageSupport: async () => ({ supported: false, model: null, format: null }), db: { processingModelSettings: async () => null } } });
  try {
    await assert.rejects(s.run(), (err) => err.code === "image_needs_vision");
    assert.equal(s.sink.thumbs.length, 0);
  } finally {
    await s.cleanup();
  }
});
