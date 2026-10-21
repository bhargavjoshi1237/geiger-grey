import { isUuid } from "@/lib/server/auth";
import { ApiError } from "@/lib/server/errors";
import { apiError, authenticateApiKey, handleApi } from "@/lib/server/api_key_auth";
import { scheduleDeliveryLog } from "@/lib/server/delivery_log";
import { isEngineError } from "@/lib/engine/errors";
import { resolvePipelineConfig } from "@/lib/engine/pipeline_config";
import { searchChunks } from "@/lib/engine/retrieval";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_QUERY_CHARS = 8000;

function toApiError(error, headers) {
  if (error instanceof ApiError) return Object.assign(error, { headers: { ...headers, ...(error.headers || {}) } });
  if (isEngineError(error)) return apiError(error.code, error.status || 500, error.message, headers);
  console.error("[api.v1.retrieve]", error);
  return apiError("internal_error", 500, "Something went wrong.", headers);
}

// { query (1–8000), topK? (1–50), threshold? (0–1), kbIds? (subset of the pipeline's) }
function parseBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError("invalid_input", 400, "The request body must be a JSON object.");
  }
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query || query.length > MAX_QUERY_CHARS) {
    throw new ApiError("invalid_input", 400, `query must be 1–${MAX_QUERY_CHARS} characters.`);
  }
  const out = { query, topK: null, threshold: null, kbIds: null };
  if (body.topK !== undefined && body.topK !== null) {
    if (!Number.isInteger(body.topK) || body.topK < 1 || body.topK > 50) {
      throw new ApiError("invalid_input", 400, "topK must be an integer from 1 to 50.");
    }
    out.topK = body.topK;
  }
  if (body.threshold !== undefined && body.threshold !== null) {
    if (typeof body.threshold !== "number" || !Number.isFinite(body.threshold) || body.threshold < 0 || body.threshold > 1) {
      throw new ApiError("invalid_input", 400, "threshold must be a number from 0 to 1.");
    }
    out.threshold = body.threshold;
  }
  if (body.kbIds !== undefined && body.kbIds !== null) {
    if (!Array.isArray(body.kbIds) || !body.kbIds.length || !body.kbIds.every(isUuid)) {
      throw new ApiError("invalid_input", 400, "kbIds must be a non-empty array of knowledge base ids.");
    }
    out.kbIds = [...new Set(body.kbIds)];
  }
  return out;
}

// Raw retrieval against a published pipeline's knowledge bases and retrieval settings.
export const POST = handleApi(async (request, { params }) => {
  const { pipelineId } = await params;
  const auth = await authenticateApiKey(request, { scope: "retrieve", pipelineId });
  const { admin, key, projectId, headers } = auth;

  try {
    if (!isUuid(pipelineId)) throw new ApiError("pipeline_not_found", 404, "Pipeline not found.");
    const input = parseBody(await request.json().catch(() => null));

    const config = await resolvePipelineConfig({
      admin,
      projectId,
      pipelineId,
      channel: "api",
      overrides: { topK: input.topK, threshold: input.threshold },
    });
    let kbIds = config.kbIds;
    if (input.kbIds) {
      const allowed = new Set(config.kbIds);
      if (!input.kbIds.every((id) => allowed.has(id))) {
        throw new ApiError("invalid_input", 400, "kbIds must be a subset of the pipeline's knowledge bases.");
      }
      kbIds = input.kbIds;
    }

    const settle = scheduleDeliveryLog({
      admin,
      projectId,
      pipelineId,
      pipelineVersion: config.version,
      apiKeyId: key.id,
      channel: "api",
      query: input.query,
      refType: "api_key",
      refId: key.id,
      metadata: { endpoint: "retrieve" },
    });

    let search;
    try {
      const r = config.retrieval;
      search = await searchChunks({
        admin,
        projectId,
        kbIds,
        query: input.query,
        topK: r.topK,
        hybrid: r.hybrid,
        rerank: r.rerank,
        rerankProviderId: r.rerankProviderId,
        rerankModel: r.rerankModel,
        threshold: r.threshold,
        graphMode: r.graphMode,
        signal: request.signal,
      });
    } catch (error) {
      settle({ status: "error", error: { code: error?.code || "internal_error" } });
      throw error;
    }
    settle({ status: "ok", turn: { retrieved: search.chunks, retrievalMeta: search.meta }, billed: true });

    // `image` carries internal storage paths (thumbnails); public callers get modality/sourceKind only.
    const chunks = search.chunks.map(({ image: _image, ...chunk }) => chunk);
    return Response.json(
      { object: "retrieval", pipelineId, version: config.version, query: input.query, chunks },
      { headers },
    );
  } catch (error) {
    throw toApiError(error, headers);
  }
});
