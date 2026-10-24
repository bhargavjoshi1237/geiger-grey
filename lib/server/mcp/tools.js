// MCP tools for one Grey MCP server (spec §12.3). A tool is registered only when it's
// enabled in mcp_servers.tools; names match the Delivery UI keys (MCP_TOOL_DEFS):
//   search { query, topK? ≤ 20 }          hybrid search over the server's knowledge bases
//   ask { question }                       a non-stream turn of the server's published pipeline
//   get_entity { id | name }               a graph entity grounded in the server's knowledge bases
//   list_sources { kbId?, limit?, cursor? } ready sources in the server's knowledge bases
// All tools are read-only and return text + structuredContent.
//
// Lookup tools (spec §5.10): a `"tool:<uuid>": true` key enables a published tool of the project
// as `tool_<slug>`. It runs the current published version (loaded with the server, in one query)
// under the same per-tool rate limit and monthly run limit as the v1 endpoint. Its description is
// generated from the template and labels — never the member-written description — and its
// structuredContent is the ToolResult without thumbnail storage paths.
//
// Knowledge-base boundary (spec §14): the server's kb_ids (validated against the project); a server
// with none falls back to its published pipeline's knowledge bases. `ask` runs the published pipeline
// with its knowledge bases narrowed to the server's set when the server has one.
// get_entity serves an entity's name, type, grounded relations and grounded mentions only — never
// aliases, description or properties: those accumulate across every knowledge base (and Forms) in
// the project, so they can't be attributed to the server's boundary.
//
// Relative imports (no @/ alias) keep this module loadable under plain node --test.
import { z } from "zod";
import { EngineError, isEngineError } from "../../engine/errors.js";
import { applyOverrides, normalizeRetrieval, resolvePipelineConfig } from "../../engine/pipeline_config.js";
import { searchChunks } from "../../engine/retrieval.js";
import { runPipelineTurn } from "../../engine/turn.js";
import { retryAfterSeconds } from "../../grey/api_key_eval.js";
import { IMAGE_LIMITS } from "../../grey/image_input.js";
import { formatTimestamp } from "../../grey/prompt.js";
import { TEMPLATE_INFO, TOOL_LIMITS, normalizeToolSpec, toolInputJsonSchema } from "../../grey/tool_spec.js";
import {
  TOOL_RATE_LIMIT_PER_MIN,
  checkMonthlyRunLimit,
  runErrorCode,
  runToolForChannel,
  toolRateBucket,
  withoutThumbPaths,
} from "../tool_routes.js";

export const MCP_TOOL_NAMES = ["search", "ask", "get_entity", "list_sources"];
export const SEARCH_MAX_TOP_K = 20;
export const LIST_SOURCES_MAX = 100;
const LIST_SOURCES_DEFAULT = 25;
const SNIPPET_CHARS = 1200;
const ENTITY_MENTIONS = 8;
const ENTITY_RELATIONS = 30;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export const LOOKUP_TOOL_PREFIX = "tool:";
export const LOOKUP_NAME_MAX = 48;
const LOOKUP_TOP_ITEMS = 5;
// Base64 of the largest accepted image, plus room for a data: URI prefix.
const IMAGE_DATA_MAX_CHARS = Math.ceil(IMAGE_LIMITS.maxBytes / 3) * 4 + 64;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function enabledToolNames(tools) {
  return MCP_TOOL_NAMES.filter((name) => tools?.[name] === true);
}

// The tool ids enabled as `"tool:<uuid>": true` in mcp_servers.tools.
export function enabledLookupToolIds(tools) {
  if (!tools || typeof tools !== "object") return [];
  const ids = Object.entries(tools)
    .filter(([key, on]) => on === true && key.startsWith(LOOKUP_TOOL_PREFIX))
    .map(([key]) => key.slice(LOOKUP_TOOL_PREFIX.length))
    .filter((id) => UUID_RE.test(id));
  return [...new Set(ids)];
}

// --- Pure formatting ----------------------------------------------------------

function location(item) {
  return [
    item.page !== null && item.page !== undefined ? `p. ${item.page}` : null,
    item.startMs !== null && item.startMs !== undefined ? formatTimestamp(item.startMs) : null,
  ].filter(Boolean);
}

