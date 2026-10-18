// Provider-connection registry (spec §4.1). Pure: no I/O. A connection is a
// grey.model_providers row (snake_case from the engine, camelCase from the UI —
// both share `provider` and `metadata`). Its kind decides which capabilities it
// offers and which driver (wire format) serves each one.

import { SUGGESTED_EMBEDDING_MODELS } from "./embedding_models.js";

export const CAPABILITIES = ["chat", "embed", "rerank", "transcribe"];

export const CAPABILITY_LABELS = {
  chat: "Chat",
  embed: "Embeddings",
  rerank: "Rerank",
  transcribe: "Transcription",
};

// Grey-run connections are switched off until Grey's own accounts exist (spec §4.4).
export const GREY_HOSTED_ENABLED = false;
export const GREY_HOSTED_ID = "grey-hosted";

// Hosted aliases resolve to these models once GREY_HOSTED_ENABLED is turned on.
export const HOSTED_MODEL_ALIASES = {
  "grey-fast": "claude-haiku-5-5",
  "grey-balanced": "claude-sonnet-5-5",
  "grey-deep": "claude-opus-5-5",
};

// Embedding suggestions come from embedding_models.js so ids and dims live in one place.
const embedSuggestions = (format, ids) =>
  SUGGESTED_EMBEDDING_MODELS[format]
    .filter((m) => !ids || ids.includes(m.id))
    .map((m) => ({ id: m.id, label: m.label, dims: m.nativeDims }));

const ANTHROPIC_CHAT = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
];

export const PROVIDER_KINDS = {
  openai: {
    label: "OpenAI",
    capabilities: ["chat", "embed", "transcribe"],
    formats: { chat: "openai", embed: "openai", transcribe: "openai" },
    baseUrl: "https://api.openai.com/v1",
    baseUrlMode: "editable",
    suggestedModels: {
      chat: [
        { id: "gpt-5", label: "GPT-5" },
        { id: "gpt-5-mini", label: "GPT-5 mini" },
      ],
      embed: embedSuggestions("openai", ["text-embedding-3-large", "text-embedding-3-small"]),
      // whisper-1 first: gpt-4o-transcribe returns no segment timestamps, so
      // citations from its transcripts can't deep-link into the media.
      transcribe: [
        { id: "whisper-1", label: "Whisper" },
        { id: "gpt-4o-transcribe", label: "GPT-4o Transcribe (no timestamps)" },
      ],
    },
  },
  anthropic: {
    label: "Anthropic",
    capabilities: ["chat"],
    formats: { chat: "anthropic" },
    baseUrl: "https://api.anthropic.com/v1",
    baseUrlMode: "editable",
    suggestedModels: { chat: ANTHROPIC_CHAT },
  },
  google: {
    label: "Google",
    capabilities: ["chat", "embed"],
    formats: { chat: "google", embed: "google" },
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    baseUrlMode: "fixed",
    suggestedModels: {
      chat: [
        { id: "gemini-3-pro", label: "Gemini 3 Pro" },
        { id: "gemini-3-flash", label: "Gemini 3 Flash" },
      ],
      embed: embedSuggestions("google"),
    },
  },
  openrouter: {
    label: "OpenRouter",
    capabilities: ["chat"],
    formats: { chat: "openai_compatible" },
    baseUrl: "https://openrouter.ai/api/v1",
    baseUrlMode: "fixed",
    suggestedModels: {},
  },
  openai_compatible: {
    label: "OpenAI-compatible",
    // The user picks a subset of these; stored in metadata.capabilities.
    capabilities: "user",
    userCapabilities: ["chat", "embed", "transcribe"],
    formats: { chat: "openai_compatible", embed: "openai", transcribe: "openai" },
    baseUrl: null,
    baseUrlMode: "required",
    suggestedModels: {},
  },
  cohere: {
    label: "Cohere",
    capabilities: ["embed", "rerank"],
    formats: { embed: "cohere", rerank: "cohere" },
    baseUrl: "https://api.cohere.com",
    baseUrlMode: "editable",
    suggestedModels: {
      embed: embedSuggestions("cohere"),
      // Rerank 4 ids per Cohere's 2025 release notes — free-form ids are accepted too.
      rerank: [
        { id: "rerank-v4.0-pro", label: "Rerank 4 Pro" },
        { id: "rerank-v4.0-fast", label: "Rerank 4 Fast" },
        { id: "rerank-v3.5", label: "Rerank 3.5" },
      ],
    },
  },
  voyage: {
    label: "Voyage AI",
    capabilities: ["embed", "rerank"],
    formats: { embed: "voyage", rerank: "voyage" },
    baseUrl: "https://api.voyageai.com/v1",
    baseUrlMode: "fixed",
    suggestedModels: {
      embed: embedSuggestions("voyage"),
      rerank: [
        { id: "rerank-2.5", label: "Rerank 2.5" },
        { id: "rerank-2.5-lite", label: "Rerank 2.5 Lite" },
      ],
    },
  },
  nomic: {
    label: "Nomic",
    capabilities: ["embed"],
    formats: { embed: "nomic" },
    baseUrl: "https://api-atlas.nomic.ai/v1",
    baseUrlMode: "fixed",
    suggestedModels: { embed: embedSuggestions("nomic") },
  },
  assemblyai: {
    label: "AssemblyAI",
    capabilities: ["transcribe"],
    formats: { transcribe: "assemblyai" },
    baseUrl: "https://api.assemblyai.com",
    baseUrlMode: "fixed",
    // An empty model lets the driver pick per ingestion tier (spec §9.1).
    defaultModelLabel: { transcribe: "Auto (by preset tier)" },
    suggestedModels: {
      transcribe: [
        { id: "universal-2", label: "Universal-2" },
        { id: "universal-3-5-pro", label: "Universal 3.5 Pro" },
      ],
    },
  },
  grey_hosted: {
    label: "Grey hosted",
    capabilities: [],
    formats: {},
    baseUrl: null,
    baseUrlMode: "fixed",
    suggestedModels: {},
    reserved: true,
  },
};

