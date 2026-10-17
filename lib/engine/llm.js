// Chat model resolution (spec §8.1): a pipeline/processing config -> an AI SDK
// LanguageModel built directly on the customer's provider (never through a gateway).
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { EngineError } from "./errors.js";
import { connectProvider } from "./secrets.js";
import { providerFetch } from "./net.js";
import { GREY_HOSTED_ENABLED, GREY_HOSTED_ID, HOSTED_MODEL_ALIASES } from "../grey/provider_kinds.js";
import { supportsTemperature } from "../grey/model_caps.js";

// conn: from connectProvider(..., capability: 'chat'). -> AI SDK LanguageModel
// Custom base URLs passed the SSRF guard; providerFetch keeps them there (no redirects,
// public addresses re-checked at connect time).
export function buildLanguageModel(conn, modelId) {
  const { apiKey, baseUrl: baseURL, custom } = conn;
  const fetch = custom ? providerFetch : undefined;
  switch (conn.format) {
    case "openai": {
      const openai = createOpenAI({ apiKey, baseURL, fetch });
      // Proxies behind a custom URL usually speak Chat Completions, not Responses.
      return custom ? openai.chat(modelId) : openai(modelId);
    }
    case "anthropic":
      return createAnthropic({ apiKey, baseURL, fetch })(modelId);
    case "google":
      return createGoogleGenerativeAI({ apiKey, baseURL, fetch })(modelId);
    case "openai_compatible":
      return createOpenAICompatible({
        name: conn.provider.provider === "openrouter" ? "openrouter" : "openai-compatible",
        baseURL,
        apiKey,
        includeUsage: true,
        fetch,
      }).chatModel(modelId);
    default:
      throw new EngineError("capability_missing", "This connection's chat format isn't supported.", { status: 422 });
  }
}

// Grey-run models stay behind GREY_HOSTED_ENABLED (spec §4.4, §21). The alias map is
// kept so enabling them is configuration; until Grey has its own accounts there is
// no hosted key to build a model with.
function resolveHosted(config) {
  if (!GREY_HOSTED_ENABLED) {
    throw new EngineError(
      "hosted_unavailable",
      "Grey hosted models aren't available yet — choose one of your own providers.",
      { status: 422 },
    );
  }
  const target = HOSTED_MODEL_ALIASES[config.model] || HOSTED_MODEL_ALIASES["grey-balanced"];
  throw new EngineError("hosted_unavailable", `Grey hosted ${target} isn't configured on this deployment.`, { status: 422 });
}

// config: { providerId, model, temperature, maxTokens, metadata? }
// -> { model, modelId, providerKind, providerId, hosted: false, supportsTemperature }
// Throws EngineError hosted_unavailable | no_provider | provider_not_found | no_key |
// capability_missing | no_model | no_base_url | unsafe_base_url.
export async function resolveModel({ admin, projectId, config }) {
  const cfg = config || {};
  if (cfg.providerId === GREY_HOSTED_ID || cfg.metadata?.hostedProvider) return resolveHosted(cfg);
  if (!cfg.providerId) {
    throw new EngineError("no_provider", "Choose a model provider for this pipeline.", { status: 422 });
  }
  const conn = await connectProvider({ admin, projectId, providerId: cfg.providerId, capability: "chat" });
  const modelId = String(cfg.model || "").trim() || conn.provider.models?.[0];
  if (!modelId) {
    throw new EngineError("no_model", `Add a model id to "${conn.provider.name}" in Model Providers.`, { status: 422 });
  }
  return {
    model: buildLanguageModel(conn, modelId),
    modelId,
    providerKind: conn.provider.provider,
    providerId: conn.provider.id,
    hosted: false,
    supportsTemperature: supportsTemperature(conn.provider.provider, modelId),
  };
}

// The project's processing model (graph extraction, contextual enrichment, eval
// judge). -> resolveModel() shape, or null when Settings → General has none set.
// Throws EngineError when one is set but can't be used (no key, deleted, …).
export async function getProcessingModel({ admin, projectId }) {
  const { data, error } = await admin
    .from("project_settings")
    .select("processing_provider_id,processing_model")
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    console.error("[engine.llm.getProcessingModel]", error.code || "query_error");
    throw new EngineError("service_unavailable", "Couldn't load the project's settings.", { status: 503, retryable: true });
  }
  if (!data?.processing_provider_id) return null;
  return resolveModel({
    admin,
    projectId,
    config: { providerId: data.processing_provider_id, model: data.processing_model },
  });
}
