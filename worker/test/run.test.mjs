// runIngestionJob end to end against an in-memory fake of the DB layer and fake engine calls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { assertJobScope, displayTitle, inProjectFolder, mediaExtension, runIngestionJob } from "../ingest/run.mjs";
import { JobAbort } from "../loop.mjs";

const silent = { info() {}, warn() {}, error() {}, child() { return this; } };
const PRESET = {
  parser: "layout",
  ocr: true,
  chunking: { strategy: "recursive", size: 512, overlap: 64, atomicTables: true, headingBreadcrumbs: true },
  enrichment: { contextual: true, parentChild: false },
  media: { transcribe: true, diarize: true, keyframes: false },
  graph: { extract: true },
  prices: { perPage: 0.006, perMediaMinute: 0.006, perKeyframeMinute: 0.04, perMillionTokensGraph: 0.5, perMillionTokensContextual: 1.02 },
};
const MARKDOWN = "# Guide\n\nIntro paragraph about the product.\n\n## Setup\n\nInstall it and configure the settings.";

class EngineError extends Error {
  constructor(code, message, { retryable = false } = {}) {
    super(message);
    this.name = "EngineError";
    this.code = code;
    this.retryable = retryable;
  }
}

function harness({ source = {}, kb = {}, job = {}, preset = PRESET, deps = {}, live = { count: 0, tokens: 0 }, signal, progress = { ok: true, sourceDeleted: false }, jobStatus = "running" } = {}) {
  const calls = [];
  const state = { usage: [], staged: [], releases: [], sourceStatus: [], progress: [], finish: null, rpc: [] };
  const log = (name, payload) => calls.push(name) && payload;
  const theSource = { id: "s1", project_id: "p1", kb_id: "k1", name: "guide.md", kind: "document", origin: "upload", mime: "text/markdown", storage_path: "p1/k1/s1/guide.md", metadata: {}, deleted_at: null, ...source };
  const theKb = { id: "k1", project_id: "p1", embedding_provider_id: "prov-embed", embedding_model: "text-embedding-3-large", embedding_dims: 4, deleted_at: null, ...kb };
  const theJob = { id: "j1", project_id: "p1", kb_id: "k1", source_id: "s1", attempts: 1, max_attempts: 3, estimated_cost: null, metadata: {}, preset_snapshot: { id: "pr", tier: "balanced", config: preset }, ...job };
  const db = {
    loadSource: async (_p, ...args) => (log("loadSource"), (state.loadSourceArgs = args), theSource),
    loadKnowledgeBase: async (_p, ...args) => (log("loadKnowledgeBase"), (state.loadKbArgs = args), theKb),
    setSourceStatus: async (_p, { status }) => (log("setSourceStatus"), state.sourceStatus.push(status)),
    settleSourceStatus: async (_p, { fallback }) => (log("settleSourceStatus"), state.sourceStatus.push(`settle:${fallback}`)),
    updateJobProgress: async (_p, args) => (log("updateJobProgress"), state.progress.push(args), progress),
    processingModelSettings: async () => ({ providerId: "prov-llm", model: "claude-haiku-5-5" }),
    liveChunkStats: async () => live,
    finishSource: async (_p, args) => (log("finishSource"), (state.finish = args)),
    deleteStagedChunks: async () => log("deleteStagedChunks"),
    stagedOrdinals: async () => new Set(),
    insertStagedChunks: async (_p, { rows }) => (log("insertStagedChunks"), state.staged.push(...rows), rows.length),
    swapSourceChunks: async () => (log("swapSourceChunks"), state.staged.length),
    liveChunks: async () => state.staged.map((r, i) => ({ id: `c${i}`, ordinal: r.ordinal, content: r.content, page: r.page, start_ms: r.start_ms, token_count: r.token_count })),
    upsertJobUsage: async (_p, { event, merge }) => state.usage.push({ ...event, merge }),
    releaseIngestionJob: async (_p, args) => (log("release"), state.releases.push(args), true),
    setJobEstimatedCost: async (_p, { estimatedCost }) => (state.estimatedCost = estimatedCost),
    jobStatus: async () => jobStatus,
  };
  const admin = { rpc: async (name, params) => (log(`rpc:${name}`), state.rpc.push({ name, params }), { data: 0, error: null }) };
  const baseDeps = {
    db,
    fetchSourceFile: async ({ tmpDir }) => {
      log("fetch");
      const filePath = path.join(tmpDir, "source");
      await writeFile(filePath, MARKDOWN);
      return { filePath, bytes: MARKDOWN.length, contentHash: "hash-1", mime: "text/markdown", name: "guide.md" };
    },
    readCache: async () => null,
    writeCache: async (_a, objectPath, value) => (log("writeCache"), (state.cache = { objectPath, value }), true),
    enrichChunks: async ({ chunks }) => (log("enrich"), { contexts: new Map(chunks.map((c) => [c.ordinal, `Context ${c.ordinal}.`])), tokens: 50, model: "claude-haiku-5-5", warnings: [] }),
    embedTexts: async ({ texts, kb: k }) => (log("embed"), { vectors: texts.map((_, i) => [i, 0.5, 0.25, 1]), tokens: texts.length * 10, dims: k.embedding_dims }),
    getProcessingModel: async () => (log("getProcessingModel"), { model: {}, modelId: "claude-haiku-5-5" }),
    extractGraph: async (args) => (log("extractGraph"), (state.graphArgs = args), { ok: true, entities: 2, relations: 1, tokens: 120, warnings: [{ stage: "graph", code: "graph_truncated", message: "t" }] }),
    sweepGraphOrphans: async () => log("sweep"),
    ...deps,
  };
  const ctx = { pool: {}, admin, log: silent, signal: signal || new AbortController().signal, workerId: "w1", config: { maxMediaMinutes: 600, ocrUrl: "" }, deps: baseDeps };
  return { run: () => runIngestionJob(theJob, ctx), calls, state, theSource, theJob };
}

