// Real provider connection test (spec §4.2): one minimal call per capability the
// connection offers, then status ok|error, last_checked_at and metadata.lastError
// (mapped code + message, never raw provider text) are written to the row.
// Used by the test route and, right after a key is saved, the secret route.
import { generateText } from "ai";
import { connectProvider } from "@/lib/engine/secrets";
import { buildLanguageModel } from "@/lib/engine/llm";
import { embedWithConnection } from "@/lib/engine/embeddings";
import { rerankWithConnection } from "@/lib/engine/rerank";
import { requestJson } from "@/lib/engine/drivers/http";
import { isEngineError } from "@/lib/engine/errors";
import { capabilitiesOf, hasCapability, suggestedModelsFor } from "@/lib/grey/provider_kinds";
import { DEFAULT_REQUESTED_DIMS, acceptsDimensionParam, joinUrl } from "@/lib/grey/embedding_models";
import { mapLlmError } from "@/lib/grey/llm_errors";
import { ApiError } from "./errors.js";

const TIMEOUT_MS = 15_000;
const SKIPPED = { skipped: true };

class CheckFailure extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// 16 output tokens: the smallest budget every chat API accepts (OpenAI's Responses
// API rejects fewer). No temperature, no retries.
async function checkChat(conn) {
  const modelId = conn.provider.models?.[0];
  if (!modelId) throw new CheckFailure("no_model", "Add a model id to test.");
  await generateText({
    model: buildLanguageModel(conn, modelId),
    prompt: "ping",
    maxOutputTokens: 16,
    maxRetries: 0,
    timeout: TIMEOUT_MS,
  });
}

// Embedding/rerank models aren't stored on the connection; test with the first
// suggestion (preset, or the kind's own on its default URL), else skip.
async function checkEmbed(conn) {
  const model = suggestedModelsFor(conn.provider, "embed")[0]?.id;
  if (!model) return SKIPPED;
  await embedWithConnection(conn, {
    model,
    texts: ["ping"],
    inputType: "query",
    dimensions: acceptsDimensionParam(conn.format, model) ? DEFAULT_REQUESTED_DIMS : undefined,
    timeoutMs: TIMEOUT_MS,
    retries: 0,
  });
}

async function checkRerank(conn) {
  const model = suggestedModelsFor(conn.provider, "rerank")[0]?.id;
  if (!model) return SKIPPED;
  await rerankWithConnection(conn, { model, query: "ping", documents: ["ping", "pong"], topN: 2, timeoutMs: TIMEOUT_MS, retries: 0 });
}

async function checkTranscribe(conn) {
  const options = { timeoutMs: TIMEOUT_MS, retries: 0, noRedirect: conn.custom };
  if (conn.format === "assemblyai") {
    await requestJson(joinUrl(conn.baseUrl, "v2/transcript?limit=1"), { method: "GET", headers: { Authorization: conn.apiKey } }, options);
    return;
  }
  // OpenAI-format servers: the chat check already proves the key when there is one.
  if (hasCapability(conn.provider, "chat")) return SKIPPED;
  try {
    const headers = conn.apiKey ? { Authorization: `Bearer ${conn.apiKey}` } : {};
    await requestJson(joinUrl(conn.baseUrl, "models"), { method: "GET", headers }, options);
  } catch (err) {
    // Some self-hosted Whisper servers have no /models route — that says nothing about the key.
    if (err?.code === "model_not_found") return SKIPPED;
    throw err;
  }
}

const CHECKS = { chat: checkChat, embed: checkEmbed, rerank: checkRerank, transcribe: checkTranscribe };

function describe(err) {
  if (err instanceof CheckFailure || isEngineError(err)) return { code: err.code, message: err.message };
  const mapped = mapLlmError(err);
  return { code: mapped.code, message: mapped.message };
}

// Runs every capability check in parallel. -> { status, checks, lastError }
export async function checkProvider({ admin, provider }) {
  const capabilities = capabilitiesOf(provider);
  const results = await Promise.all(
    capabilities.map(async (capability) => {
      try {
        const conn = await connectProvider({ admin, projectId: provider.project_id, providerId: provider.id, capability });
        const outcome = await CHECKS[capability](conn);
        return { capability, state: outcome?.skipped ? "skipped" : "ok" };
      } catch (err) {
        return { capability, state: "error", error: describe(err) };
      }
    }),
  );
  const checks = Object.fromEntries(results.map((r) => [r.capability, r.state]));
  const failed = results.find((r) => r.state === "error");
  const status = failed ? "error" : results.some((r) => r.state === "ok") ? "ok" : "unverified";
  const lastError = failed ? { ...failed.error, capability: failed.capability, at: new Date().toISOString() } : null;
  return { status, checks, lastError };
}

// Tests the connection and records the outcome on its row. -> the updated row (snake_case)
export async function runProviderTest({ admin, provider }) {
  const { status, checks, lastError } = await checkProvider({ admin, provider });
  const metadata = { ...(provider.metadata || {}), checks };
  if (lastError) metadata.lastError = lastError;
  else delete metadata.lastError;

  const { data, error } = await admin
    .from("model_providers")
    .update({ status, last_checked_at: new Date().toISOString(), metadata })
    .eq("id", provider.id)
    .is("deleted_at", null)
    .select("*")
    .maybeSingle();
  if (error || !data) {
    console.error("[lib/server/provider_test.update]", error?.code || "not_found");
    throw new ApiError("service_unavailable", 503, "Could not test the provider.");
  }
  return data;
}
