// Provider rows and keys for engine calls (spec §4.2). Keys come from Vault via the
// service-role-only grey.get_provider_secret(); callers keep them in a local
// variable for one call — never log, cache or return them.
import { EngineError } from "./errors.js";
import { CAPABILITY_LABELS, driverFormat, hasCustomBaseUrl, keyRequired, resolveBaseUrl } from "../grey/provider_kinds.js";
import { assertPublicBaseUrl, localProvidersAllowed } from "../grey/url_guard.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isUuid = (value) => typeof value === "string" && UUID_RE.test(value);

// -> string | null (null when the provider has no key, isn't in the project, or is deleted).
export async function getProviderSecret({ admin, projectId, providerId }) {
  if (!isUuid(projectId) || !isUuid(providerId)) return null;
  const { data, error } = await admin.rpc("get_provider_secret", { p_provider: providerId, p_project: projectId });
  if (error) {
    // The error object never contains the secret; log only its code.
    console.error("[engine.secrets.getProviderSecret]", error.code || "rpc_error");
    throw new EngineError("service_unavailable", "Couldn't read the provider's key.", { status: 503, retryable: true });
  }
  return typeof data === "string" && data ? data : null;
}

// -> the project's provider row (snake_case), or null when missing/deleted/elsewhere.
export async function loadProvider({ admin, projectId, providerId }) {
  if (!isUuid(projectId) || !isUuid(providerId)) return null;
  const { data, error } = await admin
    .from("model_providers")
    .select("*")
    .eq("id", providerId)
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    console.error("[engine.secrets.loadProvider]", error.code || "query_error");
    throw new EngineError("service_unavailable", "Couldn't load the model provider.", { status: 503, retryable: true });
  }
  return data || null;
}

// The URL a connection calls. Custom URLs (anything but the kind's default) pass the
// SSRF guard: https + public addresses, plus local servers only in development or with
// GREY_ALLOW_LOCAL_PROVIDERS=1 (localProvidersAllowed). Requests to a custom URL go
// through providerFetch (lib/engine/net.js), which re-checks addresses at connect time.
// -> { baseUrl, custom }
export async function checkedBaseUrl(provider) {
  const baseUrl = resolveBaseUrl(provider);
  if (!baseUrl) {
    throw new EngineError("no_base_url", `Add a base URL for "${provider?.name || "this connection"}" in Model Providers.`, { status: 422 });
  }
  if (!hasCustomBaseUrl(provider)) return { baseUrl, custom: false };
  try {
    return { baseUrl: await assertPublicBaseUrl(baseUrl, { allowLocal: localProvidersAllowed(process.env) }), custom: true };
  } catch (err) {
    throw new EngineError("unsafe_base_url", `This connection's base URL can't be used: ${err?.message || "blocked"}`, { status: 422 });
  }
}

// Everything a driver call needs for one capability of one connection:
// -> { provider, format, baseUrl, custom, apiKey }   (apiKey: keep it local, never log it)
// Throws EngineError provider_not_found | capability_missing | no_key | no_base_url | unsafe_base_url.
export async function connectProvider({ admin, projectId, providerId, capability }) {
  const provider = await loadProvider({ admin, projectId, providerId });
  if (!provider) {
    throw new EngineError("provider_not_found", "The selected model provider no longer exists — choose another one.", { status: 422 });
  }
  const format = driverFormat(provider, capability);
  if (!format) {
    const label = (CAPABILITY_LABELS[capability] || capability).toLowerCase();
    throw new EngineError("capability_missing", `"${provider.name}" can't be used for ${label}.`, { status: 422 });
  }
  const { baseUrl, custom } = await checkedBaseUrl(provider);
  const apiKey = await getProviderSecret({ admin, projectId, providerId });
  if (!apiKey && keyRequired(provider)) {
    throw new EngineError("no_key", `Add an API key for "${provider.name}" in Model Providers.`, { status: 422 });
  }
  return { provider, format, baseUrl, custom, apiKey: apiKey || undefined };
}