function label(n, item) {
  const where = location(item);
  const title = item.sourceName || item.title || "Untitled source";
  return `[${n}] ${title}${where.length ? ` — ${where.join(" | ")}` : ""}`;
}

const clip = (text, max = SNIPPET_CHARS) => {
  const value = String(text ?? "").trim();
  return value.length > max ? `${value.slice(0, max).trimEnd()}…` : value;
};

export function formatSearchText(results) {
  if (!results.length) return "No matching passages in the connected knowledge bases.";
  return results.map((r, i) => `${label(i + 1, r)}\n${clip(r.content)}`).join("\n\n");
}

export function formatAnswerText(answer, citations = []) {
  const text = String(answer ?? "").trim();
  if (!citations.length) return text;
  return `${text}\n\nSources:\n${citations.map((c) => label(c.index, c)).join("\n")}`;
}

export function formatEntityText(entity) {
  if (!entity) return "No matching entity in the connected knowledge bases.";
  const lines = [`${entity.name}${entity.type ? ` (${entity.type})` : ""}`];
  if (entity.relations.length) {
    lines.push("", "Relationships:");
    for (const r of entity.relations) lines.push(`- ${r.subject} ${r.relation} ${r.object}`);
  }
  if (entity.mentions.length) {
    lines.push("", "Mentioned in:");
    entity.mentions.forEach((m, i) => lines.push(label(i + 1, m)));
  }
  return lines.join("\n");
}

export function formatSourcesText(sources, nextCursor) {
  if (!sources.length) return "No ready sources in the connected knowledge bases.";
  const lines = sources.map((s) => `- ${s.name} (${s.kind}${s.knowledgeBase ? `, ${s.knowledgeBase}` : ""}) — ${s.id}`);
  if (nextCursor) lines.push("", `More sources available — pass cursor "${nextCursor}".`);
  return lines.join("\n");
}

