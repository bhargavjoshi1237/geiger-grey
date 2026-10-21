// Hybrid retrieval (spec §7.4): one vector arm per embedding-model group of knowledge bases,
// one full-text arm, optional knowledge-graph expansion, fused with RRF and optionally
// reranked. Shared by the Playground, v1, MCP, widget and eval runner via runPipelineTurn.
// A query image (lookup tools, spec §5.5) adds one vector arm per group whose embedding model
// can embed images; it fuses with the text arms like any other arm.
import { embedImages, embedTexts, kbImageSupport } from "./embeddings.js";
import { rerank as rerankDocuments } from "./rerank.js";
import { expandWithGraph } from "./graph_retrieve.js";
import { EngineError } from "./errors.js";
import { shouldUseGraph } from "../grey/graph_router.js";
import { RRF_K, fuseRrf, maxRrfScore, normalizeScores, poolSize } from "../grey/fusion.js";
import { toPgVector } from "../grey/embedding_models.js";

const GRAPH_WEIGHT = 0.5;
const RERANK_TIMEOUT_MS = 3000;
const GRAPH_MODES = new Set(["off", "auto", "always"]);
const MODALITIES = new Set(["text", "image"]);
const FUSION = { k: RRF_K, weights: { graph: GRAPH_WEIGHT } };
// Score kind reported when a single arm produced every candidate (its native scores are kept).
const SINGLE_ARM_SCORE_KIND = { vector: "cosine", text: "text_rank", graph: "graph" };
// Provider-facing steps; tests pass fakes through `deps`.
const DEFAULT_DEPS = { embedTexts, embedImages, kbImageSupport, rerank: rerankDocuments, expandWithGraph };

const withSignal = (builder, signal) => (signal ? builder.abortSignal(signal) : builder);
const retrievalFailed = () =>
  new EngineError("retrieval_failed", "Search is unavailable right now.", { status: 503, retryable: true });

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

// SQL filter values: null means "no filter".
const modalityFilter = (value) => (MODALITIES.has(value) ? value : null);
function idsFilter(ids) {
  if (!Array.isArray(ids)) return null;
  const list = [...new Set(ids.filter((id) => typeof id === "string" && id))];
  return list.length ? list : null;
}
const imageInfo = (value) => (value && typeof value === "object" ? value : null);

function toChunk(row, via) {
  return {
    chunkId: row.chunk_id,
    sourceId: row.source_id,
    sourceName: row.source_name ?? null,
    kbId: row.kb_id,
    content: row.content ?? "",
    score: Number(row.score) || 0,
    page: row.page ?? null,
    startMs: row.start_ms ?? null,
    endMs: row.end_ms ?? null,
    headingPath: row.heading_path ?? null,
    modality: row.modality ?? "text",
    sourceKind: row.source_kind ?? null,
    image: imageInfo(row.image),
    via,
  };
}

// The public chunk shape (drops fusion bookkeeping such as `ranks`).
function shapeChunk(c) {
  return {
    chunkId: c.chunkId,
    sourceId: c.sourceId,
    sourceName: c.sourceName ?? null,
    kbId: c.kbId,
    content: c.content ?? "",
    score: Number(c.score) || 0,
    page: c.page ?? null,
    startMs: c.startMs ?? null,
    endMs: c.endMs ?? null,
    headingPath: c.headingPath ?? null,
    modality: c.modality ?? "text",
    sourceKind: c.sourceKind ?? null,
    image: imageInfo(c.image),
    via: c.via,
  };
}

// filters: { modality, sourceIds, excludeSourceIds } already normalised (null = none).
async function matchVector({ admin, projectId, kbIds, dims, vector, limit, threshold, filters, signal }) {
  const { data, error } = await withSignal(
    admin.rpc("match_chunks_vector", {
      p_project: projectId,
      p_kb_ids: kbIds,
      p_dims: dims,
      p_query: toPgVector(vector),
      p_limit: limit,
      p_min_similarity: threshold,
      p_modality: filters.modality,
      p_source_ids: filters.sourceIds,
      p_exclude_source_ids: filters.excludeSourceIds,
    }),
    signal,
  );
  if (error) throw error;
  return (data || []).map((row) => toChunk(row, "vector"));
}

async function matchText({ admin, projectId, kbIds, query, limit, filters, signal }) {
  const { data, error } = await withSignal(
    admin.rpc("match_chunks_text", {
      p_project: projectId,
      p_kb_ids: kbIds,
      p_query: query,
      p_limit: limit,
      p_modality: filters.modality,
      p_source_ids: filters.sourceIds,
      p_exclude_source_ids: filters.excludeSourceIds,
    }),
    signal,
  );
  if (error) throw error;
  return (data || []).map((row) => toChunk(row, "text"));
}

