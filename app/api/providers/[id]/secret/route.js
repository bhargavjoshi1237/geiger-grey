import { handle, json, ApiError } from "@/lib/server/errors";
import { requirePermission } from "@/lib/server/auth";
import { adminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export const POST = handle(async (request, { params }) => {
  const { id } = await params;
  const admin = adminClient();
  if (!admin) throw new ApiError("service_unavailable", 503, "The service is unavailable.");

  const { data: provider, error } = await admin.from("model_providers")
    .select("id,project_id").eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) throw new ApiError("service_unavailable", 503, "The service is unavailable.");
  if (!provider) throw new ApiError("not_found", 404, "Provider not found.");

  await requirePermission(request, provider.project_id, "grey.provider.manage");

  const body = await request.json().catch(() => null);
  const secret = body?.secret;
  if (!secret || typeof secret !== "string") throw new ApiError("invalid_input", 422, "secret is required.");

  const { error: rpcError } = await admin.rpc("set_provider_secret", { p_provider: id, p_secret: secret });
  if (rpcError) throw new ApiError("service_unavailable", 503, "Could not store the secret.");

  return json({ ok: true, keyLast4: secret.slice(-4) });
});
