// Graph-aware retrieval (spec §10.4). Shared server runtime (Next routes + worker): relative imports
// only; the caller passes the service-role `admin` client and has already authorised kbIds.
import { shouldUseGraph } from "../grey/graph_router.js";

const MATCH_LIMIT = 5;
const HOPS = 2;
const MAX_ENTITIES = 40;
const MAX_CHUNKS = 8;

function withSignal(request, signal) {
  return signal && typeof request?.abortSignal === "function" ? request.abortSignal(signal) : request;
}

const numberOrNull = (value) => (value === null || value === undefined ? null : Number(value));

// kg_expand chunk -> the searchChunks chunk shape.
function toChunk(row) {
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
    via: "graph",
  };
}

/**
 * Finds entities named in the query (limited to entities grounded in kbIds), decides with
 * shouldUseGraph whether expansion is worth it, then walks the graph for related chunks and facts.
 * Forms-only entities and Forms relations never surface (enforced in SQL). Never throws: a failure
 * returns empty lists plus `error: 'graph_failed'`.
 *
 * @param {object} args
 * @param {object} args.admin       service-role Supabase client (schema grey)
 * @param {string} args.projectId
 * @param {string[]} args.kbIds     the pipeline / MCP server / widget KB set (the permission boundary)
 * @param {string} args.query
 * @param {Array<{ chunkId: string }>} [args.seedChunks]  chunks already retrieved (excluded from the result)
 * @param {'off'|'auto'|'always'} [args.mode]
 * @param {AbortSignal} [args.signal]
 * @returns {Promise<{ chunks: Array, facts: Array<{ subject, relation, object, confidence }>, entities: Array<{ id, name, type, score }>, error?: string }>}
 */
export async function expandWithGraph({ admin, projectId, kbIds, query, seedChunks = [], mode = "auto", signal }) {
  const empty = { chunks: [], facts: [], entities: [] };
  const kbs = [...new Set((kbIds || []).filter(Boolean))];
  const text = String(query ?? "").trim();
  if (!admin || !projectId || mode === "off" || !kbs.length || !text) return empty;

  try {
    const { data: matched, error: matchError } = await withSignal(
      admin.rpc("kg_match_query_entities", { p_project: projectId, p_kb_ids: kbs, p_query: text, p_limit: MATCH_LIMIT }),
      signal,
    );
    if (matchError) throw matchError;
    const entities = (matched || []).map((row) => ({
      id: row.entity_id,
      name: row.name,
      type: row.type_name ?? null,
      score: Number(row.score) || 0,
    }));
    if (!shouldUseGraph(text, { mode, matchedCount: entities.length })) return { ...empty, entities };

    const exclude = [...new Set((seedChunks || []).map((chunk) => chunk?.chunkId ?? chunk?.chunk_id).filter(Boolean))];
    const { data, error: expandError } = await withSignal(
      admin.rpc("kg_expand", {
        p_project: projectId,
        p_kb_ids: kbs,
        p_seed: entities.map((entity) => entity.id),
        p_exclude_chunks: exclude,
        p_hops: HOPS,
        p_max_entities: MAX_ENTITIES,
        p_max_chunks: MAX_CHUNKS,
      }),
      signal,
    );
    if (expandError) throw expandError;

    return {
      chunks: (data?.chunks || []).map(toChunk),
      facts: (data?.facts || []).map((fact) => ({
        subject: fact.subject,
        relation: fact.relation,
        object: fact.object,
        confidence: numberOrNull(fact.confidence),
      })),
      entities,
    };
  } catch {
    return { ...empty, error: "graph_failed" };
  }
}