test("helpers", () => {
  assert.equal(displayTitle("Q3 report.final.pdf"), "Q3 report.final");
  assert.equal(displayTitle("notes"), "notes");
  assert.equal(mediaExtension("talk.MP3", "audio/mpeg"), ".mp3");
  assert.equal(mediaExtension("recording", "video/mp4"), ".mp4");
});

test("document job: parse → chunk → enrich → embed → swap → graph → sweep → release", async () => {
  const h = harness();
  await h.run();
  const order = h.calls.filter((c) => ["fetch", "enrich", "embed", "insertStagedChunks", "swapSourceChunks", "finishSource", "extractGraph", "sweep", "release"].includes(c));
  assert.deepEqual(order, ["fetch", "enrich", "embed", "insertStagedChunks", "swapSourceChunks", "finishSource", "extractGraph", "sweep", "release"]);

  // staged rows carry vector + dims + model together, and the enriched search text
  assert.equal(h.state.staged.length, 2);
  const row = h.state.staged[1];
  assert.equal(row.embedding, "[1,0.5,0.25,1]");
  assert.equal(row.embedding_dims, 4);
  assert.equal(row.embedding_model, "text-embedding-3-large");
  assert.deepEqual(row.heading_path, ["Guide", "Setup"]);
  assert.equal(row.metadata.context, "Context 1.");
  assert.equal(row.search_text, `guide > Guide > Setup\n\nContext 1.\n\n${row.content}`);

  // metering: pages at the Fast tier (layout preset served by the text engine), BYOK token kinds at 0
  const page = h.state.usage.find((u) => u.kind === "page");
  assert.equal(page.unitCost, 0.002);
  assert.equal(page.merge, "first");
  assert.ok(page.quantity >= 1);
  assert.deepEqual(h.state.usage.find((u) => u.kind === "contextual_tokens"), { kind: "contextual_tokens", quantity: 50, unitCost: 0, cost: 0, metadata: { model: "claude-haiku-5-5", byok: true }, merge: "add" });
  assert.equal(h.state.usage.find((u) => u.kind === "graph_tokens").quantity, 120);

  // parse cache written under the source folder
  assert.match(h.state.cache.objectPath, /^p1\/k1\/s1\/\.parsed\/[0-9a-f]{64}\.json\.gz$/);

  // source + job
  assert.equal(h.state.finish.chunkCount, 2);
  assert.match(h.state.finish.ingest.chunkKey, /^[0-9a-f]{64}$/);
  assert.equal(h.state.graphArgs.config.extract, true);
  assert.equal(h.state.graphArgs.chunks.length, 2);
  const release = h.state.releases.at(-1);
  assert.equal(release.status, "succeeded");
  assert.deepEqual(release.metadata.warnings.map((w) => w.code), ["graph_truncated"]);
  assert.deepEqual(release.metadata.graph, { ok: true, entities: 2, relations: 1 });
  assert.ok(h.state.estimatedCost > 0);
  assert.deepEqual(h.state.sourceStatus, ["processing"]);
});

