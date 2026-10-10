// Shared maps/options for the graph screens (Graph Explorer, Entities, Ontology).

export const SOURCE_APP_MAP = {
  grey: { label: "Grey", variant: "info" },
  forms: { label: "Forms", variant: "purple" },
  manual: { label: "Manual", variant: "neutral" },
};

// Chart token names available for ontology type colour chips (§2.3: color is a chart-1..5 token).
export const CHART_COLOR_OPTIONS = ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5"];

export function confidenceLabel(confidence) {
  if (confidence === null || confidence === undefined) return "—";
  return `${Math.round(Number(confidence) * 100)}%`;
}
