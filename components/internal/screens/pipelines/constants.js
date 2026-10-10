// Pipelines + Model Providers constants (spec §2.4, §3). Verbatim per the task brief.

export const PROVIDERS = [
  { value: "openai", label: "OpenAI", models: ["gpt-5", "gpt-5-mini"] },
  {
    value: "anthropic",
    label: "Anthropic",
    models: ["claude-opus-5-5", "claude-sonnet-5", "claude-haiku-4-5-20251001"],
  },
  { value: "google", label: "Google", models: ["gemini-3-pro", "gemini-3-flash"] },
  { value: "openrouter", label: "OpenRouter", needsBaseUrl: false },
  { value: "openai_compatible", label: "OpenAI-compatible", needsBaseUrl: true },
];

export const DEFAULT_RETRIEVAL = {
  topK: 6,
  rerank: true,
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

function providerLabel(value) {
  return PROVIDERS.find((p) => p.value === value)?.label || value;
}

export { providerLabel };
