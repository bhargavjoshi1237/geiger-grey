// Lookups, option lists, and the freshness rule for the Sources area.
// Config only — never row data.

import {
  AudioLines,
  FileText,
  Globe,
  Image as ImageIcon,
  StickyNote,
  Video,
} from "lucide-react";

// --- Kind -------------------------------------------------------------------

export const SOURCE_KIND_ICONS = {
  document: FileText,
  audio: AudioLines,
  video: Video,
  image: ImageIcon,
  web: Globe,
  note: StickyNote,
};

export const SOURCE_KIND_LABELS = {
  document: "Document",
  audio: "Audio",
  video: "Video",
  image: "Image",
  web: "Web page",
  note: "Note",
};

export const SOURCE_KIND_FILTER_OPTIONS = [
  { value: "all", label: "All kinds" },
  ...Object.entries(SOURCE_KIND_LABELS).map(([value, label]) => ({ value, label })),
];

// --- Origin ------------------------------------------------------------------

export const SOURCE_ORIGIN_LABELS = {
  upload: "Upload",
  assets: "Assets",
  notes: "Notes",
  content: "Content",
  url: "URL",
};

export const SOURCE_ORIGIN_FILTER_OPTIONS = [
  { value: "all", label: "All origins" },
  ...Object.entries(SOURCE_ORIGIN_LABELS).map(([value, label]) => ({ value, label })),
];

// --- Status (sources.status) --------------------------------------------------

export const SOURCE_STATUS_MAP = {
  pending: { label: "Pending", variant: "neutral", dotClass: "bg-zinc-400" },
  queued: { label: "Queued", variant: "info", dotClass: "bg-sky-400" },
  processing: { label: "Processing", variant: "warning", dotClass: "bg-amber-400" },
  ready: { label: "Ready", variant: "success", dotClass: "bg-emerald-400" },
  failed: { label: "Failed", variant: "danger", dotClass: "bg-red-400" },
};

export const SOURCE_STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "queued", label: "Queued" },
  { value: "processing", label: "Processing" },
  { value: "ready", label: "Ready" },
  { value: "failed", label: "Failed" },
];

// --- Freshness (derived from verified_at / review_due_at) --------------------

export const FRESHNESS_MAP = {
  verified: { label: "Verified", variant: "success", dotClass: "bg-emerald-400" },
  review_due: { label: "Review due", variant: "warning", dotClass: "bg-amber-400" },
  stale: { label: "Stale", variant: "danger", dotClass: "bg-red-400" },
  none: { label: "Not verified", variant: "neutral", dotClass: "bg-zinc-400" },
};

// A review coming due within this window already reads as "Review due"
// instead of waiting until the date has fully passed.
const REVIEW_DUE_SOON_MS = 7 * 24 * 60 * 60 * 1000;

// "verified" | "review_due" | "stale" | "none" — never throws, always one of
// the four FRESHNESS_MAP keys.
export function freshnessOf(source) {
  if (!source) return "none";
  const reviewDueAt = source.reviewDueAt ? new Date(source.reviewDueAt).getTime() : null;
  const verifiedAt = source.verifiedAt ? new Date(source.verifiedAt).getTime() : null;
  const now = Date.now();

  // A verification performed on or after the review's due date supersedes
  // it — the source has been checked since, so "Mark verified" must
  // visibly clear a "Stale"/"Review due" badge rather than leaving it
  // behind a review date that now predates the check.
  if (verifiedAt && Number.isFinite(verifiedAt) && reviewDueAt && verifiedAt >= reviewDueAt) {
    return "verified";
  }
  if (reviewDueAt && Number.isFinite(reviewDueAt) && reviewDueAt < now) return "stale";
  if (reviewDueAt && Number.isFinite(reviewDueAt) && reviewDueAt - now <= REVIEW_DUE_SOON_MS) {
    return "review_due";
  }
  if (verifiedAt && Number.isFinite(verifiedAt)) return "verified";
  return "none";
}

// --- Ingestion jobs ------------------------------------------------------------

export const JOB_STATUS_MAP = {
  queued: { label: "Queued", variant: "info", dotClass: "bg-sky-400" },
  running: { label: "Running", variant: "warning", dotClass: "bg-amber-400" },
  succeeded: { label: "Succeeded", variant: "success", dotClass: "bg-emerald-400" },
  failed: { label: "Failed", variant: "danger", dotClass: "bg-red-400" },
  cancelled: { label: "Cancelled", variant: "neutral", dotClass: "bg-zinc-400" },
};

export const JOB_STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "queued", label: "Queued" },
  { value: "running", label: "Running" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
];

export const JOB_STAGE_LABELS = {
  parse: "Parse",
  chunk: "Chunk",
  embed: "Embed",
  graph: "Graph",
};

// --- Formatting helpers --------------------------------------------------------

export function describeSourceSize(source, { formatBytes, formatDuration } = {}) {
  if (!source) return "—";
  if ((source.kind === "audio" || source.kind === "video") && source.durationMs) {
    return formatDuration ? formatDuration(source.durationMs) : `${source.durationMs}ms`;
  }
  if (source.pageCount) {
    return `${source.pageCount.toLocaleString("en-US")} ${source.pageCount === 1 ? "page" : "pages"}`;
  }
  if (source.bytes) return formatBytes ? formatBytes(source.bytes) : `${source.bytes}B`;
  return "—";
}

export function sourceRef(id) {
  return id ? String(id).replace(/-/g, "").slice(0, 8).toUpperCase() : "—";
}

// A job's `preset_snapshot` keeps the tier and name alongside the config so
// the Ingestion Jobs table can show "preset tier" without re-joining
// ingestion_presets (the preset may since have been edited or deleted).
export function snapshotPreset(preset) {
  if (!preset) return {};
  return { id: preset.id, name: preset.name, tier: preset.tier, config: preset.config ?? {} };
}

// The one queued-job shape used by every entry point (upload, import, add
// URL, re-ingest) — keeps `presetSnapshot`/`stage`/`progress` consistent
// without repeating the literal at each call site.
export function buildQueuedJob({ kbId, sourceId, preset, estimatedCost = null }) {
  return {
    kbId,
    sourceId,
    presetSnapshot: snapshotPreset(preset),
    status: "queued",
    stage: "parse",
    progress: 0,
    estimatedCost,
  };
}
