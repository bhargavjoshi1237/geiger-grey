// Lookups for the Usage area (Usage & Costs, Request Logs). Config only — no
// row data. Status/kind maps feed StatusPill and the cost chart; filter
// options seed the toolbars.

// --- Request status ---------------------------------------------------------

export const REQUEST_STATUS_MAP = {
  ok: { label: "OK", variant: "success", dotClass: "bg-emerald-400" },
  error: { label: "Error", variant: "danger", dotClass: "bg-red-400" },
  stub: { label: "Stub", variant: "info", dotClass: "bg-sky-400" },
};

export const REQUEST_STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "ok", label: "OK" },
  { value: "error", label: "Error" },
  { value: "stub", label: "Stub" },
];

// --- Channel ------------------------------------------------------------

export const CHANNEL_LABELS = {
  playground: "Playground",
  widget: "Widget",
  api: "API",
  mcp: "MCP",
};

export const CHANNEL_FILTER_OPTIONS = [
  { value: "all", label: "All Channels" },
  { value: "playground", label: "Playground" },
  { value: "widget", label: "Widget" },
  { value: "api", label: "API" },
  { value: "mcp", label: "MCP" },
];

// --- Usage event kinds (daily cost chart, breakdown table) -----------------

// Chart tokens come from CSS vars (--chart-1..5); defined here so the chart,
// legend and breakdown table all key off the same list and order.
export const USAGE_KIND_META = [
  { key: "page", label: "Pages ingested", color: "var(--chart-1)" },
  { key: "media_minute", label: "Media minutes", color: "var(--chart-2)" },
  { key: "retrieval", label: "Retrievals", color: "var(--chart-3)" },
  { key: "llm_tokens", label: "LLM tokens", color: "var(--chart-4)" },
  { key: "graph_tokens", label: "Graph extraction", color: "var(--chart-5)" },
  { key: "contextual_tokens", label: "Contextual enrichment", color: "var(--chart-1)" },
  { key: "storage_gb", label: "Storage", color: "var(--chart-2)" },
];

export const USAGE_KIND_LABELS = Object.fromEntries(
  USAGE_KIND_META.map((k) => [k.key, k.label]),
);

// --- Soft cap ----------------------------------------------------------------

export const CAP_BEHAVIOR_OPTIONS = [
  { value: "alert", label: "Alert only" },
  { value: "retrieval_only", label: "Pause ingestion, keep retrieval" },
  { value: "pause_ingestion", label: "Pause ingestion" },
];

export const CAP_BEHAVIOR_HINT = {
  alert: "Keeps running and only notifies the alert emails below.",
  retrieval_only: "Stops new ingestion jobs; chat and retrieval keep working.",
  pause_ingestion: "Stops new ingestion jobs once the cap is reached.",
};
