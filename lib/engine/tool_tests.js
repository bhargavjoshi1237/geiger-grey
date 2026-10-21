// Lookup tool tests (spec §5.8): leave-one-out over the labelled items in a tool's scope. Each
// case uses the item's own live chunk vector (ordinal 0 — no embedding call) as the query, with
// the item itself excluded, and checks the tool's output against the item's labels. Shared server
// runtime: relative imports only; the caller passes the service-role `admin` client.
import { EngineError } from "./errors.js";
import { getCapState } from "./usage.js";
import { loadThumbnail, loadToolScope, runTool } from "./tool_runtime.js";
import { classificationReport, retrievalReport } from "../grey/tool_metrics.js";
import { TOOL_LIMITS, normalizeToolSpec } from "../grey/tool_spec.js";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MAX_LLM_CASES = 10;
const MIN_CASES = 3;
const SOURCE_SCAN_LIMIT = 1000;

const withSignal = (builder, signal) => (signal ? builder.abortSignal(signal) : builder);

const DEFAULT_DEPS = { runTool, loadThumbnail, getCapState };

function serviceError(stage, error) {
  console.error(`[engine.tool_tests.${stage}]`, error?.code || error?.message);
  return new EngineError("service_unavailable", "Couldn't load the items to test with.", { status: 503, retryable: true });
}

// pgvector values come back as '[0.1,0.2,…]' strings.
export function parseVector(value) {
  let list = value;
  if (typeof value === "string") {
    try {
      list = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(list) || !list.length) return null;
  const vector = list.map((v) => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN));
  return vector.every(Number.isFinite) ? vector : null;
}

const groupKey = (kb) => [kb.embedding_provider_id ?? "", kb.embedding_model ?? "", kb.embedding_dims ?? ""].join("|");

// Labelled sources in scope, kinds narrowed by the scope's modality.
async function loadLabelledSources({ admin, projectId, kbIds, modality, signal }) {
  let query = admin
    .from("sources")
    .select("id,name,kb_id,kind,labels")
    .eq("project_id", projectId)
    .in("kb_id", kbIds)
    .is("deleted_at", null)
    .neq("labels", "{}");
  if (modality === "image") query = query.eq("kind", "image");
  else if (modality === "text") query = query.neq("kind", "image");
  const { data, error } = await withSignal(query.order("created_at", { ascending: true }).limit(SOURCE_SCAN_LIMIT), signal);
  if (error) {
    if (signal?.aborted) throw error;
    throw serviceError("sources", error);
  }
  return data || [];
}

// The live ordinal-0 chunk of each source. -> Map(sourceId -> { kbId, vector, dims, content, image })
async function loadCaseChunks({ admin, projectId, sourceIds, modality, signal }) {
  const chunks = new Map();
  if (!sourceIds.length) return chunks;
  let query = admin
    .from("chunks")
    .select("source_id,kb_id,embedding,embedding_dims,modality,content,image:metadata->image")
    .eq("project_id", projectId)
    .in("source_id", sourceIds)
    .eq("ordinal", 0)
    .eq("state", "live")
    .is("deleted_at", null);
  if (modality === "image" || modality === "text") query = query.eq("modality", modality);
  const { data, error } = await withSignal(query, signal);
  if (error) {
    if (signal?.aborted) throw error;
    throw serviceError("chunks", error);
  }
  for (const row of data || []) {
    const vector = parseVector(row.embedding);
    if (!vector || chunks.has(row.source_id)) continue;
    chunks.set(row.source_id, {
      kbId: row.kb_id,
      vector,
      dims: Number(row.embedding_dims) || vector.length,
      content: row.content ?? "",
      image: row.image && typeof row.image === "object" ? row.image : null,
    });
  }
  return chunks;
}