test("matching chunkKey reuses live chunks and only redoes the graph", async () => {
  const first = harness();
  await first.run();
  const key = first.state.finish.ingest.chunkKey;
  const h = harness({ source: { metadata: { ingest: { chunkKey: key } } }, live: { count: 2, tokens: 30 } });
  await h.run();
  assert.ok(!h.calls.includes("embed"));
  assert.ok(!h.calls.includes("swapSourceChunks"));
  const order = h.calls.filter((c) => ["rpc:kg_clear_source_mentions", "extractGraph", "sweep", "release"].includes(c));
  assert.deepEqual(order, ["rpc:kg_clear_source_mentions", "extractGraph", "sweep", "release"]);
  assert.deepEqual(h.state.rpc[0].params, { p_project: "p1", p_source: "s1" });
  assert.equal(h.state.releases.at(-1).metadata.reusedChunks, true);
});

test("reused chunks keep the previous graph when no processing model is set", async () => {
  const first = harness();
  await first.run();
  const key = first.state.finish.ingest.chunkKey;
  const h = harness({
    source: { metadata: { ingest: { chunkKey: key } } },
    live: { count: 2, tokens: 30 },
    deps: { getProcessingModel: async () => null },
  });
  await h.run();
  assert.ok(!h.calls.includes("rpc:kg_clear_source_mentions"));
  assert.ok(!h.calls.includes("extractGraph"));
  assert.ok(!h.calls.includes("sweep"));
  const release = h.state.releases.at(-1);
  assert.equal(release.status, "succeeded");
  assert.deepEqual(release.metadata.warnings.map((w) => w.code), ["graph_unavailable"]);
});

test("reused chunks keep the previous graph when the processing model can't load", async () => {
  const first = harness();
  await first.run();
  const key = first.state.finish.ingest.chunkKey;
  const h = harness({
    source: { metadata: { ingest: { chunkKey: key } } },
    live: { count: 2, tokens: 30 },
    deps: { getProcessingModel: async () => { throw new EngineError("no_key", "Add an API key."); } },
  });
  await h.run();
  assert.ok(!h.calls.includes("rpc:kg_clear_source_mentions"));
  assert.ok(!h.calls.includes("sweep"));
  assert.equal(h.state.releases.at(-1).status, "succeeded");
  assert.equal(h.state.releases.at(-1).metadata.warnings[0].code, "graph_unavailable");
});

test("rows are loaded scoped to the job's project", async () => {
  const h = harness();
  await h.run();
  assert.deepEqual(h.state.loadSourceArgs, ["s1", "p1"]);
  assert.deepEqual(h.state.loadKbArgs, ["k1", "p1"]);
});

test("a job whose source belongs to another project or KB fails before any work", async () => {
  for (const override of [{ source: { project_id: "p2" } }, { source: { kb_id: "k2" } }, { kb: { project_id: "p2" } }]) {
    const h = harness(override);
    await h.run();
    assert.ok(!h.calls.includes("fetch"));
    assert.ok(!h.calls.includes("setSourceStatus"));
    const release = h.state.releases.at(-1);
    assert.equal(release.status, "failed");
    assert.equal(release.metadata.errorCode, "scope_mismatch");
  }
});

test("an upload whose file is outside the job's project fails before download", async () => {
  for (const storage_path of ["p2/k1/s1/guide.md", "p1/../p2/k1/s1/guide.md", null, "p1x/guide.md"]) {
    const h = harness({ source: { storage_path } });
    await h.run();
    assert.ok(!h.calls.includes("fetch"), String(storage_path));
    assert.equal(h.state.releases.at(-1).metadata.errorCode, "scope_mismatch");
  }
});

