import { handle, json, ApiError } from "@/lib/server/errors";
import { authenticate, authorize, isUuid } from "@/lib/server/auth";
import { adminClient } from "@/lib/supabase/admin";
import { toCamel } from "@/lib/server/case";
import { runProviderTest } from "@/lib/server/provider_test";

export const runtime = "nodejs";
export const maxDuration = 60;

// Makes one minimal real call per capability and records status/last_checked_at/metadata.lastError.
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

  const updated = await runProviderTest({ admin, provider });
  return json(toCamel(updated));
});