// Round-robin across label buckets so every label is tested, not just the most common one.
function stratify(candidates, bucketOrder) {
  const buckets = new Map(bucketOrder.map((label) => [label.toLowerCase(), []]));
  for (const candidate of candidates) {
    const key = candidate.expected[0].toLowerCase();
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(candidate);
  }
  const lists = [...buckets.values()].filter((list) => list.length);
  const ordered = [];
  for (let i = 0; lists.some((list) => i < list.length); i += 1) {
    for (const list of lists) if (i < list.length) ordered.push(list[i]);
  }
  return ordered;
}

// Expected labels per source: the tool's labels it carries (classify, in the tool's spelling and
// order) or all of its labels (find similar, most common first for bucketing).
function toCandidates(sources, allowed) {
  if (allowed) {
    return sources
      .map((s) => {
        const own = new Set((s.labels || []).map((l) => String(l).trim().toLowerCase()));
        return { source: s, expected: allowed.filter((label) => own.has(label.toLowerCase())) };
      })
      .filter((c) => c.expected.length);
  }
  return sources
    .map((s) => ({ source: s, expected: [...new Set((s.labels || []).map((l) => String(l).trim()).filter(Boolean))] }))
    .filter((c) => c.expected.length);
}

function bucketOrderFor(candidates, allowed) {
  if (allowed) return allowed;
  const counts = new Map();
  for (const c of candidates) {
    const key = c.expected[0].toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([label]) => label);
}

function firstHit(similar, expected) {
  const wanted = new Set(expected.map((label) => label.toLowerCase()));
  for (const item of similar) {
    const label = item.labels.find((l) => wanted.has(String(l).trim().toLowerCase()));
    if (label) return { item, label: expected.find((e) => e.toLowerCase() === String(label).trim().toLowerCase()) };
  }
  return null;
}

/**
 * -> { kind: "classification"|"retrieval"|"none", report, samples: [{ sourceId, sourceName, expected,
 *      predicted, confidence, decidedBy }], cases, skippedReason, ranAt, llmCalls, usage }
 * classify: the tool's own decision per case (nearest-neighbour vote; the model fallback runs only
 * with includeLlm, for at most 10 cases) -> classificationReport. find_similar: the labels of the
 * returned neighbours -> retrievalReport (samples also carry hitRank). answer_similar has no
 * automatic test. Fewer than 3 usable cases -> skippedReason "not_enough_labelled_items".
 * `usage` sums the runs' model usage (tokens, model) for metering.
 */
