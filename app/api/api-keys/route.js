import { handle, json, ApiError } from "@/lib/server/errors";
import { requirePermission } from "@/lib/server/auth";
import { toCamel } from "@/lib/supabase/repository";
import { generateApiKey, hashApiKey } from "@/lib/grey/api_keys";

export const runtime = "nodejs";

export const POST = handle(async (request) => {
  const body = await request.json().catch(() => null);
  const projectId = body?.projectId;
  if (!projectId) throw new ApiError("invalid_input", 422, "projectId is required.");

  const { admin, user } = await requirePermission(request, projectId, "grey.apikey.manage");

  const name = body?.name;
  if (!name) throw new ApiError("invalid_input", 422, "name is required.");

  const { key, prefix } = generateApiKey();
  const keyHash = hashApiKey(key);

  const { data: row, error } = await admin.from("api_keys").insert({
    project_id: projectId,
    name,
    prefix,
    key_hash: keyHash,
    scopes: body?.scopes ?? [],
    pipeline_ids: body?.pipelineIds ?? [],
    rate_limit_per_min: body?.rateLimitPerMin ?? null,
    expires_at: body?.expiresAt ?? null,
    created_by: user.id,
  }).select("*").maybeSingle();
  if (error || !row) throw new ApiError("service_unavailable", 503, "Could not create the API key.");

  const { key_hash: _keyHash, ...rest } = row;
  return json({ key, record: toCamel(rest) });
});
