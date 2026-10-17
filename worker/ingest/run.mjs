// One ingestion job, end to end (spec §5.4–5.5, §6, §9, §10.3, §11):
//   fetch -> parse (cached) | transcribe (cached) -> chunk -> enrich -> embed (staged rows)
//   -> swap_source_chunks -> source update -> graph extraction -> orphan sweep -> release
// Progress bands: parse 0–30, chunk/enrich 30–60, embed 60–90, graph 90–100.
// Every job write is guarded on the lease; cancellation, lease loss and shutdown arrive through
// `signal` (aborted by the loop's heartbeat) and are also checked at each stage boundary.
// The worker runs as the service role, so every row it reads or writes is scoped to the job's
// project, and the job's source/KB are re-checked against it before any work (the SQL scope
// triggers enforce the same).
// Logs carry ids, codes and counts only — never document content.
import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { marked } from "marked";
import { countTokens } from "gpt-tokenizer";
import * as dbModule from "../db.mjs";
import { errorFields } from "../log.mjs";
import { JobError, retryDecision, toJobError } from "../../lib/grey/ingest_errors.js";
import { buildSearchText, chunkDocument, normalizeChunking } from "../../lib/grey/chunker.js";
import { markdownToBlocks } from "../../lib/grey/markdown_blocks.js";
import { chunkKey, parseCachePath, parseKey, sha256Hex, transcriptCachePath } from "../../lib/grey/ingest_keys.js";
import { billablePages, byokUsage, mediaUsage, pageUsage } from "../../lib/grey/billing.js";
import { estimateFileCost } from "../../lib/grey/cost.js";
import { resolveEmbeddingSpec, toPgVector } from "../../lib/grey/embedding_models.js";
import { driverFormat } from "../../lib/grey/provider_kinds.js";
import { chunkTranscript } from "../../lib/grey/chunk_transcript.js";
import { routeDocument } from "../../lib/grey/ocr_routing.js";
import { embedTexts } from "../../lib/engine/embeddings.js";
import { isEngineError } from "../../lib/engine/errors.js";
import { getProcessingModel } from "../../lib/engine/llm.js";
import { NO_TRANSCRIPTION_PROVIDER, resolveTranscriptionConnection, transcribe } from "../../lib/engine/transcribe.js";
import { loadProvider } from "../../lib/engine/secrets.js";
import { extractGraph, sweepGraphOrphans } from "../../lib/engine/graph_extract.js";
import { enrichChunks } from "../../lib/engine/enrich.js";
import { assertSupported, detectFormat, engineFor, engineVersion, parseDocument, routingFormat } from "./parse/index.mjs";
import { downloadToFile, fetchSourceFile, MAX_MEDIA_DOWNLOAD_BYTES, mediaFileUrl, sourceFileUrl } from "./fetch.mjs";
import { readCache, writeCache } from "./cache.mjs";
import { recordJobUsage } from "./billing.mjs";

const EMBED_BATCH = 128;
const TRANSCRIPT_REVISION = 1;

export const DEFAULT_DEPS = {
  db: dbModule,
  embedTexts,
  transcribe,
  resolveTranscriptionConnection,
  loadProvider,
  getProcessingModel,
  extractGraph,
  sweepGraphOrphans,
  enrichChunks,
  fetchSourceFile,
  mediaFileUrl,
  sourceFileUrl,
  downloadToFile,
  readCache,
  writeCache,
  parseDocument,
  countTokens: (text) => countTokens(String(text || "")),
  lexer: (markdown) => marked.lexer(markdown),
};

// The job's lease was lost or the job was cancelled while we were writing.
class JobStopped extends Error {
  constructor() {
    super("The job lease was lost or the job was cancelled.");
    this.name = "JobStopped";
  }
}

// Uploads live at <project_id>/<kb_id>/<source_id>/<file> in grey-sources.
export function inProjectFolder(storagePath, projectId) {
  return typeof storagePath === "string" && Boolean(projectId)
    && storagePath.startsWith(`${projectId}/`) && !/(^|\/)\.\.?(\/|$)/.test(storagePath);
}

