// Pipelines + Model Providers constants (spec §2.4, §3; provider registry §4.1).
import {
  PROVIDER_KINDS,
  PROVIDER_PRESETS,
  providerKindLabel,
} from "@/lib/grey/provider_kinds";

// Provider dialog templates, built from the driver registry: every kind a user can
// connect (Grey hosted is reserved), then presets that prefill one of those kinds.
// `value` is the select value; `kind` is what's stored in model_providers.provider.
export const PROVIDERS = [
  ...Object.entries(PROVIDER_KINDS)
    .filter(([, kind]) => !kind.reserved)
    .map(([value, kind]) => ({
      value,
      kind: value,
      preset: null,
      label: kind.label,
      capabilities: kind.capabilities === "user" ? ["chat"] : kind.capabilities,
      baseUrl: kind.baseUrl,
      baseUrlMode: kind.baseUrlMode,
      models: (kind.suggestedModels.chat || []).map((m) => m.id),
    })),
  ...PROVIDER_PRESETS.map((preset) => ({
    value: `preset:${preset.id}`,
    kind: preset.kind,
    preset: preset.id,
    label: preset.label,
    capabilities: preset.capabilities,
    baseUrl: preset.baseUrl,
    baseUrlMode: PROVIDER_KINDS[preset.kind].baseUrlMode,
    models: (preset.suggestedModels?.chat || []).map((m) => m.id),
  })),
];

export const DEFAULT_RETRIEVAL = {
  topK: 6,
  // Off for new pipelines: reranking needs a rerank-capable connection (spec §4.3).
  rerank: false,
  hybrid: true,
  threshold: 0.2,
  graphMode: "auto",
  citations: true,
};

export const PIPELINE_STATUS_MAP = {
  draft: { label: "Draft", variant: "neutral" },
  live: { label: "Live", variant: "success" },
};

// Not in the brief's verbatim block but needed by both screens — kept here so
// status/graph-mode vocabulary lives in one place per the list recipe.
export const PROVIDER_STATUS_MAP = {
  unverified: { label: "Unverified", variant: "neutral" },
  ok: { label: "Connected", variant: "success" },
  error: { label: "Error", variant: "danger" },
};

export const GRAPH_MODE_TABS = [
  { value: "off", label: "Off" },
  { value: "auto", label: "Auto" },
  { value: "always", label: "Always" },
];

// Kind label, or the preset's when the connection was made from one ("Groq").
function providerLabel(value, presetId) {
  return providerKindLabel(value, presetId);
}

export { providerLabel };
