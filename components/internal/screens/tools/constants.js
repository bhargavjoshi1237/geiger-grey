// Tools screens: status, template icons, option lists and the copy for run/test codes.
// Config only — never row data.
import { Images, MessageSquareQuote, ScanSearch, Tags } from "lucide-react";

import { TEMPLATE_INFO } from "@/lib/grey/tool_spec";

export const TOOL_STATUS_MAP = {
  draft: { label: "Draft", variant: "neutral" },
  live: { label: "Live", variant: "success" },
};

// TEMPLATE_INFO[t].icon holds a lucide name; these are the components.
const ICONS_BY_NAME = { Images, MessageSquareQuote, Tags };

export function templateIcon(template) {
  return ICONS_BY_NAME[TEMPLATE_INFO[template]?.icon] || ScanSearch;
}

export const templateLabel = (template) => TEMPLATE_INFO[template]?.label || "Tool";

export const INPUT_MODE_TABS = [
  { value: "required", label: "Required" },
  { value: "optional", label: "Optional" },
  { value: "off", label: "Off" },
];

export const MODALITY_TABS = [
  { value: "any", label: "Any item" },
  { value: "image", label: "Images" },
  { value: "text", label: "Text" },
];

export const CLASSIFY_MODE_TABS = [
  { value: "auto", label: "Auto" },
  { value: "knn", label: "Nearest examples" },
  { value: "llm", label: "Model" },
];

export const CLASSIFY_MODE_HINTS = {
  auto: "The nearest labelled items vote; the model decides only when the vote is too close.",
  knn: "The nearest labelled items vote. No model calls — fast and free, but needs labelled examples.",
  llm: "The model always decides, with the nearest labelled items as evidence.",
};

export const DECIDED_BY_LABELS = {
  knn: "Decided by nearest examples",
  llm: "Decided by the model",
};

export const UNCERTAIN_REASONS = {
  no_labeled_neighbors: "None of the similar items carry one of this tool's labels.",
  low_margin: "The vote between the top labels was too close to call.",
};

// Fallback copy for run errors — routes send their own message, which wins.
export const RUN_ERROR_MESSAGES = {
  image_required: "Add an image.",
  text_required: "Enter some text.",
  input_required: "Add an image or enter text.",
  text_too_long: "That text is too long for this tool.",
  text_not_accepted: "This tool doesn't take text input.",
  image_not_accepted: "This tool doesn't take an image.",
  invalid_input: "The input couldn't be read.",
  invalid_image: "This image couldn't be read.",
  unsupported_image_type: "Use a JPEG, PNG or WebP image.",
  image_too_large: "The image is too large.",
  image_dimensions_too_large: "The image is too large.",
  image_query_unsupported: "This tool's knowledge bases can't search by image.",
  tool_scope_empty: "This tool has no active knowledge bases to search. Choose one in Configure.",
  tool_not_found: "This tool no longer exists.",
  tool_not_live: "This tool isn't published yet.",
  tool_version_not_found: "That version of the tool no longer exists.",
  tool_run_limit: "This tool reached its monthly run limit.",
  rate_limited: "Too many runs at once. Wait a moment and try again.",
  forbidden: "You don't have permission to run this tool.",
  service_unavailable: "The service is unavailable right now. Try again shortly.",
  network_error: "Couldn't reach the server. Check your connection and try again.",
};

export function runErrorMessage(error, message) {
  if (message) return message;
  return RUN_ERROR_MESSAGES[error] || "The tool couldn't run. Try again.";
}

// Fallback copy for result warnings — the runtime attaches its own message, which wins.
export const WARNING_MESSAGES = {
  empty_query: "Add an image or enter text to search with.",
  image_query_unsupported: "This tool's knowledge bases can't search by image.",
  image_query_partial: "Some knowledge bases can't search by image.",
  search_degraded: "Similarity search was unavailable for some knowledge bases, so the results may be incomplete.",
  llm_skipped_cap: "The monthly budget is reached, so the model step was skipped.",
  llm_unavailable: "No model is available for this tool.",
  llm_invalid_output: "The model's answer couldn't be used.",
  llm_failed: "The model call failed.",
  answer_truncated: "The answer reached this tool's length limit and was cut off.",
};

export const warningMessage = (warning) => warning?.message || WARNING_MESSAGES[warning?.code] || "Something didn't go as planned.";

export const TEST_SKIPPED_MESSAGES = {
  not_enough_labelled_items: "Label at least 3 items in Sources to test this tool.",
  no_automatic_tests: "Answer tools have no automatic tests yet — try it with real questions.",
};

export const testSkippedMessage = (reason) => TEST_SKIPPED_MESSAGES[reason] || "The tests couldn't run.";

// 0.8421 -> "84%"; null -> "—"
export function formatPercent(value, { digits = 0 } = {}) {
  const n = Number(value);
  if (value === null || value === undefined || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

// One line for a saved test report: "84% accuracy · 92% coverage on 25 items".
export function describeTestReport(report) {
  if (!report) return null;
  if (report.skippedReason) return testSkippedMessage(report.skippedReason);
  const r = report.report || {};
  const cases = report.cases ?? r.total ?? 0;
  const on = `on ${cases.toLocaleString("en-US")} item${cases === 1 ? "" : "s"}`;
  if (report.kind === "classification") {
    return `${formatPercent(r.accuracy)} accuracy · ${formatPercent(r.coverage)} coverage ${on}`;
  }
  if (report.kind === "retrieval") {
    const mrr = Number.isFinite(Number(r.mrr)) && r.mrr !== null ? Number(r.mrr).toFixed(2) : "—";
    return `${formatPercent(r.hitAtK)} hit rate · MRR ${mrr} ${on}`;
  }
  return null;
}