const slugify = (name) =>
  String(name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const fitName = (base, suffix = "") => `${base.slice(0, LOOKUP_NAME_MAX - suffix.length).replace(/_+$/, "")}${suffix}`;

// MCP names for lookup tools, in order: tool_<slug of the name> (a–z, 0–9, _), at most 48
// characters, repeats deduped as _2, _3… A name with nothing usable falls back to the id.
export function lookupToolNames(tools) {
  const used = new Set();
  return (tools || []).map((tool) => {
    const slug = slugify(tool?.name) || String(tool?.id ?? "").replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase() || "lookup";
    const base = fitName(`tool_${slug}`);
    let name = base;
    for (let n = 2; used.has(name); n += 1) name = fitName(base, `_${n}`);
    used.add(name);
    return name;
  });
}

// What a lookup tool does, from its template and labels only.
export function lookupToolDescription(spec) {
  const s = normalizeToolSpec(spec);
  const parts = [TEMPLATE_INFO[s.template].description];
  if (s.template === "classify" && s.classify.labels.length) {
    parts.push(`Labels: ${s.classify.labels.map((label) => label.value).join(", ")}.`);
  }
  return parts.join(" ");
}

// The zod equivalent of toolInputJsonSchema(spec): text and/or image, required or optional per
// the spec, absent when the spec turns them off.
export function lookupInputSchema(spec) {
  const s = normalizeToolSpec(spec);
  const { properties } = toolInputJsonSchema(s);
  const shape = {};
  if (properties.text) {
    const text = s.input.text === "required"
      ? z.string().trim().min(1).max(TOOL_LIMITS.textInputChars)
      : z.string().max(TOOL_LIMITS.textInputChars);
    shape.text = (s.input.text === "required" ? text : text.optional()).describe(properties.text.description);
  }
  if (properties.image) {
    const image = z.object({
      data: z.string().min(1).max(IMAGE_DATA_MAX_CHARS).describe(properties.image.properties.data.description),
      mimeType: z.enum(IMAGE_LIMITS.mimeTypes).optional().describe("The image type; it's read from the bytes either way."),
    });
    shape.image = (s.input.image === "required" ? image : image.optional()).describe(properties.image.description);
  }
  return z.object(shape);
}

const percent = (value) => `${Math.round((Number(value) || 0) * 100)}%`;
const itemName = (item) => item?.sourceName || "Untitled item";
const NO_LABEL = {
  no_labeled_neighbors: "no labelled stored items were similar enough",
  low_margin: "the closest labelled items disagree",
};

// A lookup tool's result as short text: the label and confidence (classify), the answer and its
// sources (answer from similar items) or the top matches (find similar), then any warnings.
export function formatLookupText(result) {
  const lines = [];
  const similar = result?.similar || [];
  const byIndex = new Map(similar.map((item) => [item.index, item]));
  if (result?.classification) {
    const c = result.classification;
    if (c.label) {
      const how = c.decidedBy === "llm" ? "decided by the model" : "nearest-neighbour vote";
      lines.push(`Label: ${c.label} (confidence ${percent(c.confidence)}, ${how}).`);
      const evidence = (c.evidenceIndexes || []).map((i) => byIndex.get(i)).filter(Boolean).slice(0, LOOKUP_TOP_ITEMS);
      if (evidence.length) lines.push(`Based on: ${evidence.map((item) => `[${item.index}] ${itemName(item)}`).join(", ")}.`);
    } else {
      lines.push(`No label: ${NO_LABEL[c.reason] || "the evidence was unclear"}.`);
    }
  } else if (result?.answer) {
    const answer = result.answer;
    lines.push(String(answer.text ?? "").trim() || "No answer.");
    if (!answer.abstained && answer.citations?.length) {
      lines.push("", "Sources:", ...answer.citations.map((c) => `[${c.index}] ${itemName(c)}`));
    }
  } else if (!similar.length) {
    lines.push("No similar stored items were found.");
  } else {
    lines.push("Most similar items:");
    for (const item of similar.slice(0, LOOKUP_TOP_ITEMS)) {
      const labels = item.labels?.length ? ` — labels: ${item.labels.join(", ")}` : "";
      lines.push(`[${item.index}] ${itemName(item)} — similarity ${(Number(item.score) || 0).toFixed(2)}${labels}${item.nearDuplicate ? " — near duplicate" : ""}`);
    }
    if (similar.length > LOOKUP_TOP_ITEMS) lines.push(`…and ${similar.length - LOOKUP_TOP_ITEMS} more in the structured result.`);
  }
  for (const w of result?.warnings || []) lines.push(`Note: ${w.message}`);
  return lines.join("\n");
}

// `ask` retrieves only from the server's knowledge bases when it has its own set (intersected with
// the pipeline's, so it can narrow but never widen what the pipeline reads).
export function scopeConfigToServer(config, server) {
  const kbIds = Array.isArray(server?.kb_ids) ? server.kb_ids.filter(Boolean) : [];
  return kbIds.length ? applyOverrides(config, { kbIds }) : config;
}

// Opaque offset cursors for list_sources.
export function encodeCursor(offset) {
  return Buffer.from(`o:${offset}`, "utf8").toString("base64url");
}

export function decodeCursor(cursor) {
  if (cursor === undefined || cursor === null || cursor === "") return 0;
  const match = /^o:(\d{1,7})$/.exec(Buffer.from(String(cursor), "base64url").toString("utf8"));
  return match ? Number(match[1]) : null;
}

const toolText = (text, structuredContent) => ({ content: [{ type: "text", text }], structuredContent });
const toolError = (message) => ({ content: [{ type: "text", text: message }], isError: true });

// --- Data access ------------------------------------------------------------------

function dbError(tag, error) {
  console.error(`[mcp.tools.${tag}]`, error?.message || error);
  return new EngineError("service_unavailable", "The service is unavailable.", { status: 503, retryable: true });
}

// Memoised per request: the published pipeline config (throws EngineError when unavailable).
function publishedConfig(ctx) {
  if (!ctx.cache.config) {
    ctx.cache.config = ctx.server.pipeline_id
      ? resolvePipelineConfig({ admin: ctx.admin, projectId: ctx.projectId, pipelineId: ctx.server.pipeline_id, channel: "mcp" })
      : Promise.reject(new EngineError("no_pipeline", "This MCP server isn't connected to a pipeline.", { status: 409 }));
    ctx.cache.config.catch(() => {});
  }
  return ctx.cache.config;
}

// Memoised per request: the knowledge bases this server may read ([{ id, name }]).
function boundaryKbs(ctx) {
  if (!ctx.cache.kbs) {
    ctx.cache.kbs = (async () => {
      let ids = Array.isArray(ctx.server.kb_ids) ? ctx.server.kb_ids.filter(Boolean) : [];
      if (!ids.length) ids = (await publishedConfig(ctx).catch(() => null))?.kbIds ?? [];
      if (!ids.length) return [];
      const { data, error } = await ctx.admin
        .from("knowledge_bases")
        .select("id,name")
        .eq("project_id", ctx.projectId)
        .in("id", ids)
        .is("deleted_at", null);
      if (error) throw dbError("kbs", error);
      return data ?? [];
    })();
  }
  return ctx.cache.kbs;
}

async function rpcScalar(ctx, name, params) {
  const { data, error } = await ctx.admin.rpc(name, params);
  if (error) throw dbError(name, error);
  if (Array.isArray(data)) return data.length ? Object.values(data[0])[0] : null;
  return data;
}

// Entity or relation ids (from `ids`; column "entity_id" | "relation_id") that have a live mention
// in a live chunk of `kbIds`.
async function groundedIds(ctx, column, ids, kbIds) {
  if (!ids.length || !kbIds.length) return new Set();
  const { data: mentions, error } = await ctx.admin
    .from("kg_mentions")
    .select(`${column},chunk_id`)
    .eq("project_id", ctx.projectId)
    .in(column, ids)
    .not("chunk_id", "is", null)
    .is("deleted_at", null)
    .limit(2000);
  if (error) throw dbError("groundedMentions", error);
  const chunkIds = [...new Set((mentions ?? []).map((m) => m.chunk_id))];
  if (!chunkIds.length) return new Set();
  const { data: chunks, error: chunkError } = await ctx.admin
    .from("chunks")
    .select("id")
    .eq("project_id", ctx.projectId)
    .in("id", chunkIds)
    .in("kb_id", kbIds)
    .eq("state", "live")
    .is("deleted_at", null);
  if (chunkError) throw dbError("groundedChunks", chunkError);
  const live = new Set((chunks ?? []).map((c) => c.id));
  return new Set((mentions ?? []).filter((m) => live.has(m.chunk_id)).map((m) => m[column]));
}

async function resolveEntityId(ctx, { id, name }, kbIds) {
  if (id) {
    const live = await rpcScalar(ctx, "kg_live_entity", { p_project: ctx.projectId, p_entity: id });
    if (!live) return null;
    const grounded = await rpcScalar(ctx, "kg_entity_grounded", { p_entity: live, p_project: ctx.projectId, p_kb_ids: kbIds });
    return grounded ? live : null;
  }
  const { data, error } = await ctx.admin.rpc("kg_match_query_entities", {
    p_project: ctx.projectId,
    p_kb_ids: kbIds,
    p_query: name,
    p_limit: 5,
  });
  if (error) throw dbError("matchEntities", error);
  const rows = data ?? [];
  const wanted = name.trim().toLowerCase();
  return (rows.find((r) => String(r.name ?? "").trim().toLowerCase() === wanted) ?? rows[0])?.entity_id ?? null;
}

async function loadEntity(ctx, entityId, kbs) {
  const kbIds = kbs.map((k) => k.id);
  const { data: row, error } = await ctx.admin
    .from("kg_entities")
    .select("id,name,type_id")
    .eq("id", entityId)
    .eq("project_id", ctx.projectId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw dbError("entity", error);
  if (!row) return null;

  // Mentions, restricted to live chunks of the server's knowledge bases.
  const { data: mentionRows, error: mentionError } = await ctx.admin
    .from("kg_mentions")
    .select("chunk_id")
    .eq("project_id", ctx.projectId)
    .eq("entity_id", entityId)
    .not("chunk_id", "is", null)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200);
  if (mentionError) throw dbError("mentions", mentionError);
  const chunkIds = [...new Set((mentionRows ?? []).map((m) => m.chunk_id))];
  let mentions = [];
  if (chunkIds.length) {
    const { data: chunks, error: chunkError } = await ctx.admin
      .from("chunks")
      .select("id,source_id,kb_id,content,page,start_ms")
      .eq("project_id", ctx.projectId)
      .in("id", chunkIds)
      .in("kb_id", kbIds)
      .eq("state", "live")
      .is("deleted_at", null)
      .limit(ENTITY_MENTIONS);
    if (chunkError) throw dbError("mentionChunks", chunkError);
    const sourceIds = [...new Set((chunks ?? []).map((c) => c.source_id))];
    const { data: sources, error: sourceError } = sourceIds.length
      ? await ctx.admin.from("sources").select("id,name").in("id", sourceIds).is("deleted_at", null)
      : { data: [], error: null };
    if (sourceError) throw dbError("mentionSources", sourceError);
    const names = new Map((sources ?? []).map((s) => [s.id, s.name]));
    mentions = (chunks ?? [])
      .filter((c) => names.has(c.source_id))
      .map((c) => ({
        chunkId: c.id,
        sourceId: c.source_id,
        sourceName: names.get(c.source_id),
        kbId: c.kb_id,
        page: c.page ?? null,
        startMs: c.start_ms ?? null,
        snippet: clip(c.content, 300),
      }));
  }

  // Current, non-Forms relations whose other endpoint is grounded in the same knowledge bases;
  // extracted (grey) relations also need a mention there themselves (same rule as grey.kg_expand).
  const { data: candidateRows, error: relationError } = await ctx.admin
    .from("kg_relations")
    .select("id,source_entity_id,target_entity_id,type_id,confidence,source_app")
    .eq("project_id", ctx.projectId)
    .or(`source_entity_id.eq.${entityId},target_entity_id.eq.${entityId}`)
    .neq("source_app", "forms")
    .is("valid_to", null)
    .is("deleted_at", null)
    .order("confidence", { ascending: false, nullsFirst: false })
    .limit(100);
  if (relationError) throw dbError("relations", relationError);
  const greyIds = (candidateRows ?? []).filter((r) => r.source_app === "grey").map((r) => r.id);
  const groundedRelations = await groundedIds(ctx, "relation_id", greyIds, kbIds);
  const relationRows = (candidateRows ?? []).filter((r) => r.source_app !== "grey" || groundedRelations.has(r.id));
  const otherIds = [
    ...new Set(relationRows.map((r) => (r.source_entity_id === entityId ? r.target_entity_id : r.source_entity_id))),
  ].filter((otherId) => otherId !== entityId);
  const grounded = await groundedIds(ctx, "entity_id", otherIds, kbIds);
  const visibleIds = otherIds.filter((otherId) => grounded.has(otherId));
  const { data: others, error: otherError } = visibleIds.length
    ? await ctx.admin.from("kg_entities").select("id,name").in("id", visibleIds).is("deleted_at", null).is("merged_into", null)
    : { data: [], error: null };
  if (otherError) throw dbError("relatedEntities", otherError);
  const otherNames = new Map((others ?? []).map((e) => [e.id, e.name]));

  const typeIds = [...new Set([row.type_id, ...relationRows.map((r) => r.type_id)].filter(Boolean))];
  const { data: types, error: typeError } = typeIds.length
    ? await ctx.admin.from("kg_types").select("id,name").in("id", typeIds)
    : { data: [], error: null };
  if (typeError) throw dbError("types", typeError);
  const typeNames = new Map((types ?? []).map((t) => [t.id, t.name]));

  const relations = relationRows
    .filter((r) => otherNames.has(r.source_entity_id === entityId ? r.target_entity_id : r.source_entity_id))
    .slice(0, ENTITY_RELATIONS)
    .map((r) => ({
      subject: r.source_entity_id === entityId ? row.name : otherNames.get(r.source_entity_id),
      subjectId: r.source_entity_id,
      relation: typeNames.get(r.type_id) || "related_to",
      object: r.target_entity_id === entityId ? row.name : otherNames.get(r.target_entity_id),
      objectId: r.target_entity_id,
      confidence: r.confidence === null || r.confidence === undefined ? null : Number(r.confidence),
    }));

  return {
    id: row.id,
    name: row.name,
    type: typeNames.get(row.type_id) ?? null,
    mentions,
    relations,
  };
}

// --- Tools ------------------------------------------------------------------

async function searchTool(ctx, { query, topK }) {
  const kbs = await boundaryKbs(ctx);
  const config = await publishedConfig(ctx).catch(() => null);
  const r = config?.retrieval ?? normalizeRetrieval({});
  const search = await searchChunks({
    admin: ctx.admin,
    projectId: ctx.projectId,
    kbIds: kbs.map((k) => k.id),
    query,
    topK: Math.min(topK ?? r.topK, SEARCH_MAX_TOP_K),
    hybrid: r.hybrid,
    rerank: r.rerank,
    rerankProviderId: r.rerankProviderId,
    rerankModel: r.rerankModel,
    threshold: r.threshold,
    graphMode: r.graphMode,
    signal: ctx.signal,
  });
  ctx.record({
    tool: "search",
    query,
    status: "ok",
    turn: { retrieved: search.chunks, retrievalMeta: search.meta },
    billed: true,
    pipelineVersion: config?.version ?? null,
  });
  const results = search.chunks.map((c) => ({
    chunkId: c.chunkId,
    sourceId: c.sourceId,
    sourceName: c.sourceName,
    kbId: c.kbId,
    content: c.content,
    score: c.score,
    page: c.page,
    startMs: c.startMs,
    endMs: c.endMs,
    headingPath: c.headingPath,
  }));
  return toolText(formatSearchText(results), { results });
}

async function askTool(ctx, { question }) {
  const config = scopeConfigToServer(await publishedConfig(ctx), ctx.server);
  const turn = await runPipelineTurn({
    admin: ctx.admin,
    projectId: ctx.projectId,
    config,
    query: question,
    history: [],
    channel: "mcp",
    stream: false,
    abortSignal: ctx.signal,
  });
  ctx.record({ tool: "ask", query: question, status: "ok", turn, final: turn, billed: true, pipelineVersion: config.version });
  return toolText(formatAnswerText(turn.text, turn.citations), {
    answer: turn.text,
    citations: turn.citations ?? [],
    noContext: Boolean(turn.noContext),
    pipelineId: config.pipelineId,
    version: config.version,
  });
}

async function getEntityTool(ctx, { id, name }) {
  if (!id && !name?.trim()) return toolError("Provide an entity id or name.");
  const kbs = await boundaryKbs(ctx);
  const kbIds = kbs.map((k) => k.id);
  const entityId = kbIds.length ? await resolveEntityId(ctx, { id, name: name?.trim() }, kbIds) : null;
  const entity = entityId ? await loadEntity(ctx, entityId, kbs) : null;
  ctx.record({ tool: "get_entity", query: id || name, status: "ok" });
  return toolText(formatEntityText(entity), { entity });
}

async function listSourcesTool(ctx, { kbId, limit, cursor }) {
  const offset = decodeCursor(cursor);
  if (offset === null) return toolError("That cursor isn't valid — call list_sources without one to start over.");
  const kbs = await boundaryKbs(ctx);
  const scoped = kbId ? kbs.filter((k) => k.id === kbId) : kbs;
  if (kbId && !scoped.length) return toolError("That knowledge base isn't available on this server.");
  const size = Math.min(limit ?? LIST_SOURCES_DEFAULT, LIST_SOURCES_MAX);
  let sources = [];
  let nextCursor = null;
  if (scoped.length) {
    const { data, error } = await ctx.admin
      .from("sources")
      .select("id,name,kind,kb_id,mime,page_count,duration_ms,chunk_count,created_at,updated_at")
      .eq("project_id", ctx.projectId)
      .in("kb_id", scoped.map((k) => k.id))
      .eq("status", "ready")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + size);
    if (error) throw dbError("sources", error);
    const kbNames = new Map(scoped.map((k) => [k.id, k.name]));
    const rows = data ?? [];
    if (rows.length > size) nextCursor = encodeCursor(offset + size);
    sources = rows.slice(0, size).map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      kbId: s.kb_id,
      knowledgeBase: kbNames.get(s.kb_id) ?? null,
      mime: s.mime ?? null,
      pageCount: s.page_count ?? null,
      durationMs: s.duration_ms ?? null,
      chunkCount: s.chunk_count ?? 0,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
    }));
  }
  ctx.record({ tool: "list_sources", query: null, status: "ok" });
  return toolText(formatSourcesText(sources, nextCursor), { sources, nextCursor });
}