// The job's ids come from a row members can write: never read, sign or write another tenant's data.
export function assertJobScope(job, source, kb) {
  const scoped = source.project_id === job.project_id && source.kb_id === job.kb_id
    && kb.id === job.kb_id && kb.project_id === job.project_id;
  if (!scoped) throw new JobError("scope_mismatch", "This job doesn't match its source's project and knowledge base.");
  if (source.origin === "upload" && !inProjectFolder(source.storage_path, job.project_id)) {
    throw new JobError("scope_mismatch", "This source's uploaded file is missing or outside its project.");
  }
}

// File name without its extension, for breadcrumbs and enrichment prompts.
export function displayTitle(name) {
  const base = String(name || "").trim();
  return base.replace(/\.[A-Za-z0-9]{1,5}$/, "").trim() || base || null;
}

const MEDIA_EXT = { "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/webm": ".webm", "audio/ogg": ".ogg", "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov" };

// Transcription servers sniff the format from the file name, so keep a sensible extension.
export function mediaExtension(name, mime) {
  const ext = path.extname(String(name || "")).toLowerCase();
  if (/^\.[a-z0-9]{2,5}$/.test(ext)) return ext;
  return MEDIA_EXT[String(mime || "").split(";")[0].trim().toLowerCase()] || ".bin";
}

// Stack frames without the message line: library messages can quote document text.
function causeFields(err) {
  if (!err) return undefined;
  return { name: err.name || "Error", code: err.code || null, frames: String(err.stack || "").split("\n").slice(1, 8).join("\n") };
}