// Runs `run(signal)` with its own deadline, still honouring the caller's signal.
async function withTimeout(run, ms, parentSignal) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(parentSignal.reason);
  parentSignal?.addEventListener("abort", onAbort, { once: true });
  let timer;
  try {
    return await Promise.race([
      run(controller.signal),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("timeout"));
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", onAbort);
  }
}

// Groups KBs that share an embedding connection + model + dims: each group needs exactly one
// query embedding and one vector arm.
function groupKnowledgeBases(kbs) {
  const groups = new Map();
  for (const kb of kbs) {
    const key = [kb.embedding_provider_id ?? "", kb.embedding_model ?? "", kb.embedding_dims ?? ""].join("|");
    if (!groups.has(key)) groups.set(key, { kb, kbIds: [] });
    groups.get(key).kbIds.push(kb.id);
  }
  return [...groups.values()];
}

// The vector and dims an embedding call produced for `group`, or throws "empty_embedding".
function groupVector(group, { vectors, dims }) {
  const vector = vectors?.[0];
  const resolvedDims = Number(group.kb.embedding_dims ?? dims ?? vector?.length);
  if (!vector?.length || !Number.isInteger(resolvedDims)) throw new Error("empty_embedding");
  return { vector, dims: resolvedDims };
}

async function embedGroup({ admin, projectId, group, query, signal, deps }) {
  try {
    const out = await deps.embedTexts({
      admin,
      projectId,
      kb: group.kb,
      texts: [query],
      inputType: "query",
      signal,
    });
    return { group, ...groupVector(group, out), tokens: Number(out.tokens) || 0, model: group.kb.embedding_model };
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn("[engine.retrieval.embed]", error?.code || error?.name || "embed_failed");
    return { group, error, model: group.kb.embedding_model };
  }
}

// Embeds the query image for one KB group. Groups whose model can't embed images come back
// `skipped` (no embedding call); a failed call comes back with `error`, like embedGroup.
async function embedImageGroup({ admin, projectId, group, image, signal, deps }) {
  let support = null;
  try {
    support = await deps.kbImageSupport({ admin, projectId, kb: group.kb });
    if (!support?.supported) return { group, skipped: true };
    const out = await deps.embedImages({
      admin,
      projectId,
      kb: group.kb,
      images: [image],
      inputType: "query",
      signal,
    });
    return { group, ...groupVector(group, out), tokens: Number(out.tokens) || 0, model: support.model || group.kb.embedding_model };
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error?.code === "images_unsupported") return { group, skipped: true };
    console.warn("[engine.retrieval.embed_image]", error?.code || error?.name || "embed_failed");
    return { group, error, model: support?.model || group.kb.embedding_model };
  }
}