// --- Lookup tools ------------------------------------------------------------------

// The enabled lookup tools that are live in the project, each with its current published spec.
// -> [{ id, name, version, spec, mcpName }] (oldest first, so names stay stable as tools are
// added). A failed load is logged and serves no lookup tools rather than failing the server.
async function loadLookupTools(ctx) {
  const ids = enabledLookupToolIds(ctx.server?.tools);
  if (!ids.length) return [];
  const { data, error } = await ctx.admin
    .from("tools")
    .select("id,name,current_version,tool_versions(version,spec)")
    .eq("project_id", ctx.projectId)
    .in("id", ids)
    .eq("status", "live")
    .is("deleted_at", null)
    .is("tool_versions.deleted_at", null)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .order("version", { referencedTable: "tool_versions", ascending: false })
    .limit(1, { referencedTable: "tool_versions" });
  if (error) {
    console.error("[mcp.tools.lookup]", error?.code || error?.message || error);
    return [];
  }
  const tools = (data ?? [])
    .map((row) => {
      const version = Number(row.current_version) || 0;
      const snapshot = (row.tool_versions ?? []).find((v) => Number(v.version) === version);
      return version > 0 && snapshot ? { id: row.id, name: row.name, version, spec: normalizeToolSpec(snapshot.spec) } : null;
    })
    .filter(Boolean);
  const names = lookupToolNames(tools);
  return tools.map((tool, i) => ({ ...tool, mcpName: names[i] }));
}

