// Image sources (spec §4, §7): one image chunk per source.
//   fetch -> normalise (orient, strip metadata, fit 1280 px, JPEG) -> thumbnail upload
//   -> embedding path (pixels when the KB model is multimodal, else the caption)
//   -> caption + visible text on the vision processing model (cached) -> one chunk
// The analysis is cached like a parse ({project}/{kb}/{source}/.parsed/{key}.json.gz, keyed on
// the content hash + vision model), so re-ingesting the same image doesn't pay for it again.
// Logs carry ids and codes only — never captions or image text.
import { readFile } from "node:fs/promises";
import { JobError, toJobError } from "../../lib/grey/ingest_errors.js";
import { buildSearchText } from "../../lib/grey/chunker.js";
import { parseCachePath, parseKey, sha256Hex } from "../../lib/grey/ingest_keys.js";
import { byokUsage, pageUsage } from "../../lib/grey/billing.js";
import { thumbnailPath } from "../../lib/grey/image_input.js";
import { isEngineError } from "../../lib/engine/errors.js";
import { BUCKET } from "./fetch.mjs";

export const IMAGE_ENGINE = "image";
export const IMAGE_ENGINE_VERSION = "r1";
const CACHE_VERSION = 1;

export const IMAGE_NEEDS_VISION =
  "Set a vision-capable processing model in Settings → General, or use a multimodal embedding model for this knowledge base.";

// Routed by what the source declares; prepareDocument hands over files it sniffs as images.
export function isImageSource(source) {
  return source?.kind === "image" || /^image\//i.test(String(source?.mime || ""));
}

// Never throws: a missing preview is a warning, not a failed job. -> true when stored
export async function uploadThumbnail({ admin, path, bytes, contentType = "image/jpeg" }) {
  try {
    const { error } = await admin.storage.from(BUCKET).upload(path, bytes, { upsert: true, contentType });
    return !error;
  } catch {
    return false;
  }
}

// Chunk text (spec §4): caption, then the visible text; "Image: <title>" when there is neither.
export function imageChunkContent({ caption, ocrText, title }) {
  const parts = [caption, ocrText ? `Text in the image:\n${ocrText}` : null].filter(Boolean);
  return parts.length ? parts.join("\n\n") : `Image: ${title || "untitled"}`;
}

export function buildImageChunk({ title, analysis, embedded, normalized, thumbPath, countTokens }) {
  const caption = analysis?.caption || null;
  const ocrText = analysis?.ocrText || null;
  const content = imageChunkContent({ caption, ocrText, title });
  return {
    ordinal: 0,
    modality: "image",
    content,
    token_count: countTokens(content),
    page: null,
    start_ms: null,
    end_ms: null,
    heading_path: null,
    breadcrumb: title,
    search_text: buildSearchText({ breadcrumb: title, content }),
    metadata: {
      image: {
        thumbPath,
        width: normalized.image.width,
        height: normalized.image.height,
        dhash: normalized.dhash,
        caption,
        ocrText,
        tags: Array.isArray(analysis?.tags) ? analysis.tags : [],
        embedded,
        model: analysis?.model || null,
      },
    },
  };
}

// Engine and job error messages are user-safe; anything else gets a generic reason.
const failureReason = (err) => ((isEngineError(err) || err instanceof JobError) && err.message ? err.message : "the processing model couldn't be used.");

/**
 * The image branch of an ingestion job. `stage` carries the job's helpers from runIngestionJob.
 * `fetched` is passed when prepareDocument already downloaded the file and sniffed an image.
 * -> the same `prepared` shape as documents and media, plus `image` (source facts) and `pixels`
 *    (the normalised image to embed when the KB model is multimodal).
 */
