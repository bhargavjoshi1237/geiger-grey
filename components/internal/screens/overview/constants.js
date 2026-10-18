// Lookups for the Overview dashboard. Config only — never row data.
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  Clock,
  FileText,
  MessageCircleQuestion,
  PlugZap,
  ThumbsDown,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

// Chart inks resolve per theme through CSS vars set on WidgetShell — the same
// monochrome palette as the geiger-events overview.
export const CHART_THEME_VARS =
  "[--ov-ink:#18181b] [--ov-bg:#f9fafb] [--ov-grid:#e4e4e7] [--ov-tick:#71717a] [--ov-s2:#52525b] [--ov-s3:#a1a1aa] [--ov-s4:#d4d4d8] [--ov-s5:#e4e4e7] " +
  "dark:[--ov-ink:#ffffff] dark:[--ov-bg:#161616] dark:[--ov-grid:#2a2a2a] dark:[--ov-tick:#a3a3a3] dark:[--ov-s2:#d4d4d4] dark:[--ov-s3:#a3a3a3] dark:[--ov-s4:#737373] dark:[--ov-s5:#525252]";

export const CHART_COLORS = {
  primary: "var(--ov-ink)",
  appBackground: "var(--ov-bg)",
};

export const CHART_SERIES_COLORS = [
  "var(--ov-ink)",
  "var(--ov-s2)",
  "var(--ov-s3)",
  "var(--ov-s4)",
  "var(--ov-s5)",
];

// Weeks shown on the activity chart; request logs are loaded for this span.
export const TREND_WEEKS = 12;
// Window behind every "· 30d" figure and its "vs last period" delta.
export const PERIOD_DAYS = 30;

export const ACTIVITY_METRIC_OPTIONS = [
  { value: "queries", label: "Queries" },
  { value: "tokens", label: "Tokens" },
  { value: "latency", label: "Avg latency" },
];

export const TOP_PIPELINES_SORT_OPTIONS = [
  { value: "queries", label: "Queries" },
  { value: "answerRate", label: "Answer rate" },
];

export const TRAFFIC_TREND_META = {
  growing: { label: "Growing", icon: TrendingUp, className: "text-emerald-700 dark:text-emerald-300" },
  steady: { label: "Steady", icon: Activity, className: "text-sky-700 dark:text-sky-300" },
  declining: { label: "Declining", icon: TrendingDown, className: "text-amber-700 dark:text-amber-300" },
  idle: { label: "No traffic", icon: Clock, className: "text-text-secondary" },
};

export const URGENCY_ORDER = ["urgent", "soon", "routine"];

export const URGENCY_LABELS = { urgent: "Urgent", soon: "Soon", routine: "Routine" };

// Attention items, in display order within each urgency; `tab` is where each one is handled.
export const ATTENTION_META = {
  failedSources: { label: "Failed sources", icon: AlertTriangle, urgency: "urgent", tab: "Ingestion Jobs" },
  providerErrors: { label: "Provider connection errors", icon: PlugZap, urgency: "urgent", tab: "Model Providers" },
  unanswered: { label: "Unanswered questions", icon: MessageCircleQuestion, urgency: "soon", tab: "Feedback" },
  unhelpful: { label: "Unhelpful answers", icon: ThumbsDown, urgency: "soon", tab: "Feedback" },
  reviewDue: { label: "Sources due for review", icon: CalendarClock, urgency: "soon", tab: "Sources" },
  draftPipelines: { label: "Unpublished pipelines", icon: FileText, urgency: "routine", tab: "All Pipelines" },
};
