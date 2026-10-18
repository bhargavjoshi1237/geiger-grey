// Resolves the configuration one pipeline turn runs with (spec §8.2): the draft row for the
// Playground, the published snapshot for API / MCP / widget, and the pinned version (else the
// draft) for eval runs. Per-request overrides are clamped and only ever narrow the config —
// except the Playground's knowledge-only toggle (see resolvePipelineConfig).
import { EngineError } from "./errors.js";

// Draft-based configs report version 0 (published versions start at 1).
const DRAFT_VERSION = 0;
// The hosted option has no model_providers row; resolveModel rejects it while hosting is off.
const HOSTED_ID = "grey-hosted";
const PUBLISHED_CHANNELS = new Set(["api", "mcp", "widget"]);
const CHANNELS = new Set(["playground", "eval", ...PUBLISHED_CHANNELS]);
const GRAPH_MODES = new Set(["off", "auto", "always"]);
const MAX_TOKENS_CAP = 32000;

const PIPELINE_COLUMNS =
  "id,kb_ids,provider_id,model,temperature,max_tokens,system_prompt,retrieval,status,current_version,metadata";

export const DEFAULT_RETRIEVAL = {
  topK: 6,
  hybrid: true,
  rerank: false,
  rerankProviderId: null,
  rerankModel: null,
  threshold: 0.2,
  graphMode: "auto",
  citations: true,
};

const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value)));
const optionalText = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);

export function normalizeRetrieval(retrieval) {
  const r = { ...DEFAULT_RETRIEVAL, ...(retrieval && typeof retrieval === "object" ? retrieval : {}) };
  return {
    ...r,
    topK: finite(r.topK) ? Math.round(clamp(r.topK, 1, 50)) : DEFAULT_RETRIEVAL.topK,
    hybrid: r.hybrid !== false,
    rerank: r.rerank === true,
    rerankProviderId: optionalText(r.rerankProviderId),
    rerankModel: optionalText(r.rerankModel),
    threshold: finite(r.threshold) ? clamp(r.threshold, 0, 1) : DEFAULT_RETRIEVAL.threshold,
    graphMode: GRAPH_MODES.has(r.graphMode) ? r.graphMode : DEFAULT_RETRIEVAL.graphMode,
    citations: r.citations !== false,
  };
}

// metadata.hostedProvider is set only when the resolved provider really is the hosted one, so a
// published snapshot on a real provider never inherits the draft's hosted flag (and vice versa).
function withHostedFlag(metadata, providerId) {
  const rest = { ...(metadata && typeof metadata === "object" ? metadata : {}) };
  delete rest.hostedProvider;
  return providerId === HOSTED_ID ? { ...rest, hostedProvider: true } : rest;
}

function fromDraft(row) {
  const providerId = row.provider_id ?? (row.metadata?.hostedProvider ? HOSTED_ID : null);
  return {
    kbIds: row.kb_ids || [],
    providerId,
    model: row.model ?? null,
    temperature: finite(row.temperature) ? Number(row.temperature) : null,
    maxTokens: finite(row.max_tokens) ? Number(row.max_tokens) : null,
    systemPrompt: row.system_prompt || "",
    retrieval: normalizeRetrieval(row.retrieval),
    metadata: withHostedFlag(row.metadata, providerId),
  };
}

// pipeline_versions.config is the camelCase snapshot written by publishPipeline().
function fromSnapshot(config, row) {
  const c = config && typeof config === "object" ? config : {};
  const providerId = c.providerId ?? null;
  return {
    kbIds: Array.isArray(c.kbIds) ? c.kbIds : [],
    providerId,
    model: c.model ?? null,
    temperature: finite(c.temperature) ? Number(c.temperature) : null,
    maxTokens: finite(c.maxTokens) ? Number(c.maxTokens) : null,
    systemPrompt: c.systemPrompt || "",
    retrieval: normalizeRetrieval(c.retrieval),
    metadata: withHostedFlag(row.metadata, providerId),
  };
}