test("scope helpers", () => {
  assert.equal(inProjectFolder("p1/k1/s1/a.pdf", "p1"), true);
  assert.equal(inProjectFolder("p1/k1/s1/.parsed/x.json.gz", "p1"), true);
  assert.equal(inProjectFolder("p10/k1/a.pdf", "p1"), false);
  assert.equal(inProjectFolder("p1/./a.pdf", "p1"), false);
  assert.equal(inProjectFolder("p1/a.pdf", ""), false);
  const job = { project_id: "p1", kb_id: "k1" };
  assert.doesNotThrow(() => assertJobScope(job, { project_id: "p1", kb_id: "k1", origin: "notes" }, { id: "k1", project_id: "p1" }));
  assert.throws(() => assertJobScope(job, { project_id: "p1", kb_id: "k1", origin: "upload", storage_path: null }, { id: "k1", project_id: "p1" }), /outside its project/);
});

test("graph off: no extraction, but the sweep still runs after the swap", async () => {
  const h = harness({ preset: { ...PRESET, graph: { extract: false }, enrichment: { contextual: false } } });
  await h.run();
  assert.ok(!h.calls.includes("extractGraph"));
  assert.ok(!h.calls.includes("enrich"));
  assert.ok(h.calls.indexOf("sweep") > h.calls.indexOf("swapSourceChunks"));
});

test("a retryable provider error re-queues with backoff", async () => {
  const h = harness({ deps: { embedTexts: async () => { throw new EngineError("rate_limited", "Slow down"); } } });
  await h.run();
  const release = h.state.releases.at(-1);
  assert.equal(release.status, "queued");
  assert.ok(release.delaySeconds >= 30);
  assert.equal(release.metadata.lastError.code, "rate_limited");
  assert.deepEqual(h.state.sourceStatus, ["processing", "queued"]);
});

test("the last attempt fails for good", async () => {
  const h = harness({ job: { attempts: 3 }, deps: { embedTexts: async () => { throw new EngineError("provider_unavailable", "Down"); } } });
  await h.run();
  assert.equal(h.state.releases.at(-1).status, "failed");
  assert.deepEqual(h.state.sourceStatus, ["processing", "settle:failed"]);
});

test("a KB without an embedding provider fails before any paid work", async () => {
  const h = harness({ kb: { embedding_provider_id: null } });
  await h.run();
  assert.ok(!h.calls.includes("fetch"));
  const release = h.state.releases.at(-1);
  assert.equal(release.status, "failed");
  assert.equal(release.error, "Choose an embedding provider for this knowledge base.");
  assert.equal(release.metadata.errorCode, "no_embedding_provider");
});

test("image sources fail before download while OCR is unavailable", async () => {
  const h = harness({ source: { name: "scan.png", kind: "image", mime: "image/png" } });
  await h.run();
  assert.ok(!h.calls.includes("fetch"));
  assert.equal(h.state.releases.at(-1).error, "Image OCR isn't available yet.");
  assert.equal(h.state.releases.at(-1).status, "failed");
});

test("content sources are rejected", async () => {
  const h = harness({ source: { origin: "content" } });
  await h.run();
  assert.equal(h.state.releases.at(-1).error, "Content sources aren't supported yet.");
});

test("cancellation from the heartbeat stops the job without a release", async () => {
  const controller = new AbortController();
  const h = harness({
    signal: controller.signal,
    deps: {
      embedTexts: async () => {
        controller.abort(new JobAbort("cancelled"));
        throw new EngineError("aborted", "The request was cancelled.");
      },
    },
  });
  await h.run();
  assert.equal(h.state.releases.length, 0);
  assert.deepEqual(h.state.sourceStatus, ["processing", "settle:pending"]);
});

test("shutdown releases the job without counting the attempt", async () => {
  const controller = new AbortController();
  const h = harness({
    signal: controller.signal,
    deps: {
      embedTexts: async () => {
        controller.abort(new JobAbort("shutdown"));
        throw new Error("aborted");
      },
    },
  });
  await h.run();
  const release = h.state.releases.at(-1);
  assert.equal(release.status, "queued");
  assert.equal(release.refundAttempt, true);
  assert.deepEqual(h.state.sourceStatus, ["processing", "queued"]);
});