// One lookup tool call. Logged through ctx.record with billed: false — the run's own log
// (`toolRun`, written by the route after the response with recordToolRun) does the metering.
async function lookupToolCall(ctx, tool, args) {
  const startedAt = Date.now();
  const query = typeof args.text === "string" ? args.text : null;
  const fail = (code, message, toolRun) => {
    ctx.record({ tool: tool.mcpName, query, status: "error", error: { code }, ...(toolRun ? { toolRun } : {}) });
    return toolError(message);
  };

  try {
    const limit = ctx.rateLimitHit
      ? await ctx.rateLimitHit({ admin: ctx.admin, bucket: toolRateBucket(tool.id), limit: TOOL_RATE_LIMIT_PER_MIN })
      : null;
    if (limit && !limit.allowed) {
      return fail("rate_limited", `This tool's rate limit was reached — retry in ${retryAfterSeconds(limit.resetAt)}s.`);
    }
    await checkMonthlyRunLimit({ admin: ctx.admin, projectId: ctx.projectId, toolId: tool.id, spec: tool.spec });
  } catch (error) {
    if (!isEngineError(error)) console.error(`[mcp.tools.${tool.mcpName}.limits]`, error);
    return fail(runErrorCode(error), isEngineError(error) ? error.message : "Something went wrong.");
  }

  const outcome = await runToolForChannel({
    admin: ctx.admin,
    projectId: ctx.projectId,
    spec: tool.spec,
    raw: { text: args.text, image: args.image },
    channel: "mcp",
    signal: ctx.signal,
    deps: ctx.toolDeps,
  });
  const toolRun = {
    toolId: tool.id,
    version: tool.version,
    status: outcome.ok ? "ok" : "error",
    input: outcome.input,
    result: outcome.result,
    error: outcome.ok ? null : { code: runErrorCode(outcome.error) },
    latencyMs: Date.now() - startedAt,
  };
  if (!outcome.ok) {
    if (!isEngineError(outcome.error)) console.error(`[mcp.tools.${tool.mcpName}]`, outcome.error);
    return fail(toolRun.error.code, isEngineError(outcome.error) ? outcome.error.message : "Something went wrong.", toolRun);
  }

  const result = outcome.result;
  ctx.record({
    tool: tool.mcpName,
    query,
    status: "ok",
    billed: false,
    turn: { retrieved: result.similar.map((s) => ({ chunkId: s.chunkId, sourceId: s.sourceId, score: s.score, via: "tool" })) },
    toolRun,
  });
  return toolText(formatLookupText(result), withoutThumbPaths(result));
}