// searchChunks → { chunks: [{ chunkId, sourceId, sourceName, kbId, content, score, page, startMs,
// endMs, headingPath, modality, sourceKind, image, via }], meta: { scoreKind, embedTokens,
// embedModels, embedCalls, queryModes, imageSkippedKbIds, rerank, graph, facts, degraded,
// candidateCount, timings, reason? } }
// Needs a text `query` or a `queryImage` ({ data /* base64 */, mimeType }). `modality`,
// `sourceIds` and `excludeSourceIds` narrow every arm. `deps` replaces the provider steps
// (embedTexts, embedImages, kbImageSupport, rerank, expandWithGraph) in tests.
export async function searchChunks({
  admin,
  projectId,
  kbIds,
  query,
  queryImage = null,
  modality = null,
  sourceIds = null,
  excludeSourceIds = null,
  topK = 6,
  hybrid = true,
  rerank = false,
  rerankProviderId = null,
  rerankModel = null,
  threshold = 0.2,
  graphMode = "off",
  signal,
  deps,
} = {}) {
  const startedAt = Date.now();
  const timings = {};
  const steps = { ...DEFAULT_DEPS, ...deps };
  const k = Math.round(clampNumber(topK, 1, 50, 6));
  const pool = poolSize(k);
  const minSimilarity = clampNumber(threshold, 0, 1, 0.2);
  const mode = GRAPH_MODES.has(graphMode) ? graphMode : "off";
  const text = String(query ?? "").trim();
  const image = queryImage?.data ? { data: queryImage.data, mimeType: queryImage.mimeType } : null;
  const filters = {
    modality: modalityFilter(modality),
    sourceIds: idsFilter(sourceIds),
    excludeSourceIds: idsFilter(excludeSourceIds),
  };
  const meta = {
    scoreKind: null,
    embedTokens: 0,
    embedModels: [],
    embedCalls: 0,
    queryModes: [text && "text", image && "image"].filter(Boolean),
    imageSkippedKbIds: [],
    rerank: rerank ? null : "off",
    graph: mode === "off" ? "off" : "skipped",
    facts: [],
    degraded: null,
    candidateCount: 0,
    timings,
  };
  const finish = (chunks, extra = {}) => {
    timings.totalMs = Date.now() - startedAt;
    return { chunks, meta: { ...meta, ...extra } };
  };

  const requested = [...new Set((kbIds || []).filter(Boolean))];
  if (!requested.length) return finish([], { reason: "no_knowledge_bases" });
  if (!text && !image) return finish([], { reason: "empty_query" });

  // 1. Active KBs in projectId ∩ kbIds — the KB set is the retrieval boundary.
  const { data: kbs, error: kbError } = await withSignal(
    admin
      .from("knowledge_bases")
      .select("id,embedding_provider_id,embedding_model,embedding_dims")
      .eq("project_id", projectId)
      .in("id", requested)
      .eq("status", "active")
      .is("deleted_at", null),
    signal,
  );
  if (kbError) {
    if (signal?.aborted) throw kbError;
    console.error("[engine.retrieval.kbs]", kbError.message);
    throw retrievalFailed();
  }
  if (!kbs?.length) return finish([], { reason: "no_knowledge_bases" });
  const allKbIds = kbs.map((kb) => kb.id);
  const groups = groupKnowledgeBases(kbs);

  let armsTried = 0;
  let armsFailed = 0;
  const runArm = async (arm) => {
    armsTried += 1;
    try {
      return await arm();
    } catch (error) {
      if (signal?.aborted) throw error;
      armsFailed += 1;
      console.error("[engine.retrieval.arm]", error?.message || error);
      return [];
    }
  };
  const textArm = (ids) =>
    runArm(() => matchText({ admin, projectId, kbIds: ids, query: text, limit: pool, filters, signal }));

  // 2–3. Embed the text query and the query image once per group (parallel) while the hybrid
  // text arm runs. Groups whose model can't embed images skip the image arm.
  const searchStarted = Date.now();
  const hybridText = text && hybrid ? textArm(allKbIds) : null;
  hybridText?.catch(() => {}); // awaited below; this only stops an abort rejection going unhandled meanwhile
  const [embedded, imageEmbedded] = await Promise.all([
    text ? Promise.all(groups.map((group) => embedGroup({ admin, projectId, group, query: text, signal, deps: steps }))) : [],
    image ? Promise.all(groups.map((group) => embedImageGroup({ admin, projectId, group, image, signal, deps: steps }))) : [],
  ]);
  timings.embedMs = Date.now() - searchStarted;
  const imageAttempted = imageEmbedded.filter((e) => !e.skipped);
  const allEmbedded = [...embedded, ...imageAttempted];
  meta.embedCalls = allEmbedded.length;
  meta.embedTokens = allEmbedded.reduce((sum, e) => sum + (e.tokens || 0), 0);
  meta.embedModels = [...new Set(allEmbedded.map((e) => e.model).filter(Boolean))];
  meta.imageSkippedKbIds = imageEmbedded.filter((e) => e.skipped).flatMap((e) => e.group.kbIds);
  if (image && !imageAttempted.length) meta.queryModes = meta.queryModes.filter((m) => m !== "image");
  if (!text && image && !imageAttempted.length) {
    timings.searchMs = Date.now() - searchStarted;
    return finish([], { reason: "image_query_unsupported" });
  }

  // Groups whose query embedding failed degrade to text-only search for their KBs. A failed image
  // embedding has no fallback of its own: it counts as a failed arm (the text arms still run).
  const failedKbIds = embedded.filter((e) => !e.vector).flatMap((e) => e.group.kbIds);
  const imageFailures = imageAttempted.filter((e) => !e.vector).length;
  if (failedKbIds.length || imageFailures) meta.degraded = "vector_unavailable";
  armsTried += imageFailures;
  armsFailed += imageFailures;

  const vectorLists = await Promise.all(
    allEmbedded
      .filter((e) => e.vector)
      .map((e) =>
        runArm(() =>
          matchVector({
            admin,
            projectId,
            kbIds: e.group.kbIds,
            dims: e.dims,
            vector: e.vector,
            limit: pool,
            threshold: minSimilarity,
            filters,
            signal,
          }),
        ),
      ),
  );
  const textItems = hybridText ? await hybridText : failedKbIds.length ? await textArm(failedKbIds) : [];
  timings.searchMs = Date.now() - searchStarted;
  if (armsTried > 0 && armsFailed === armsTried) throw retrievalFailed();

  const lists = [...vectorLists.map((items) => ({ via: "vector", items })), { via: "text", items: textItems }];

  // 4. Graph expansion (never fails the search; needs the text query). expandWithGraph matches
  // entities inside the KB set; shouldUseGraph applies the auto/always routing to what it matched.
  if (mode !== "off" && text) {
    const graphStarted = Date.now();
    try {
      const seedChunks = fuseRrf(lists, FUSION).slice(0, k).map(shapeChunk);
      const graph = await steps.expandWithGraph({ admin, projectId, kbIds: allKbIds, query: text, seedChunks, mode, signal });
      const matchedCount = graph?.entities?.length || 0;
      if (graph?.error) {
        meta.graph = "failed";
      } else if ((graph?.chunks?.length || graph?.facts?.length) && shouldUseGraph(text, { mode, matchedCount })) {
        lists.push({ via: "graph", items: (graph.chunks || []).map((c) => ({ ...c, via: "graph" })) });
        meta.facts = graph.facts || [];
        meta.graph = "used";
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      console.warn("[engine.retrieval.graph]", error?.code || error?.name || "graph_failed");
      meta.graph = "failed";
    }
    timings.graphMs = Date.now() - graphStarted;
  }

  // 5. Fuse. A single contributing arm keeps its native scores; otherwise RRF, scaled 0..1.
  const contributing = lists.filter((list) => list.items.length);
  let ranked;
  let scoreKind;
  if (contributing.length === 1) {
    ranked = contributing[0].items;
    scoreKind = SINGLE_ARM_SCORE_KIND[contributing[0].via] || "rrf";
  } else {
    ranked = normalizeScores(fuseRrf(lists, FUSION), { max: maxRrfScore(lists, FUSION) });
    scoreKind = "rrf";
  }
  meta.candidateCount = ranked.length;

  // 6. Rerank the fused pool against the text query; on timeout/failure keep the fused order.
  if (rerank) {
    if (!text) {
      meta.rerank = "skipped";
    } else if (!rerankProviderId || !rerankModel) {
      meta.rerank = "not_configured";
    } else if (!ranked.length) {
      meta.rerank = "skipped";
    } else {
      const rerankStarted = Date.now();
      const candidates = ranked.slice(0, pool);
      try {
        const results = await withTimeout(
          (rerankSignal) =>
            steps.rerank({
              admin,
              projectId,
              providerId: rerankProviderId,
              model: rerankModel,
              query: text,
              documents: candidates.map((c) => c.content || ""),
              topN: Math.min(k, candidates.length),
              signal: rerankSignal,
            }),
          RERANK_TIMEOUT_MS,
          signal,
        );
        const byIndex = new Map();
        for (const r of results || []) {
          if (candidates[r?.index] && !byIndex.has(r.index)) byIndex.set(r.index, Number(r.score) || 0);
        }
        const reranked = [...byIndex.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([index, score]) => ({ ...candidates[index], score }));
        if (reranked.length) {
          ranked = reranked;
          scoreKind = "rerank";
          meta.rerank = "applied";
        } else {
          meta.rerank = "failed";
        }
      } catch (error) {
        if (signal?.aborted) throw error;
        console.warn("[engine.retrieval.rerank]", error?.code || error?.message || "rerank_failed");
        meta.rerank = "failed";
      }
      timings.rerankMs = Date.now() - rerankStarted;
    }
  }

  // 7. Top K.
  meta.scoreKind = scoreKind;
  return finish(ranked.slice(0, k).map(shapeChunk));
}

// The raw vector arm for a vector the caller already has (leave-one-out tool tests use a source's
// own stored chunk vector): no embedding call, no fusion. kbIds must already be the authorised,
// active KBs sharing `dims`. -> chunks in the searchChunks shape, via "vector", best first.
export async function searchByVector({
  admin,
  projectId,
  kbIds,
  dims,
  vector,
  limit = 10,
  threshold = 0,
  modality = null,
  sourceIds = null,
  excludeSourceIds = null,
  signal,
} = {}) {
  const ids = [...new Set((kbIds || []).filter(Boolean))];
  if (!ids.length || !Array.isArray(vector) || !vector.length) return [];
  try {
    const chunks = await matchVector({
      admin,
      projectId,
      kbIds: ids,
      dims: Number(dims ?? vector.length),
      vector,
      limit: Math.round(clampNumber(limit, 1, 200, 10)),
      threshold: clampNumber(threshold, 0, 1, 0),
      filters: {
        modality: modalityFilter(modality),
        sourceIds: idsFilter(sourceIds),
        excludeSourceIds: idsFilter(excludeSourceIds),
      },
      signal,
    });
    return chunks.map(shapeChunk);
  } catch (error) {
    if (signal?.aborted) throw error;
    console.error("[engine.retrieval.vector]", error?.message || error);
    throw retrievalFailed();
  }
}
