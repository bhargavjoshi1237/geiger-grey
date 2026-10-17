import { handle, json, ApiError } from "@/lib/server/errors";
import { isUuid, requirePermission } from "@/lib/server/auth";
import { detectEmbeddingDims } from "@/lib/engine/embeddings";
import { isEngineError } from "@/lib/engine/errors";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL_MAX = 200;

// POST { projectId, providerId, model, requestedDims? } -> { dims }
// Embeds "ping" through the connection's embed driver and reports the vector length.
export const POST = handle(async (request) => {
  const body = await request.json().catch(() => null);
  const { admin } = await requirePermission(request, body?.projectId, "grey.kb.manage");

  const providerId = body?.providerId;
  const model = typeof body?.model === "string" ? body.model.trim() : "";
  const requestedDims = body?.requestedDims ?? null;
  if (!isUuid(providerId)) throw new ApiError("invalid_input", 422, "providerId must be a provider id.");
  if (!model || model.length > MODEL_MAX) throw new ApiError("invalid_input", 422, "model is required.");
  if (requestedDims !== null && !Number.isInteger(requestedDims)) {
    throw new ApiError("invalid_input", 422, "requestedDims must be a whole number.");
  }

  try {
    const { dims } = await detectEmbeddingDims({ admin, projectId: body.projectId, providerId, model, requestedDims });
    return json({ dims });
  } catch (error) {
    if (isEngineError(error)) throw new ApiError(error.code, error.status, error.message);
    throw error;
  }
});