const TOOLS = {
  search: {
    title: "Search",
    description:
      "Search the server's knowledge bases and return the most relevant passages with their source, page and timestamp.",
    inputSchema: z.object({
      query: z.string().trim().min(1).max(8000).describe("What to search for."),
      topK: z.number().int().min(1).max(SEARCH_MAX_TOP_K).optional().describe("How many passages to return (default from the pipeline)."),
    }),
    run: searchTool,
  },
  ask: {
    title: "Ask",
    description: "Ask a question and get a grounded answer with numbered citations from the server's published pipeline.",
    inputSchema: z.object({ question: z.string().trim().min(1).max(8000).describe("The question to answer.") }),
    run: askTool,
  },
  get_entity: {
    title: "Get entity",
    description:
      "Look up a knowledge-graph entity by id or name: its type, relationships and where it's mentioned.",
    inputSchema: z.object({
      id: z.string().uuid().optional().describe("The entity id."),
      name: z.string().trim().min(1).max(200).optional().describe("The entity name (used when no id is given)."),
    }),
    run: getEntityTool,
  },
  list_sources: {
    title: "List sources",
    description: "List the ready sources (documents, pages, media) in the server's knowledge bases.",
    inputSchema: z.object({
      kbId: z.string().uuid().optional().describe("Only list sources from this knowledge base."),
      limit: z.number().int().min(1).max(LIST_SOURCES_MAX).optional().describe(`Page size (default ${LIST_SOURCES_DEFAULT}).`),
      cursor: z.string().max(200).optional().describe("nextCursor from a previous call."),
    }),
    run: listSourcesTool,
  },
};

