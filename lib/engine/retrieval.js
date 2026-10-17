// Hybrid retrieval (spec §7.4): one vector arm per embedding-model group of knowledge bases,
// one full-text arm, optional knowledge-graph expansion, fused with RRF and optionally
// reranked. Shared by the Playground, v1, MCP, widget and eval runner via runPipelineTurn.
import { embedTexts } from "./embeddings.js";
import { rerank as rerankDocuments } from "./rerank.js";
import { expandWithGraph } from "./graph_retrieve.js";
import { EngineError } from "./errors.js";
import { shouldUseGraph } from "../grey/graph_router.js";
import { RRF_K, fuseRrf, maxRrfScore, normalizeScores, poolSize } from "../grey/fusion.js";
import { toPgVector } from "../grey/embedding_models.js";

const GRAPH_WEIGHT = 0.5;
const RERANK_TIMEOUT_MS = 3000;
const GRAPH_MODES = new Set(["off", "auto", "always"]);
const FUSION = { k: RRF_K, weights: { graph: GRAPH_WEIGHT } };
// Score kind reported when a single arm produced every candidate (its native scores are kept).
const SINGLE_ARM_SCORE_KIND = { vector: "cosine", text: "text_rank", graph: "graph" };

const withSignal = (builder, signal) => (signal ? builder.abortSignal(signal) : builder);

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

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
    via: c.via,
  };
}

async function matchVector({ admin, projectId, kbIds, dims, vector, limit, threshold, signal }) {
  const { data, error } = await withSignal(
    admin.rpc("match_chunks_vector", {
      p_project: projectId,
      p_kb_ids: kbIds,
      p_dims: dims,
      p_query: toPgVector(vector),
      p_limit: limit,
      p_min_similarity: threshold,
    }),
    signal,
  );
  if (error) throw error;
  return (data || []).map((row) => toChunk(row, "vector"));
}

async function matchText({ admin, projectId, kbIds, query, limit, signal }) {
  const { data, error } = await withSignal(
    admin.rpc("match_chunks_text", { p_project: projectId, p_kb_ids: kbIds, p_query: query, p_limit: limit }),
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

async function embedGroup({ admin, projectId, group, query, signal }) {
  try {
    const { vectors, tokens, dims } = await embedTexts({
      admin,
      projectId,
      kb: group.kb,
      texts: [query],
      inputType: "query",
      signal,
    });
    const vector = vectors?.[0];
    const resolvedDims = Number(group.kb.embedding_dims ?? dims ?? vector?.length);
    if (!vector?.length || !Number.isInteger(resolvedDims)) throw new Error("empty_embedding");
    return { group, vector, dims: resolvedDims, tokens: Number(tokens) || 0 };
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn("[engine.retrieval.embed]", error?.code || error?.name || "embed_failed");
    return { group, error };
  }
}

// searchChunks → { chunks: [{ chunkId, sourceId, sourceName, kbId, content, score, page, startMs,
// endMs, headingPath, via }], meta: { scoreKind, embedTokens, rerank, graph, facts, degraded,
// candidateCount, timings, reason? } }
export async function searchChunks({
  admin,
  projectId,
  kbIds,
  query,
  topK = 6,
  hybrid = true,
  rerank = false,
  rerankProviderId = null,
  rerankModel = null,
  threshold = 0.2,
  graphMode = "off",
  signal,
} = {}) {
  const startedAt = Date.now();
  const timings = {};
  const k = Math.round(clampNumber(topK, 1, 50, 6));
  const pool = poolSize(k);
  const minSimilarity = clampNumber(threshold, 0, 1, 0.2);
  const mode = GRAPH_MODES.has(graphMode) ? graphMode : "off";
  const text = String(query ?? "").trim();
  const meta = {
    scoreKind: null,
    embedTokens: 0,
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
  if (!text) return finish([], { reason: "empty_query" });

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
    throw new EngineError("retrieval_failed", "Search is unavailable right now.", { status: 503, retryable: true });
  }
  if (!kbs?.length) return finish([], { reason: "no_knowledge_bases" });
  const allKbIds = kbs.map((kb) => kb.id);

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
  const textArm = (ids) => runArm(() => matchText({ admin, projectId, kbIds: ids, query: text, limit: pool, signal }));

  // 2–3. Embed the query once per group (parallel) while the hybrid text arm runs.
  const searchStarted = Date.now();
  const hybridText = hybrid ? textArm(allKbIds) : null;
  hybridText?.catch(() => {}); // awaited below; this only stops an abort rejection going unhandled meanwhile
  const embedded = await Promise.all(
    groupKnowledgeBases(kbs).map((group) => embedGroup({ admin, projectId, group, query: text, signal })),
  );
  timings.embedMs = Date.now() - searchStarted;
  meta.embedTokens = embedded.reduce((sum, e) => sum + (e.tokens || 0), 0);

  // Groups whose query embedding failed degrade to text-only search for their KBs.
  const failedKbIds = embedded.filter((e) => !e.vector).flatMap((e) => e.group.kbIds);
  if (failedKbIds.length) meta.degraded = "vector_unavailable";

  const vectorLists = await Promise.all(
    embedded
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
            signal,
          }),
        ),
      ),
  );
  const textItems = hybrid ? await hybridText : failedKbIds.length ? await textArm(failedKbIds) : [];
  timings.searchMs = Date.now() - searchStarted;
  if (armsTried > 0 && armsFailed === armsTried) {
    throw new EngineError("retrieval_failed", "Search is unavailable right now.", { status: 503, retryable: true });
  }

  const lists = [...vectorLists.map((items) => ({ via: "vector", items })), { via: "text", items: textItems }];

  // 4. Graph expansion (never fails the search). expandWithGraph matches entities inside the
  // KB set; shouldUseGraph applies the auto/always routing to what it matched.
  if (mode !== "off") {
    const graphStarted = Date.now();
    try {
      const seedChunks = fuseRrf(lists, FUSION).slice(0, k).map(shapeChunk);
      const graph = await expandWithGraph({ admin, projectId, kbIds: allKbIds, query: text, seedChunks, mode, signal });
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

  // 6. Rerank the fused pool; on timeout/failure keep the fused order.
  if (rerank) {
    if (!rerankProviderId || !rerankModel) {
      meta.rerank = "not_configured";
    } else if (!ranked.length) {
      meta.rerank = "skipped";
    } else {
      const rerankStarted = Date.now();
      const candidates = ranked.slice(0, pool);
      try {
        const results = await withTimeout(
          (rerankSignal) =>
            rerankDocuments({
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
