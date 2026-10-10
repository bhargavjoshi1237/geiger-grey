import { handle, json, ApiError } from "@/lib/server/errors";
import { authenticate, authorize, isUuid } from "@/lib/server/auth";
import { adminClient } from "@/lib/supabase/admin";
import { toCamel } from "@/lib/server/case";

export const runtime = "nodejs";

export const POST = handle(async (request, { params }) => {
  const { id } = await params;
  const user = await authenticate(request); // auth before any DB read, to avoid an existence leak

  if (!isUuid(id)) throw new ApiError("not_found", 404, "Provider not found.");

  const admin = adminClient();
  if (!admin) throw new ApiError("service_unavailable", 503, "The service is unavailable.");

  const { data: provider, error } = await admin.from("model_providers")
    .select("*").eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) {
    console.error("[api.providers.test.load]", error);
    throw new ApiError("service_unavailable", 503, "The service is unavailable.");
  }
  if (!provider) throw new ApiError("not_found", 404, "Provider not found.");

  // "Not a member" and "no permission" collapse into the same 404 as "no such provider".
  await authorize({
    admin, user, projectId: provider.project_id, key: "grey.provider.manage",
    notFoundOnDenied: true, notFoundMessage: "Provider not found.",
  });

  const status = provider.secret_id ? "ok" : "error";
  const { data: updated, error: updateError } = await admin.from("model_providers")
    .update({ status, last_checked_at: new Date().toISOString() })
    .eq("id", id).is("deleted_at", null).select("*").maybeSingle();
  if (updateError || !updated) {
    console.error("[api.providers.test.update]", updateError);
    throw new ApiError("service_unavailable", 503, "Could not test the provider.");
  }

  return json(toCamel(updated));
});
