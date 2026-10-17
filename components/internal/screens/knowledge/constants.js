// Lookups, option lists, and default config for the Knowledge Bases + Ingestion
// Presets screens. Config only — no row data (that lives in lib/supabase/*).

import {
  LEGACY_EMBEDDING_MODELS,
  SUGGESTED_EMBEDDING_MODELS,
  embeddingModelLabel,
} from "@/lib/grey/embedding_models";

// --- Embedding models (immutable on a knowledge base once it is created) ----
// The KB stores the provider's raw model id; dimensions come from Detect, so no
// dims are listed here. Older KBs may hold a legacy Grey key (see embedding_models.js).

export const EMBEDDING_MODEL_LABEL = Object.fromEntries(
  [
    ...Object.values(SUGGESTED_EMBEDDING_MODELS).flat().map((m) => m.id),
    ...Object.keys(LEGACY_EMBEDDING_MODELS),
  ].map((id) => [id, embeddingModelLabel(id)]),
);

// Messages for /api/embeddings/detect error codes (apiFetch surfaces only the code).
export const EMBEDDING_ERROR_MESSAGES = {
  provider_auth: "The provider rejected the API key — update it in Model Providers.",
  model_not_found: "This provider doesn't serve that model id.",
  bad_request: "The provider rejected the request — check the model id.",
  rate_limited: "The provider is rate limiting requests — try again shortly.",
  provider_unavailable: "The provider is unavailable right now — try again shortly.",
  timeout: "The provider took too long to respond.",
  no_key: "Add an API key for this connection in Model Providers.",
  capability_missing: "This connection can't create embeddings for that model.",
  provider_not_found: "That connection no longer exists.",
  unsafe_base_url: "This connection's base URL can't be used.",
  unsupported_dims: "This model's vectors are outside the supported 64–4000 dimensions.",
  forbidden: "You don't have permission to manage knowledge bases.",
};

// --- Status maps (StatusPill styling) ----------------------------------------

export const KB_STATUS_MAP = {
  active: { label: "Active", variant: "success", dotClass: "bg-emerald-400" },
  archived: { label: "Archived", variant: "neutral", dotClass: "bg-text-tertiary" },
};

export const JOB_STATUS_MAP = {
  queued: { label: "Queued", variant: "neutral", dotClass: "bg-text-tertiary" },
  running: { label: "Running", variant: "info", dotClass: "bg-sky-400" },
  succeeded: { label: "Succeeded", variant: "success", dotClass: "bg-emerald-400" },
  failed: { label: "Failed", variant: "danger", dotClass: "bg-red-400" },
  cancelled: { label: "Cancelled", variant: "outline", dotClass: "bg-text-tertiary" },
};

// --- Preset tier metadata (card copy in PresetPicker) -----------------------

export const PRESET_TIER_META = {
  fast: { label: "Fast", description: "Cheapest and quickest — plain text extraction, no OCR." },
  balanced: { label: "Balanced", description: "Good accuracy for most documents. Default choice." },
  high: { label: "High accuracy", description: "Layout- and vision-aware parsing for complex documents." },
  auto: { label: "Auto", description: "Routes each file to the right tier automatically." },
  custom: { label: "Custom", description: "Your own ingestion settings." },
};

export const TIER_LABEL = Object.fromEntries(
  Object.entries(PRESET_TIER_META).map(([tier, meta]) => [tier, meta.label]),
);

// --- Ingestion settings form option lists -------------------------------------

export const PARSER_OPTIONS = [
  { value: "text", label: "Text" },
  { value: "layout", label: "Layout" },
  { value: "vlm", label: "Vision (VLM)" },
  { value: "auto", label: "Auto" },
];

export const CHUNK_STRATEGY_OPTIONS = [
  { value: "recursive", label: "Recursive" },
  { value: "fixed", label: "Fixed size" },
  { value: "semantic", label: "Semantic" },
  { value: "page", label: "Page" },
];

// --- Default preset config ----------------------------------------------------
// Mirrors grey.ingestion_presets' "Balanced" seed row exactly (see
// supabase/migrations/*_ingestion.sql): layout parser with OCR, diarized media
// transcription, graph extraction on, contextual enrichment off, at
// $0.006/page, $0.006/media minute, $0.04/keyframe minute, $0.50/M graph
// tokens, $1.02/M contextual-enrichment tokens.

export const DEFAULT_PRESET_CONFIG = {
  parser: "layout",
  ocr: true,
  chunking: {
    strategy: "recursive",
    size: 512,
    overlap: 64,
    atomicTables: true,
    headingBreadcrumbs: true,
  },
  enrichment: {
    contextual: false,
    parentChild: false,
  },
  media: {
    transcribe: true,
    diarize: true,
    keyframes: false,
    windowSeconds: 45,
  },
  graph: {
    extract: true,
  },
  prices: {
    perPage: 0.006,
    perMediaMinute: 0.006,
    perKeyframeMinute: 0.04,
    perMillionTokensGraph: 0.5,
    perMillionTokensContextual: 1.02,
  },
};