test("media job: transcribe (resumable, cached) → transcript chunks → minutes metered", async () => {
  let transcribeArgs;
  const h = harness({
    source: { name: "Interview.mp3", kind: "audio", mime: "audio/mpeg", duration_ms: 90_000 },
    preset: { ...PRESET, enrichment: { contextual: false }, graph: { extract: false }, media: { transcribe: true, diarize: true, keyframes: true } },
    deps: {
      resolveTranscriptionConnection: async () => ({ providerId: "prov-aai", model: null }),
      loadProvider: async () => ({ id: "prov-aai", provider: "assemblyai", metadata: {} }),
      mediaFileUrl: async () => ({ url: "https://signed/media", mime: "audio/mpeg" }),
      transcribe: async (args) => {
        transcribeArgs = args;
        await args.onSubmitted("tr_123");
        return {
          provider: "assemblyai",
          providerJobId: "tr_123",
          model: "universal",
          durationMs: 90_000,
          language: "en",
          segments: [
            { startMs: 0, endMs: 4000, speaker: "A", text: "Welcome to the show." },
            { startMs: 4000, endMs: 9000, speaker: "B", text: "Thanks for having me." },
          ],
          raw: { id: "tr_123" },
        };
      },
    },
  });
  await h.run();
  assert.equal(transcribeArgs.fileUrl, "https://signed/media");
  assert.equal(transcribeArgs.filePath, undefined); // AssemblyAI takes the URL
  assert.deepEqual(transcribeArgs.config, { diarize: true, language: null, tier: "balanced", durationMs: 90_000 });
  assert.ok(h.state.progress.some((p) => p.metadata?.providerJobId === "tr_123"));
  assert.ok(h.state.progress.some((p) => p.metadata?.substage === "transcribe"));
  assert.equal(h.state.cache.objectPath, "p1/k1/s1/transcript.json");
  assert.equal(h.state.cache.value.jobId, "j1");
  assert.deepEqual(h.state.cache.value.raw, { id: "tr_123" });
  const minutes = h.state.usage.find((u) => u.kind === "media_minute");
  assert.equal(minutes.quantity, 1.5);
  assert.equal(minutes.cost, 0);
  assert.equal(h.state.staged[0].start_ms, 0);
  assert.equal(h.state.staged[0].metadata.kind, "transcript");
  assert.equal(h.state.staged[0].search_text.startsWith("Interview\n\n"), true);
  assert.equal(h.state.finish.durationMs, 90_000);
  const release = h.state.releases.at(-1);
  assert.equal(release.status, "succeeded");
  assert.equal(release.metadata.keyframesSkipped, true);
  assert.deepEqual(release.metadata.warnings.map((w) => w.code), ["keyframes_unavailable"]);
});

test("media without a transcription connection fails with the actionable message", async () => {
  const h = harness({
    source: { name: "a.mp3", kind: "audio", mime: "audio/mpeg" },
    deps: { resolveTranscriptionConnection: async () => null },
  });
  await h.run();
  assert.equal(h.state.releases.at(-1).status, "failed");
  assert.match(h.state.releases.at(-1).error, /Connect a transcription provider/);
});

test("media longer than the limit is refused before transcription", async () => {
  const h = harness({
    source: { name: "a.mp3", kind: "audio", mime: "audio/mpeg", duration_ms: 601 * 60_000 },
    deps: { resolveTranscriptionConnection: async () => ({ providerId: "x", model: null }), transcribe: async () => assert.fail("must not transcribe") },
  });
  await h.run();
  assert.equal(h.state.releases.at(-1).error, "File is longer than the 600-minute limit.");
});

test("a lost lease mid-job leaves the job to its new owner", async () => {
  const h = harness({ progress: { ok: false, sourceDeleted: false } });
  await h.run();
  assert.equal(h.state.releases.length, 0);
  assert.deepEqual(h.state.sourceStatus, ["processing"]);
});

test("a cancel noticed at a stage boundary settles the source", async () => {
  const h = harness({ progress: { ok: false, sourceDeleted: false }, jobStatus: "cancelled" });
  await h.run();
  assert.equal(h.state.releases.length, 0);
  assert.deepEqual(h.state.sourceStatus, ["processing", "settle:pending"]);
});

test("a source deleted mid-job cancels the job", async () => {
  const h = harness({ progress: { ok: true, sourceDeleted: true } });
  await h.run();
  assert.equal(h.state.releases.at(-1).status, "cancelled");
});