// Overrides: temperature 0–2, topK 1–50, threshold 0–1, maxTokens 1..pipeline max,
// kbIds narrowed to a subset of the pipeline's own knowledge bases.
export function applyOverrides(config, overrides) {
  if (!overrides || typeof overrides !== "object") return config;
  const next = { ...config, retrieval: { ...config.retrieval } };
  if (finite(overrides.temperature)) next.temperature = clamp(overrides.temperature, 0, 2);
  if (finite(overrides.topK)) next.retrieval.topK = Math.round(clamp(overrides.topK, 1, 50));
  if (finite(overrides.threshold)) next.retrieval.threshold = clamp(overrides.threshold, 0, 1);
  if (finite(overrides.maxTokens)) {
    next.maxTokens = Math.round(clamp(overrides.maxTokens, 1, config.maxTokens || MAX_TOKENS_CAP));
  }
  if (Array.isArray(overrides.kbIds)) {
    const allowed = new Set(config.kbIds);
    next.kbIds = [...new Set(overrides.kbIds)].filter((id) => allowed.has(id));
  }
  return next;
}

async function loadVersion(admin, projectId, pipelineId, version) {
  const { data, error } = await admin
    .from("pipeline_versions")
    .select("version,config")
    .eq("project_id", projectId)
    .eq("pipeline_id", pipelineId)
    .eq("version", version)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    console.error("[engine.pipeline_config.version]", error.message);
    throw new EngineError("service_unavailable", "The service is unavailable.", { status: 503, retryable: true });
  }
  return data;
}

// -> { pipelineId, version, kbIds, providerId, model, temperature, maxTokens, systemPrompt,
//      retrieval, metadata, status, knowledgeOnly? (false only for a Playground session) }
export async function resolvePipelineConfig({
  admin,
  projectId,
  pipelineId,
  channel = "playground",
  version,
  overrides,
} = {}) {
  if (!CHANNELS.has(channel)) throw new EngineError("invalid_channel", "Unknown channel.", { status: 400 });

  const { data: row, error } = await admin
    .from("pipelines")
    .select(PIPELINE_COLUMNS)
    .eq("id", pipelineId)
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    console.error("[engine.pipeline_config.pipeline]", error.message);
    throw new EngineError("service_unavailable", "The service is unavailable.", { status: 503, retryable: true });
  }
  if (!row) throw new EngineError("pipeline_not_found", "Pipeline not found.", { status: 404 });

  const pinned = Number.isInteger(Number(version)) && Number(version) > 0 ? Number(version) : null;
  let resolved = fromDraft(row);
  let resolvedVersion = DRAFT_VERSION;

  if (PUBLISHED_CHANNELS.has(channel)) {
    const current = Number(row.current_version) || 0;
    if (row.status !== "live" || current < 1) {
      throw new EngineError("pipeline_not_live", "This pipeline isn't published yet.", { status: 409 });
    }
    const wanted = pinned ?? current;
    const snapshot = await loadVersion(admin, projectId, pipelineId, wanted);
    if (!snapshot) {
      throw new EngineError("pipeline_version_not_found", `Version ${wanted} of this pipeline doesn't exist.`, { status: 404 });
    }
    resolved = fromSnapshot(snapshot.config, row);
    resolvedVersion = wanted;
  } else if (channel === "eval" && pinned) {
    // Evals pin a published version when it exists; otherwise (e.g. version 0) the draft runs.
    const snapshot = await loadVersion(admin, projectId, pipelineId, pinned);
    if (snapshot) {
      resolved = fromSnapshot(snapshot.config, row);
      resolvedVersion = pinned;
    }
  }

  const config = applyOverrides(
    { pipelineId: row.id, version: resolvedVersion, status: row.status, ...resolved },
    overrides,
  );
  // Letting the model use general knowledge loosens grounding, so it's a Playground-only
  // session toggle; every other channel stays knowledge-only.
  if (channel === "playground" && overrides?.knowledgeOnly === false) config.knowledgeOnly = false;
  return config;
}
