import { handle, json, ApiError } from "@/lib/server/errors";
import { requirePermission } from "@/lib/server/auth";
import { adminClient } from "@/lib/supabase/admin";
import { toCamel } from "@/lib/supabase/repository";

export const runtime = "nodejs";

export const POST = handle(async (request, { params }) => {
  const { id } = await params;
  const admin = adminClient();
  if (!admin) throw new ApiError("service_unavailable", 503, "The service is unavailable.");

  const { data: provider, error } = await admin.from("model_providers")
    .select("*").eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) throw new ApiError("service_unavailable", 503, "The service is unavailable.");
  if (!provider) throw new ApiError("not_found", 404, "Provider not found.");

  await requirePermission(request, provider.project_id, "grey.provider.manage");

  const status = provider.secret_id ? "ok" : "error";
  const { data: updated, error: updateError } = await admin.from("model_providers")
    .update({ status, last_checked_at: new Date().toISOString() })
    .eq("id", id).select("*").maybeSingle();
  if (updateError || !updated) throw new ApiError("service_unavailable", 503, "Could not test the provider.");

  return json(toCamel(updated));
});
