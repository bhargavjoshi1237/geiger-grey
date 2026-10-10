// Lookups, option lists, and default config for the Knowledge Bases + Ingestion
// Presets screens. Config only — no row data (that lives in lib/supabase/*).

// --- Embedding models (immutable on a knowledge base once it is created) ----

export const EMBEDDING_MODELS = [
  { value: "cohere-embed-5-pro", label: "Cohere Embed v5 Pro", dims: 1024 },
  { value: "cohere-embed-5-fast", label: "Cohere Embed v5 Fast", dims: 384 },
  { value: "openai-text-embedding-3-large", label: "OpenAI text-embedding-3-large", dims: 3072 },
  { value: "voyage-3.5", label: "Voyage 3.5", dims: 1024 },
];

export const EMBEDDING_MODEL_LABEL = Object.fromEntries(
  EMBEDDING_MODELS.map((m) => [m.value, m.label]),
);

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