export async function runToolTests({ admin, projectId, spec: rawSpec, includeLlm = false, limit = DEFAULT_LIMIT, signal, deps } = {}) {
  const d = { ...DEFAULT_DEPS, ...(deps || {}) };
  const spec = normalizeToolSpec(rawSpec);
  const usage = { llmCalls: 0, tokensIn: 0, tokensOut: 0, model: null, provider: null };
  const finish = (fields) => ({
    report: null,
    samples: [],
    cases: 0,
    skippedReason: null,
    ranAt: new Date().toISOString(),
    llmCalls: usage.llmCalls,
    usage,
    ...fields,
  });
  if (spec.template === "answer_similar") return finish({ kind: "none", skippedReason: "no_automatic_tests" });

  const kind = spec.template === "classify" ? "classification" : "retrieval";
  const max = Math.min(MAX_LIMIT, Math.max(1, Math.round(Number(limit)) || DEFAULT_LIMIT));
  const modality = spec.scope.modality === "any" ? null : spec.scope.modality;

  const kbs = await loadToolScope({ admin, projectId, kbIds: spec.scope.kbIds, signal });
  if (!kbs.length) throw new EngineError("tool_scope_empty", "This tool has no knowledge bases to search.", { status: 409 });

  // Each case searches only the knowledge bases its vector is comparable with.
  const groups = new Map();
  for (const kb of kbs) {
    const key = groupKey(kb);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(kb.id);
  }
  const groupOf = new Map(kbs.map((kb) => [kb.id, groups.get(groupKey(kb))]));

  const allowed = spec.classify ? spec.classify.labels.map((l) => l.value) : null;
  const sources = await loadLabelledSources({ admin, projectId, kbIds: kbs.map((kb) => kb.id), modality, signal });
  const candidates = toCandidates(sources, allowed);
  const ordered = stratify(candidates, bucketOrderFor(candidates, allowed));
  const scan = ordered.slice(0, max * 2);
  const chunks = await loadCaseChunks({ admin, projectId, sourceIds: scan.map((c) => c.source.id), modality, signal });
  const cases = scan.filter((c) => chunks.has(c.source.id) && groupOf.has(chunks.get(c.source.id).kbId)).slice(0, max);
  if (cases.length < MIN_CASES) {
    return finish({ kind, cases: cases.length, skippedReason: "not_enough_labelled_items" });
  }

  const llmAllowed = kind === "classification" && includeLlm && spec.classify.mode !== "knn";
  const knnSpec = kind === "classification" ? normalizeToolSpec({ ...spec, classify: { ...spec.classify, mode: "knn" } }) : spec;
  const capState = llmAllowed ? await d.getCapState({ admin, projectId }) : undefined;
  let llmCases = 0;
  const results = [];

  for (const c of cases) {
    if (signal?.aborted) throw signal.reason ?? new Error("aborted");
    const chunk = chunks.get(c.source.id);
    const useLlm = llmAllowed && llmCases < MAX_LLM_CASES;
    let input = { text: null, image: null };
    if (useLlm) {
      // The model sees the item as a user would send it: its text and its thumbnail.
      const image = chunk.image?.thumbPath
        ? await d.loadThumbnail({ admin, projectId, thumbPath: chunk.image.thumbPath })
        : null;
      input = { text: String(chunk.content || "").slice(0, TOOL_LIMITS.textInputChars) || null, image };
    }
    const result = await d.runTool({
      admin,
      projectId,
      spec: useLlm ? spec : knnSpec,
      input,
      channel: "test",
      signal,
      capState,
      queryVector: { vector: chunk.vector, dims: chunk.dims, kbIds: groupOf.get(chunk.kbId) },
      excludeSourceIds: [c.source.id],
      deps,
    });
    const runUsage = result.usage || {};
    if (runUsage.llmCalls > 0) llmCases += 1;
    usage.llmCalls += Number(runUsage.llmCalls) || 0;
    usage.tokensIn += Number(runUsage.tokensIn) || 0;
    usage.tokensOut += Number(runUsage.tokensOut) || 0;
    usage.model = runUsage.model ?? usage.model;
    usage.provider = runUsage.provider ?? usage.provider;
    results.push({ case: c, result });
  }

  if (kind === "classification") {
    const samples = results.map(({ case: c, result }) => ({
      sourceId: c.source.id,
      sourceName: c.source.name ?? null,
      expected: c.expected,
      predicted: result.classification?.label ?? null,
      confidence: result.classification?.confidence ?? null,
      decidedBy: result.classification?.decidedBy ?? null,
    }));
    const report = classificationReport(samples.map((s) => ({ expected: s.expected, predicted: s.predicted })), allowed);
    return finish({ kind, report, samples, cases: samples.length });
  }

  const samples = results.map(({ case: c, result }) => {
    const similar = result.similar || [];
    const hit = firstHit(similar, c.expected);
    return {
      sourceId: c.source.id,
      sourceName: c.source.name ?? null,
      expected: c.expected,
      predicted: hit?.label ?? null,
      confidence: hit ? hit.item.score : null,
      decidedBy: null,
      hitRank: hit ? hit.item.index : null,
    };
  });
  const report = retrievalReport(
    results.map(({ case: c, result }) => ({ expected: c.expected, neighbors: (result.similar || []).map((s) => s.labels) })),
  );
  return finish({ kind, report, samples, cases: samples.length });
}