// UI templates that prefill a connection; each is stored as one of the kinds above
// with metadata.preset = id and metadata.capabilities = capabilities.
export const PROVIDER_PRESETS = [
  {
    id: "groq",
    label: "Groq",
    kind: "openai_compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    capabilities: ["chat", "transcribe"],
    suggestedModels: {
      chat: [{ id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B" }],
      transcribe: [{ id: "whisper-large-v3-turbo", label: "Whisper Large v3 Turbo" }],
    },
  },
  { id: "together", label: "Together AI", kind: "openai_compatible", baseUrl: "https://api.together.xyz/v1", capabilities: ["chat", "embed"] },
  { id: "fireworks", label: "Fireworks", kind: "openai_compatible", baseUrl: "https://api.fireworks.ai/inference/v1", capabilities: ["chat", "embed"] },
  {
    id: "mistral",
    label: "Mistral",
    kind: "openai_compatible",
    baseUrl: "https://api.mistral.ai/v1",
    capabilities: ["chat", "embed"],
    suggestedModels: {
      chat: [{ id: "mistral-large-latest", label: "Mistral Large" }],
      embed: embedSuggestions("openai", ["mistral-embed"]),
    },
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    kind: "openai_compatible",
    baseUrl: "https://api.deepseek.com/v1",
    capabilities: ["chat"],
    suggestedModels: { chat: [{ id: "deepseek-chat", label: "DeepSeek Chat" }] },
  },
  {
    id: "xai",
    label: "xAI",
    kind: "openai_compatible",
    baseUrl: "https://api.x.ai/v1",
    capabilities: ["chat"],
    suggestedModels: { chat: [{ id: "grok-4", label: "Grok 4" }] },
  },
  {
    id: "ollama",
    label: "Ollama",
    kind: "openai_compatible",
    baseUrl: "http://localhost:11434/v1",
    capabilities: ["chat", "embed"],
    suggestedModels: { embed: embedSuggestions("openai", ["nomic-embed-text"]) },
  },
  { id: "vllm", label: "vLLM", kind: "openai_compatible", baseUrl: "http://localhost:8000/v1", capabilities: ["chat", "embed"] },
  { id: "lmstudio", label: "LM Studio", kind: "openai_compatible", baseUrl: "http://localhost:1234/v1", capabilities: ["chat", "embed"] },
  {
    id: "jina",
    label: "Jina AI (rerank)",
    kind: "cohere",
    baseUrl: "https://api.jina.ai/v1",
    capabilities: ["rerank"],
    suggestedModels: { rerank: [{ id: "jina-reranker-v2-base-multilingual", label: "Jina Reranker v2" }] },
  },
];

const PRESETS_BY_ID = Object.fromEntries(PROVIDER_PRESETS.map((p) => [p.id, p]));

export function kindOf(providerRow) {
  return PROVIDER_KINDS[providerRow?.provider] || null;
}

export function presetOf(providerRow) {
  const id = providerRow?.metadata?.preset;
  return (id && PRESETS_BY_ID[id]) || null;
}

function storedCapabilities(providerRow) {
  const list = providerRow?.metadata?.capabilities;
  return Array.isArray(list) ? list.filter((c) => CAPABILITIES.includes(c)) : null;
}

// openai_compatible reads metadata.capabilities (default ['chat']); fixed kinds
// return their own list, narrowed by metadata.capabilities when a preset stored
// one (e.g. Jina is a cohere-format connection that only reranks).
export function capabilitiesOf(providerRow) {
  const kind = kindOf(providerRow);
  if (!kind) return [];
  const stored = storedCapabilities(providerRow);
  if (kind.capabilities === "user") {
    const picked = (stored || []).filter((c) => kind.userCapabilities.includes(c));
    return picked.length ? picked : ["chat"];
  }
  if (stored?.length) {
    const narrowed = kind.capabilities.filter((c) => stored.includes(c));
    if (narrowed.length) return narrowed;
  }
  return [...kind.capabilities];
}

export function hasCapability(providerRow, capability) {
  return capabilitiesOf(providerRow).includes(capability);
}

// -> 'openai'|'anthropic'|'google'|'openai_compatible'|'cohere'|'voyage'|'nomic'|'assemblyai'|null
export function driverFormat(providerRow, capability) {
  if (!hasCapability(providerRow, capability)) return null;
  return kindOf(providerRow)?.formats?.[capability] || null;
}

// The base URL a connection actually calls: fixed kinds ignore the stored value,
// editable kinds fall back to the kind default, required kinds use only the stored one.
export function resolveBaseUrl(providerRow) {
  const kind = kindOf(providerRow);
  if (!kind) return null;
  const stored = String(providerRow?.base_url ?? providerRow?.baseUrl ?? "").trim();
  const value = kind.baseUrlMode === "fixed" ? kind.baseUrl : stored || kind.baseUrl;
  return value ? value.replace(/\/+$/, "") : null;
}

// True when the connection calls somewhere other than its kind's default URL
// (custom URLs pass the SSRF guard before any request is made).
export function hasCustomBaseUrl(providerRow) {
  const kind = kindOf(providerRow);
  const url = resolveBaseUrl(providerRow);
  if (!kind || !url) return false;
  return !kind.baseUrl || url !== kind.baseUrl.replace(/\/+$/, "");
}

// Local servers (Ollama, vLLM, LM Studio) often run without auth.
export function keyRequired(providerRow) {
  return providerRow?.provider !== "openai_compatible";
}

// Preset suggestions first, then the kind's own (the kind's only when the
// connection still calls the kind's default URL, since a custom server may not
// serve the vendor's model ids).
export function suggestedModelsFor(providerRow, capability) {
  const kind = kindOf(providerRow);
  if (!kind || !hasCapability(providerRow, capability)) return [];
  const fromPreset = presetOf(providerRow)?.suggestedModels?.[capability] || [];
  const fromKind = hasCustomBaseUrl(providerRow) ? [] : kind.suggestedModels?.[capability] || [];
  const seen = new Set();
  return [...fromPreset, ...fromKind].filter((m) => (seen.has(m.id) ? false : seen.add(m.id)));
}

export function providerKindLabel(kind, presetId) {
  return PRESETS_BY_ID[presetId]?.label || PROVIDER_KINDS[kind]?.label || kind || "";
}
