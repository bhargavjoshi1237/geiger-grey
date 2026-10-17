// Transcription interface (spec §4.1, §4.3, §9): resolves the project's transcription connection
// and dispatches to the driver for its wire format. connectProvider() loads the row, checks the
// capability, guards custom base URLs and reads the Vault key for this one call.
import { EngineError } from "./errors.js";
import { connectProvider, loadProvider } from "./secrets.js";
import { hasCapability, suggestedModelsFor } from "../grey/provider_kinds.js";
import { defaultOpenAITranscribeModel } from "../grey/transcript_normalize.js";
import { transcribeAssemblyAI } from "./drivers/transcribe/assemblyai.js";
import { transcribeOpenAI } from "./drivers/transcribe/openai.js";

export const NO_TRANSCRIPTION_PROVIDER =
  "Connect a transcription provider (e.g. AssemblyAI) to transcribe audio and video.";

const DRIVERS = {
  assemblyai: transcribeAssemblyAI,
  openai: transcribeOpenAI,
  openai_compatible: transcribeOpenAI,
};

// -> { provider, providerJobId, model, durationMs, language, segments: [{ startMs, endMs, speaker, text, words? }], raw }
// config: { diarize, language, tier, durationMs? } — durationMs (when known) sizes the poll timeout
// and the end time of text-only transcripts.
export async function transcribe({
  admin,
  projectId,
  providerId,
  model,
  fileUrl,
  filePath,
  config = {},
  resumeId,
  onSubmitted,
  signal,
}) {
  if (!providerId) throw new EngineError("no_provider", NO_TRANSCRIPTION_PROVIDER, { status: 422 });

  // Throws provider_not_found | capability_missing | no_key | no_base_url | unsafe_base_url.
  // `custom` (a non-default base URL) makes the driver refuse redirects and pin connections.
  const { provider, format, baseUrl, custom, apiKey } = await connectProvider({
    admin,
    projectId,
    providerId,
    capability: "transcribe",
  });
  const driver = DRIVERS[format];
  if (!driver) {
    throw new EngineError("capability_missing", `"${provider.name}" can't be used for transcription.`, { status: 422 });
  }

  const modelId = format === "assemblyai"
    ? model || null // null lets the driver pick by preset tier
    : model || defaultOpenAITranscribeModel(suggestedModelsFor(provider, "transcribe"));

  const result = await driver({
    apiKey,
    baseUrl,
    model: modelId,
    fileUrl,
    filePath,
    config,
    resumeId,
    onSubmitted,
    signal,
    custom,
  });
  return { ...result, provider: provider.provider };
}

// Project transcription connection (spec §4.3): project_settings.transcription_provider_id +
// transcription_model; when no provider is set and the project has exactly one transcribe-capable
// connection, that one. A configured provider that was removed or can't transcribe gives null
// (never a silent switch to another connection).
export async function resolveTranscriptionConnection({ admin, projectId }) {
  const { data: settings, error } = await admin
    .from("project_settings")
    .select("transcription_provider_id, transcription_model")
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    throw new EngineError("settings_unavailable", "Couldn't read the project's transcription settings.", {
      status: 503,
      retryable: true,
    });
  }
  const model = settings?.transcription_model || null;

  if (settings?.transcription_provider_id) {
    const provider = await loadProvider({ admin, projectId, providerId: settings.transcription_provider_id });
    return provider && hasCapability(provider, "transcribe") ? { providerId: provider.id, model } : null;
  }

  const { data: rows, error: listError } = await admin
    .from("model_providers")
    .select("id, provider, metadata")
    .eq("project_id", projectId)
    .is("deleted_at", null);
  if (listError) {
    throw new EngineError("settings_unavailable", "Couldn't read the project's model providers.", {
      status: 503,
      retryable: true,
    });
  }
  const capable = (rows || []).filter((row) => hasCapability(row, "transcribe"));
  return capable.length === 1 ? { providerId: capable[0].id, model } : null;
}
