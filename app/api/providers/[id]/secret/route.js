import { handle, json, ApiError } from "@/lib/server/errors";
import { authenticate, authorize, isUuid } from "@/lib/server/auth";
import { adminClient } from "@/lib/supabase/admin";
import { toCamel } from "@/lib/server/case";
import { runProviderTest } from "@/lib/server/provider_test";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = handle(async (request, { params }) => {
  const { id } = await params;
  const user = await authenticate(request); // auth before any DB read, to avoid an existence leak

  if (!isUuid(id)) throw new ApiError("not_found", 404, "Provider not found.");

  const admin = adminClient();
  if (!admin) throw new ApiError("service_unavailable", 503, "The service is unavailable.");

  const { data: provider, error } = await admin.from("model_providers")
    .select("id,project_id").eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) {
    console.error("[api.providers.secret.load]", error);
    throw new ApiError("service_unavailable", 503, "The service is unavailable.");
  }
  if (!provider) throw new ApiError("not_found", 404, "Provider not found.");

  // "Not a member" and "no permission" collapse into the same 404 as "no such provider".
  await authorize({
    admin, user, projectId: provider.project_id, key: "grey.provider.manage",
    notFoundOnDenied: true, notFoundMessage: "Provider not found.",
  });

  const body = await request.json().catch(() => null);
  const secret = typeof body?.secret === "string" ? body.secret.trim() : "";
  if (!secret) throw new ApiError("invalid_input", 422, "secret is required.");

  const { data: saved, error: rpcError } = await admin.rpc("set_provider_secret", { p_provider: id, p_secret: secret });
  if (rpcError || !saved) {
    console.error("[api.providers.secret.rpc]", rpcError?.code || "no_row");
    throw new ApiError("service_unavailable", 503, "Could not store the secret.");
  }

  // Health check on save: the key is stored either way; a failed test only leaves it unverified.
  const keyLast4 = secret.slice(-4);
  try {
    const tested = await runProviderTest({ admin, provider: saved });
    return json({ ok: true, keyLast4, status: tested.status, provider: toCamel(tested) });
  } catch (testError) {
    console.error("[api.providers.secret.test]", testError?.code || "test_failed");
    return json({ ok: true, keyLast4, status: saved.status, provider: toCamel(saved) });
  }
});