export async function prepareImage(stage, { source, kb, preset, tier, title, fetched = null }) {
  const { deps, admin, pool, config, signal, ids, tempDir, throwIfAborted, checkpoint, record, warn, log, meta } = stage;
  const { projectId } = ids;

  const file = fetched ?? (await deps.fetchSourceFile({ source, admin, db: pool, config, tmpDir: await tempDir(), signal }));
  throwIfAborted();
  if (!file.filePath) throw new JobError("invalid_image", "This image couldn't be read.");
  const normalized = await deps.normalizeImage(await readFile(file.filePath));
  throwIfAborted();

  const support = await deps.kbImageSupport({ admin, projectId, kb });
  const embedded = support?.supported ? "pixels" : "caption";

  // Caption + visible text on the processing model (ids only for the cache key — no key load).
  const settings = await deps.db.processingModelSettings(pool, projectId);
  const vision = settings ? `${settings.providerId}:${settings.model || ""}` : null;
  const cacheKey = parseKey({ contentHash: file.contentHash, engine: IMAGE_ENGINE, engineVersion: IMAGE_ENGINE_VERSION, media: { vision } });
  const cachePath = parseCachePath(ids, cacheKey);
  const entry = await deps.readCache(admin, cachePath, { gzip: true });
  const cached = entry?.v === CACHE_VERSION;
  let analysis = cached ? entry.analysis || null : null;
  let captionError = null;

  if (!cached && vision) {
    await checkpoint("parse", 10, { substage: "caption" });
    try {
      const resolved = await deps.getProcessingModel({ admin, projectId });
      if (!resolved?.model) throw new JobError("no_processing_model", "Set a processing model in Settings → General.");
      analysis = await deps.describeImage({ resolved, image: { data: normalized.image.data, mimeType: normalized.image.mimeType }, title, signal });
    } catch (err) {
      throwIfAborted();
      captionError = err;
    }
    throwIfAborted();
    if (analysis) await record(byokUsage("contextual_tokens", analysis.tokens, { model: analysis.model || null, purpose: "image_caption" }));
    if (analysis && !analysis.caption && !analysis.ocrText) {
      captionError = new JobError("caption_empty", "The vision model returned no description.");
      analysis = null;
    }
  }
  // A failed caption isn't cached, so the next ingest tries again.
  if (!cached && !captionError) {
    const value = { v: CACHE_VERSION, analysis: analysis ? { caption: analysis.caption, ocrText: analysis.ocrText, tags: analysis.tags, model: analysis.model } : null };
    if (!(await deps.writeCache(admin, cachePath, value, { gzip: true }))) log.warn("image analysis cache write failed");
  }

  const captioned = Boolean(analysis?.caption || analysis?.ocrText);
  if (captionError) warn("parse", "caption_failed", `The image couldn't be described: ${failureReason(captionError)}`);
  if (embedded === "caption" && !captioned) {
    // A transient provider error retries; anything else needs a vision model or a multimodal KB.
    if (captionError && toJobError(captionError).retryable) throw captionError;
    throw new JobError("image_needs_vision", IMAGE_NEEDS_VISION);
  }
  if (!vision) warn("parse", "caption_unavailable", "Indexed without a caption: set a vision-capable processing model in Settings → General to make this image searchable by text.");

  // The preview sits beside the original upload; never let it overwrite the original.
  let thumbPath = thumbnailPath(ids);
  const stored = source.storage_path !== thumbPath
    && (await deps.uploadThumbnail({ admin, path: thumbPath, bytes: normalized.thumbnail.bytes, contentType: normalized.thumbnail.mimeType }));
  if (!stored) {
    warn("parse", "thumbnail_failed", "The image preview couldn't be saved.");
    thumbPath = null;
  }

  await record(pageUsage({ pages: 1, cached, tier, prices: preset.prices, engine: IMAGE_ENGINE }));
  meta.parse = { format: "image", engine: IMAGE_ENGINE, cached };
  meta.image = { embedded, captioned, width: normalized.image.width, height: normalized.image.height };

  const chunk = buildImageChunk({ title, analysis, embedded, normalized, thumbPath, countTokens: deps.countTokens });
  return {
    chunks: [chunk],
    // Identity of the indexed chunk: changes with the embedding path, the vision model or the text.
    parseKey: parseKey({
      contentHash: file.contentHash,
      engine: IMAGE_ENGINE,
      engineVersion: IMAGE_ENGINE_VERSION,
      media: { vision, embedded, imageModel: support?.model || null, text: sha256Hex(chunk.search_text) },
    }),
    documentText: chunk.content,
    contentHash: file.contentHash,
    pageCount: 1,
    durationMs: null,
    engine: IMAGE_ENGINE,
    strategy: "image",
    image: { width: normalized.image.width, height: normalized.image.height, dhash: normalized.dhash, thumbPath, embedded },
    pixels: embedded === "pixels" ? { data: normalized.image.data, mimeType: normalized.image.mimeType } : null,
    embeddingModel: embedded === "pixels" ? support?.model || null : null,
  };
}