// Errors become tool errors (isError) with a safe message, and are logged as failed calls.
function wrap(ctx, name, run) {
  return async (args) => {
    try {
      return await run(ctx, args ?? {});
    } catch (error) {
      const code = isEngineError(error) ? error.code : "internal_error";
      if (!isEngineError(error)) console.error(`[mcp.tools.${name}]`, error);
      ctx.record({ tool: name, query: args?.query ?? args?.question ?? args?.name ?? args?.id ?? null, status: "error", error: { code } });
      return toolError(isEngineError(error) ? error.message : "Something went wrong.");
    }
  };
}

// ctx: { admin, projectId, server (mcp_servers row), signal, record(entry), rateLimitHit?,
// toolDeps? (runTool deps, tests) }. Registers the enabled built-in tools, then the enabled
// lookup tools (one query, only when some are enabled). Resolves to the registered tool names.
export async function registerTools(mcp, ctx) {
  const toolCtx = { ...ctx, cache: {} };
  const names = enabledToolNames(ctx.server?.tools);
  for (const name of names) {
    const def = TOOLS[name];
    mcp.registerTool(
      name,
      { title: def.title, description: def.description, inputSchema: def.inputSchema, annotations: { title: def.title, ...READ_ONLY } },
      wrap(toolCtx, name, def.run),
    );
  }

  const lookups = await loadLookupTools(toolCtx);
  for (const tool of lookups) {
    mcp.registerTool(
      tool.mcpName,
      {
        title: tool.name,
        description: lookupToolDescription(tool.spec),
        inputSchema: lookupInputSchema(tool.spec),
        annotations: { title: tool.name, ...READ_ONLY },
      },
      (args) => lookupToolCall(toolCtx, tool, args ?? {}),
    );
  }
  return [...names, ...lookups.map((tool) => tool.mcpName)];
}
