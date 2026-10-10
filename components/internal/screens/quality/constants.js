// Lookups, option lists, and formatters for the Quality area (Evaluations,
// Feedback). Config and pure helpers only — never row data.

// --- Formatters ----------------------------------------------------------

export const formatDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
};

export const formatDateTime = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

export const truncate = (text, length = 120) => {
  const s = (text || "").trim();
  if (!s) return "—";
  return s.length > length ? `${s.slice(0, length).trim()}…` : s;
};

// A metric in eval_runs.metrics is 0..1 or null/undefined before a run has
// actually scored (always true in this phase — the backend stays queued).
export const formatMetric = (value) =>
  typeof value === "number" && Number.isFinite(value) ? `${Math.round(value * 100)}%` : "—";

// --- Eval run status -------------------------------------------------------

export const EVAL_RUN_STATUS_MAP = {
  queued: { label: "Queued", variant: "neutral", dotClass: "bg-[#737373]" },
  running: { label: "Running", variant: "info", dotClass: "bg-sky-400" },
  completed: { label: "Completed", variant: "success", dotClass: "bg-emerald-400" },
  failed: { label: "Failed", variant: "danger", dotClass: "bg-red-400" },
};

export const EVAL_RUN_STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "queued", label: "Queued" },
  { value: "running", label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
];

// --- Evaluations tabs --------------------------------------------------------

export const EVAL_TABS = [
  { value: "sets", label: "Sets" },
  { value: "runs", label: "Runs" },
];

// --- Feedback tabs -----------------------------------------------------------

export const FEEDBACK_TABS = [
  { value: "negative", label: "Negative" },
  { value: "unanswered", label: "Unanswered" },
  { value: "all", label: "All" },
];

export const isResolved = (message) => Boolean(message?.metadata?.resolved);

export const matchesFeedbackTab = (message, tab) => {
  if (tab === "all") return true;
  if (isResolved(message)) return false;
  if (tab === "negative") return message.feedback === "down";
  if (tab === "unanswered") return Boolean(message.unanswered);
  return true;
};

// --- Conversation helpers ----------------------------------------------------

// `messages` is a conversation's full thread, ascending by createdAt (as
// returned by listMessages). Finds the user turn immediately before the given
// assistant message — the question that produced it.
export function findPreviousUserMessage(messages, assistantMessageId) {
  const list = messages || [];
  const idx = list.findIndex((m) => m.id === assistantMessageId);
  if (idx === -1) return null;
  for (let i = idx - 1; i >= 0; i -= 1) {
    if (list[i].role === "user") return list[i];
  }
  return null;
}

// Dedupe source ids cited by an assistant message, for prefilling
// eval_cases.expected_source_ids.
export function citationSourceIds(citations) {
  if (!Array.isArray(citations)) return [];
  const ids = citations.map((c) => c?.sourceId).filter(Boolean);
  return [...new Set(ids)];
}
