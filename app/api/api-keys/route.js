import { handle, json, ApiError } from "@/lib/server/errors";
import { requirePermission, isUuid } from "@/lib/server/auth";
import { toCamel } from "@/lib/server/case";
import { generateApiKey, hashApiKey } from "@/lib/grey/api_keys";

export const runtime = "nodejs";

const ALLOWED_SCOPES = ["retrieve", "chat", "mcp"];

export const POST = handle(async (request) => {
  const body = await request.json().catch(() => null);
  const projectId = body?.projectId;

  // Non-uuid/missing projectId resolves inside requirePermission -> 404 "Project not found."
  const { admin, user } = await requirePermission(request, projectId, "grey.apikey.manage");

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 80) throw new ApiError("invalid_input", 422, "name must be 1-80 characters.");

  const scopes = body?.scopes === undefined ? ["retrieve", "chat"] : body.scopes;
  if (!Array.isArray(scopes) || !scopes.every((scope) => ALLOWED_SCOPES.includes(scope))) {
    throw new ApiError("invalid_input", 422, "scopes must be a subset of retrieve, chat, mcp.");
  }

  const pipelineIds = body?.pipelineIds === undefined ? [] : body.pipelineIds;
  if (!Array.isArray(pipelineIds) || !pipelineIds.every(isUuid)) {
    throw new ApiError("invalid_input", 422, "pipelineIds must be valid ids.");
  }
  if (pipelineIds.length) {
    const { data: pipelineRows, error: pipelineError } = await admin.from("pipelines")
      .select("id").eq("project_id", projectId).in("id", pipelineIds).is("deleted_at", null);
    if (pipelineError) {
      console.error("[api.api-keys.pipelines]", pipelineError);
      throw new ApiError("service_unavailable", 503, "The service is unavailable.");
    }
    const foundIds = new Set((pipelineRows ?? []).map((row) => row.id));
    if (!pipelineIds.every((pipelineId) => foundIds.has(pipelineId))) {
      throw new ApiError("invalid_input", 422, "pipelineIds must belong to this project.");
    }
  }

  const rateLimitPerMin = body?.rateLimitPerMin === undefined ? 60 : body.rateLimitPerMin;
  if (!Number.isInteger(rateLimitPerMin) || rateLimitPerMin < 1 || rateLimitPerMin > 10000) {
    throw new ApiError("invalid_input", 422, "rateLimitPerMin must be an integer from 1 to 10000.");
  }

  let expiresAt = null;
  if (body?.expiresAt !== undefined && body?.expiresAt !== null) {
    const parsed = new Date(body.expiresAt);
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
      throw new ApiError("invalid_input", 422, "expiresAt must be a future date.");
    }
    expiresAt = parsed.toISOString();
  }

  const { key, prefix } = generateApiKey();
  const keyHash = hashApiKey(key);

  const { data: row, error } = await admin.from("api_keys").insert({
    project_id: projectId,
    name,
    prefix,
    key_hash: keyHash,
    scopes,
    pipeline_ids: pipelineIds,
    rate_limit_per_min: rateLimitPerMin,
    expires_at: expiresAt,
    created_by: user.id,
  }).select("*").maybeSingle();
  if (error || !row) {
    console.error("[api.api-keys.insert]", error);
    throw new ApiError("service_unavailable", 503, "Could not create the API key.");
  }

  const { key_hash: _keyHash, ...rest } = row;
  return json({ key, record: toCamel(rest) });
});