async function readHead(filePath, bytes = 4096) {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export async function runIngestionJob(job, ctx) {
  const deps = { ...DEFAULT_DEPS, ...(ctx.deps || {}) };
  const db = deps.db;
  const { pool, admin, signal, workerId, config } = ctx;
  const log = ctx.log.child({ jobId: job.id, projectId: job.project_id, sourceId: job.source_id });
  const projectId = job.project_id;
  const sourceId = job.source_id;
  const ids = { projectId, kbId: job.kb_id, sourceId };
  const warnings = [];
  const meta = {};
  const startedAt = Date.now();
  let tmpDir = null;

  const throwIfAborted = () => {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new JobStopped();
  };
  const checkpoint = async (stage, progress, metadata = null) => {
    throwIfAborted();
    const r = await db.updateJobProgress(pool, { jobId: job.id, workerId, stage, progress, metadata });
    if (!r.ok) throw new JobStopped();
    if (r.sourceDeleted) throw new JobError("source_deleted", "The source was deleted.");
  };
  const warn = (stage, code, message) => warnings.push({ stage, code, message });
  const record = (event) => recordJobUsage(pool, { projectId, jobId: job.id, event, upsert: db.upsertJobUsage });
  const tempDir = async () => {
    tmpDir ??= await mkdtemp(path.join(os.tmpdir(), "grey-job-"));
    return tmpDir;
  };
  const safe = async (label, fn) => {
    try {
      return await fn();
    } catch (err) {
      log.error({ step: label, ...errorFields(err) }, "cleanup write failed");
      return null;
    }
  };

  // ---------------------------------------------------------------------------
  // Documents: fetch -> parse (cached) -> chunk
  // ---------------------------------------------------------------------------
  async function prepareDocument(source, preset, tier, title) {
    // Image sources can't be parsed without OCR — fail before downloading them.
    const declared = detectFormat({ mime: source.mime, name: source.name, origin: source.origin, kind: source.kind });
    if (declared === "image") {
      const early = routeDocument({ parser: preset.parser || "text", format: "image", ocrAvailable: Boolean(config.ocrUrl) });
      if (early.error) throw new JobError(early.error.code, early.error.message);
    }
    const dir = await tempDir();
    const fetched = await deps.fetchSourceFile({ source, admin, db: pool, config, tmpDir: dir, signal });
    throwIfAborted();
    const head = fetched.filePath ? await readHead(fetched.filePath) : null;
    const format = detectFormat({ mime: fetched.mime || source.mime, name: fetched.name || source.name, origin: source.origin, kind: source.kind, head });
    if (format !== "image") assertSupported(format);
    const parser = preset.parser || "text";
    const routing = routeDocument({ parser, format: routingFormat(format), ocrAvailable: Boolean(config.ocrUrl) });
    if (routing.error) throw new JobError(routing.error.code, routing.error.message);

    const engine = engineFor(format, routing);
    const pk = parseKey({ contentHash: fetched.contentHash, engine, engineVersion: engineVersion(engine), ocr: routing.engine !== "text" });
    const cachePath = parseCachePath(ids, pk);
    let parsed = await deps.readCache(admin, cachePath, { gzip: true });
    const cached = Array.isArray(parsed?.pages);
    if (!cached) {
      const fileUrl = routing.engine === "text" ? null : (await deps.sourceFileUrl({ source, admin, config, signal, seconds: 3600, allowUrlOrigin: true })).url;
      const buffer = fetched.filePath ? await readFile(fetched.filePath) : null;
      parsed = await deps.parseDocument({
        format,
        routing,
        buffer,
        board: fetched.board || null,
        url: fetched.finalUrl || null,
        fileUrl,
        mime: fetched.mime,
        parser,
        ocr: Boolean(preset.ocr),
        ocrUrl: config.ocrUrl,
        signal,
      });
      if (!(await deps.writeCache(admin, cachePath, parsed, { gzip: true }))) log.warn("parse cache write failed");
    }
    throwIfAborted();
    warnings.push(...(parsed.warnings || []));
    meta.parse = { format, engine, cached };

    const documentText = parsed.pages.map((p) => p.markdown).join("\n\n");
    const pages = billablePages({ paginated: parsed.paginated, pageCount: parsed.pages.length, tokenCount: deps.countTokens(documentText) });
    await record(pageUsage({ pages, cached, tier, prices: preset.prices, tierDowngraded: routing.tierDowngraded, engine }));

    const blocks = markdownToBlocks(parsed.pages, { lexer: deps.lexer });
    const { chunks, meta: chunkMeta } = chunkDocument(blocks, preset.chunking, { countTokens: deps.countTokens, title });
    if (chunkMeta.fallback === "semantic") warn("chunk", "semantic_unavailable", "Semantic chunking isn't available yet — recursive chunking was used.");
    if (!chunks.length) throw new JobError("empty_document", "No text could be extracted from this file.");
    return {
      chunks,
      parseKey: pk,
      documentText,
      contentHash: fetched.contentHash,
      pageCount: parsed.paginated ? parsed.totalPages ?? parsed.pages.length : pages,
      durationMs: null,
      engine,
      strategy: chunkMeta.strategy,
    };
  }

  // ---------------------------------------------------------------------------
  // Audio/video: transcribe (cached, resumable) -> transcript chunks
  // ---------------------------------------------------------------------------
  async function prepareMedia(source, preset, tier, title) {
    const media = preset.media || {};
    if (media.transcribe === false) {
      throw new JobError("transcription_disabled", "Transcription is turned off in this preset, so there is nothing to index for audio or video.");
    }
    if (media.keyframes) {
      warn("parse", "keyframes_unavailable", "Keyframe captioning isn't available yet — only the transcript was indexed.");
      meta.keyframesSkipped = true;
    }
    const conn = await deps.resolveTranscriptionConnection({ admin, projectId });
    if (!conn?.providerId) throw new JobError("no_transcription_provider", NO_TRANSCRIPTION_PROVIDER);
    const knownMs = Number(source.duration_ms) || null;
    if (knownMs && knownMs > config.maxMediaMinutes * 60_000) {
      throw new JobError("media_too_long", `File is longer than the ${config.maxMediaMinutes}-minute limit.`);
    }
    const provider = await deps.loadProvider({ admin, projectId, providerId: conn.providerId });
    if (!provider) throw new JobError("no_transcription_provider", NO_TRANSCRIPTION_PROVIDER);
    const format = driverFormat(provider, "transcribe");

    const flags = { providerId: conn.providerId, model: conn.model || null, diarize: Boolean(media.diarize), language: media.language || null, tier };
    const mediaRef = sha256Hex(`${source.origin}:${source.storage_path || source.origin_ref || ""}:${source.bytes ?? ""}`);
    const tKey = parseKey({ contentHash: mediaRef, engine: `transcribe:${format}`, engineVersion: `r${TRANSCRIPT_REVISION}`, media: flags });
    const cachePath = transcriptCachePath(ids);
    const entry = await deps.readCache(admin, cachePath, { gzip: false });
    let transcript = entry?.key === tKey ? entry.transcript : null;
    const cached = Boolean(transcript);
    let contentHash = null;

    if (!transcript) {
      await checkpoint("parse", 5, { substage: "transcribe" });
      const file = await deps.mediaFileUrl({ source, admin, config, signal });
      let filePath;
      if (format !== "assemblyai") {
        // OpenAI-format servers take an upload, not a URL.
        filePath = path.join(await tempDir(), `media${mediaExtension(source.name, file.mime || source.mime)}`);
        const download = await deps.downloadToFile(file.url, filePath, { signal, maxBytes: MAX_MEDIA_DOWNLOAD_BYTES });
        contentHash = download.contentHash;
      }
      const result = await deps.transcribe({
        admin,
        projectId,
        providerId: conn.providerId,
        model: conn.model || null,
        fileUrl: file.url,
        filePath,
        config: { diarize: flags.diarize, language: flags.language, tier, ...(knownMs ? { durationMs: knownMs } : {}) },
        resumeId: job.metadata?.providerJobId || null,
        onSubmitted: async (providerJobId) => {
          const r = await db.updateJobProgress(pool, { jobId: job.id, workerId, metadata: { providerJobId } });
          if (!r.ok) throw new JobStopped();
        },
        signal,
      });
      transcript = {
        provider: result.provider || provider.provider,
        providerJobId: result.providerJobId ?? null,
        model: result.model ?? null,
        durationMs: result.durationMs ?? null,
        language: result.language ?? null,
        segments: Array.isArray(result.segments) ? result.segments : [],
      };
      // Cache right away: the AssemblyAI driver deletes the provider's copy after success.
      if (!(await deps.writeCache(admin, cachePath, { key: tKey, jobId: job.id, transcript, raw: result.raw ?? null }, { gzip: false }))) {
        log.warn("transcript cache write failed");
      }
    }
    throwIfAborted();
    // Minutes are recorded by the job that transcribed (a resumed attempt of it included).
    if (!cached || entry?.jobId === job.id) {
      await record(mediaUsage({ durationMs: transcript.durationMs, provider: transcript.provider, model: transcript.model }));
    }
    meta.parse = { format: "media", engine: `transcribe:${format}`, cached };
    meta.transcript = { provider: transcript.provider, durationMs: transcript.durationMs, language: transcript.language };

    const segments = transcript.segments.filter((s) => String(s?.text || "").trim());
    if (!segments.length) throw new JobError("no_speech", "No speech detected in this file.");
    await checkpoint("chunk", 30, { substage: null });

    const pieces = chunkTranscript(segments, {
      windowSeconds: 45,
      maxTokens: normalizeChunking(preset.chunking).size,
      overlapSeconds: 5,
      countTokens: deps.countTokens,
    });
    const chunks = pieces.map((p) => ({
      ordinal: p.ordinal,
      content: p.content,
      token_count: p.tokenCount,
      page: null,
      start_ms: p.startMs,
      end_ms: p.endMs,
      heading_path: null,
      breadcrumb: title,
      search_text: buildSearchText({ breadcrumb: title, content: p.content }),
      metadata: { kind: "transcript", speakers: p.speakers || [] },
    }));
    if (!chunks.length) throw new JobError("no_speech", "No speech detected in this file.");
    return {
      chunks,
      parseKey: tKey,
      documentText: chunks.map((c) => c.content).join("\n\n"),
      contentHash,
      pageCount: null,
      durationMs: transcript.durationMs,
      engine: `transcribe:${format}`,
      strategy: "transcript",
    };
  }

  // Reused chunks still carry the previous extraction's mentions: they're only cleared once a
  // new extraction can actually run, so a missing or broken processing model keeps the graph.
  async function canReextract() {
    try {
      if ((await deps.getProcessingModel({ admin, projectId }))?.model) return true;
      warn("graph", "graph_unavailable", "Knowledge graph not refreshed (the previous one was kept): set a processing model in Settings → General.");
    } catch (err) {
      const reason = isEngineError(err) && err.message ? err.message : "the processing model couldn't be loaded — check it in Settings → General.";
      warn("graph", "graph_unavailable", `Knowledge graph not refreshed (the previous one was kept): ${reason}`);
    }
    meta.graph = { ok: false, entities: 0, relations: 0 };
    return false;
  }

  // ---------------------------------------------------------------------------
  // Graph: extract (when on) then always sweep orphans — never sweep before extracting,
  // or re-ingested entities would lose their ids.
  // ---------------------------------------------------------------------------
  async function graphStage(source, preset, { reused }) {
    await checkpoint("graph", 90);
    if (preset.graph?.extract) {
      if (reused) {
        if (!(await canReextract())) return;
        // No swap happened, so the previous extraction's mentions are still attached.
        const { error } = await admin.rpc("kg_clear_source_mentions", { p_project: projectId, p_source: source.id });
        if (error) log.warn({ code: error.code || null }, "kg_clear_source_mentions failed");
      }
      const chunks = await db.liveChunks(pool, source.id, projectId);
      const result = await deps.extractGraph({ admin, projectId, sourceId: source.id, jobId: job.id, chunks, config: preset.graph, signal });
      warnings.push(...(result?.warnings || []));
      await record(byokUsage("graph_tokens", result?.tokens, {}));
      meta.graph = { ok: Boolean(result?.ok), entities: result?.entities || 0, relations: result?.relations || 0 };
    }
    await deps.sweepGraphOrphans({ admin, projectId, sourceId: source.id });
    throwIfAborted();
  }

  async function execute() {
    const source = await db.loadSource(pool, sourceId, projectId);
    if (!source || source.deleted_at) throw new JobError("source_deleted", "The source was deleted.");
    const kb = await db.loadKnowledgeBase(pool, job.kb_id, projectId);
    if (!kb || kb.deleted_at) throw new JobError("source_deleted", "The knowledge base was deleted.");
    assertJobScope(job, source, kb);
    const snapshot = job.preset_snapshot || {};
    const preset = snapshot.config || {};
    const tier = snapshot.tier || "custom";

    await db.setSourceStatus(pool, { sourceId, projectId, status: "processing" });
    await checkpoint("parse", 0, { attempt: job.attempts, substage: null });

    if (source.origin === "content") throw new JobError("content_unsupported", "Content sources aren't supported yet.");
    // Fail before any paid work when the KB can't embed.
    if (!kb.embedding_provider_id) throw new JobError("no_embedding_provider", "Choose an embedding provider for this knowledge base.");
    if (preset.enrichment?.parentChild) {
      warn("chunk", "parent_child_unavailable", "Parent-child chunking isn't available yet — chunks were indexed on their own.");
    }

    const title = displayTitle(source.name);
    const contextual = Boolean(preset.enrichment?.contextual);
    const processing = contextual ? await db.processingModelSettings(pool, projectId) : null;
    const spec = resolveEmbeddingSpec(kb) || {};
    const embeddingModel = spec.model || kb.embedding_model;

    const isMedia = source.kind === "audio" || source.kind === "video" || /^(audio|video)\//i.test(source.mime || "");
    const prepared = isMedia ? await prepareMedia(source, preset, tier, title) : await prepareDocument(source, preset, tier, title);

    const ck = chunkKey({
      parseKey: prepared.parseKey,
      chunking: preset.chunking || {},
      contextual,
      contextModel: processing ? `${processing.providerId}:${processing.model || ""}` : null,
      embeddingModel,
      embeddingDims: spec.dims ?? kb.embedding_dims ?? null,
      title,
    });
    meta.chunkKey = ck;
    meta.strategy = prepared.strategy;

    // Same parse + chunking + embedding as the live chunks: only the graph needs redoing.
    const live = await db.liveChunkStats(pool, sourceId, projectId);
    if (source.metadata?.ingest?.chunkKey === ck && live.count > 0) {
      meta.reusedChunks = true;
      meta.chunks = live.count;
      await db.finishSource(pool, {
        sourceId,
        projectId,
        chunkCount: live.count,
        tokenCount: live.tokens,
        pageCount: prepared.pageCount,
        durationMs: prepared.durationMs,
        contentHash: prepared.contentHash,
        ingest: { ...source.metadata.ingest, jobId: job.id, at: new Date().toISOString() },
      });
      await graphStage(source, preset, { reused: true });
      return { source, preset, tier, prepared, tokenCount: live.tokens };
    }

    // A retry whose chunking changed can't reuse what the last attempt staged.
    if (job.metadata?.chunkKey && job.metadata.chunkKey !== ck) await db.deleteStagedChunks(pool, job.id);
    await checkpoint("chunk", 30, { chunkKey: ck });

    const staged = await db.stagedOrdinals(pool, job.id);
    const todo = prepared.chunks.filter((c) => !staged.has(c.ordinal));
    meta.resumedChunks = prepared.chunks.length - todo.length;

    if (contextual && todo.length) {
      await checkpoint("chunk", 35);
      const out = await deps.enrichChunks({ admin, projectId, documentText: prepared.documentText, title, chunks: todo, signal });
      throwIfAborted();
      warnings.push(...(out.warnings || []));
      if (out.contexts) {
        for (const chunk of todo) {
          const context = out.contexts.get(chunk.ordinal);
          if (!context) continue;
          chunk.metadata = { ...chunk.metadata, context };
          chunk.search_text = buildSearchText({ breadcrumb: chunk.breadcrumb, context, content: chunk.content });
        }
        meta.enriched = out.contexts.size;
      }
      await record(byokUsage("contextual_tokens", out.tokens, out.model ? { model: out.model } : {}));
    }

    await checkpoint("embed", 60);
    let done = prepared.chunks.length - todo.length;
    let embedTokens = 0;
    for (let i = 0; i < todo.length; i += EMBED_BATCH) {
      const batch = todo.slice(i, i + EMBED_BATCH);
      const { vectors, tokens } = await deps.embedTexts({
        admin,
        projectId,
        kb,
        texts: batch.map((c) => c.search_text || c.content),
        inputType: "document",
        signal,
      });
      throwIfAborted();
      embedTokens += Number(tokens) || 0;
      await db.insertStagedChunks(pool, {
        projectId,
        kbId: kb.id,
        sourceId,
        jobId: job.id,
        rows: batch.map((chunk, k) => ({
          ...chunk,
          // embedding and embedding_dims are written together (chunks_embedding_dims_check)
          embedding: toPgVector(vectors[k]),
          embedding_dims: vectors[k].length,
          embedding_model: embeddingModel,
        })),
      });
      done += batch.length;
      await checkpoint("embed", 60 + Math.round((30 * done) / prepared.chunks.length));
    }
    meta.embedTokens = embedTokens;

    const liveCount = await db.swapSourceChunks(pool, { jobId: job.id, workerId });
    const tokenCount = prepared.chunks.reduce((n, c) => n + (Number(c.token_count) || 0), 0);
    await db.finishSource(pool, {
      sourceId,
      projectId,
      chunkCount: liveCount,
      tokenCount,
      pageCount: prepared.pageCount,
      durationMs: prepared.durationMs,
      contentHash: prepared.contentHash,
      ingest: { chunkKey: ck, parseKey: prepared.parseKey, jobId: job.id, engine: prepared.engine, strategy: prepared.strategy, at: new Date().toISOString() },
    });
    meta.chunks = liveCount;
    meta.tokens = tokenCount;

    await graphStage(source, preset, { reused: false });
    return { source, preset, tier, prepared, tokenCount };
  }

  // Imports and URLs are queued without an estimate; back-fill it from what was found.
  async function backfillEstimate({ source, preset, tier, prepared, tokenCount }) {
    if (job.estimated_cost != null || !preset?.prices) return;
    try {
      const estimate = estimateFileCost(
        { kind: source.kind, pageCount: prepared.pageCount || 0, durationMs: prepared.durationMs || 0, tokenCount },
        { tier, config: preset },
      );
      await db.setJobEstimatedCost(pool, { jobId: job.id, workerId, estimatedCost: Number(((estimate.low + estimate.high) / 2).toFixed(6)) });
    } catch (err) {
      log.warn(errorFields(err), "estimate back-fill failed");
    }
  }

  async function handleFailure(err) {
    const jobId = job.id;
    if (signal?.aborted) {
      const code = signal.reason?.code || "lease_lost";
      if (code === "shutdown") {
        const ok = await safe("release", () => db.releaseIngestionJob(pool, { jobId, workerId, status: "queued", refundAttempt: true, metadata: { warnings } }));
        if (ok) await safe("source", () => db.setSourceStatus(pool, { sourceId, projectId, status: "queued" }));
        log.info("job released for shutdown");
      } else if (code === "cancelled") {
        await safe("source", () => db.settleSourceStatus(pool, { sourceId, projectId, fallback: "pending" }));
        log.info("job cancelled");
      } else if (code === "source_deleted") {
        await safe("release", () => db.releaseIngestionJob(pool, { jobId, workerId, status: "cancelled", error: "The source was deleted." }));
        log.info("source deleted — job cancelled");
      } else {
        log.warn("job lease lost — leaving it to its new owner");
      }
      return;
    }

    if (err instanceof JobStopped || /LEASE_LOST/.test(err?.message || "")) {
      const status = await safe("status", () => db.jobStatus(pool, jobId));
      if (status === "cancelled") await safe("source", () => db.settleSourceStatus(pool, { sourceId, projectId, fallback: "pending" }));
      log.warn({ status }, "job stopped");
      return;
    }

    const jobError = toJobError(err);
    if (jobError.code === "source_deleted") {
      await safe("release", () => db.releaseIngestionJob(pool, { jobId, workerId, status: "cancelled", error: jobError.message }));
      log.info("source deleted — job cancelled");
      return;
    }

    const decision = retryDecision(jobError, { attempts: job.attempts, maxAttempts: job.max_attempts ?? 3 });
    const lastError = { code: jobError.code, message: jobError.message };
    log[decision.action === "retry" ? "warn" : "error"](
      { code: jobError.code, message: jobError.message, action: decision.action, attempt: job.attempts, cause: causeFields(jobError.cause) },
      "job attempt failed",
    );
    if (decision.action === "retry") {
      const ok = await safe("release", () =>
        db.releaseIngestionJob(pool, { jobId, workerId, status: "queued", error: jobError.message, delaySeconds: decision.delayMs / 1000, metadata: { warnings, lastError } }),
      );
      if (ok) await safe("source", () => db.setSourceStatus(pool, { sourceId, projectId, status: "queued" }));
      return;
    }
    const ok = await safe("release", () =>
      db.releaseIngestionJob(pool, { jobId, workerId, status: "failed", error: jobError.message, metadata: { warnings, lastError, errorCode: jobError.code } }),
    );
    if (ok) await safe("source", () => db.settleSourceStatus(pool, { sourceId, projectId, fallback: "failed" }));
  }

  try {
    log.info({ attempt: job.attempts }, "job started");
    const outcome = await execute();
    await backfillEstimate(outcome);
    const ok = await db.releaseIngestionJob(pool, {
      jobId: job.id,
      workerId,
      status: "succeeded",
      metadata: { ...meta, warnings, lastError: null, substage: null, elapsedMs: Date.now() - startedAt },
    });
    log.info({ ok, chunks: meta.chunks ?? 0, warnings: warnings.length, elapsedMs: Date.now() - startedAt }, "job succeeded");
  } catch (err) {
    await handleFailure(err);
  } finally {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
