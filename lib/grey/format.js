import { formatDistanceToNowStrict } from "date-fns";

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"];

// null/undefined/""/non-numeric -> null; every formatter below turns that
// into the "—" placeholder.
function toFiniteNumber(n) {
  if (n === null || n === undefined || n === "") return null;
  const value = Number(n);
  return Number.isFinite(value) ? value : null;
}

// 1536 -> "1.5 KB"; 1048575 -> "1.0 MB" (rounding carries into the next unit)
export function formatBytes(n) {
  const bytes = toFiniteNumber(n);
  if (bytes === null) return "—";
  if (bytes === 0) return "0 B";

  const sign = bytes < 0 ? "-" : "";
  const abs = Math.abs(bytes);
  let exponent = Math.max(
    0,
    Math.min(BYTE_UNITS.length - 1, Math.floor(Math.log(abs) / Math.log(1024))),
  );
  let value = abs / 1024 ** exponent;
  let rounded = exponent === 0 ? Math.round(value) : Math.round(value * 10) / 10;

  // e.g. 1048575 B rounds to "1024.0 KB" at exponent 1 — bump to MB so the
  // displayed unit always matches the displayed number.
  if (rounded >= 1024 && exponent < BYTE_UNITS.length - 1) {
    exponent += 1;
    value = abs / 1024 ** exponent;
    rounded = Math.round(value * 10) / 10;
  }

  const formatted = exponent === 0 ? String(rounded) : rounded.toFixed(1);
  return `${sign}${formatted} ${BYTE_UNITS[exponent]}`;
}

// 3725000 -> "1h 02m"; 185000 -> "3m 05s"
export function formatDuration(ms) {
  const value = toFiniteNumber(ms);
  if (value === null) return "—";
  const safeSeconds = Math.max(0, Math.round(value / 1000));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  const pad = (v) => String(v).padStart(2, "0");
  if (hours > 0) return `${hours}h ${pad(minutes)}m`;
  return `${minutes}m ${pad(seconds)}s`;
}

// 850 -> "850ms"; 1240 -> "1.2s"
export function formatLatency(ms) {
  const value = toFiniteNumber(ms);
  if (value === null) return "—";
  return value < 1000 ? `${Math.round(value)}ms` : `${(value / 1000).toFixed(1)}s`;
}

const CURRENCY_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const PRECISE_CURRENCY_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

// 1234.5 -> "$1,234.50"; { precise: true } -> up to 4 dp for small per-unit costs
export function formatCurrency(n, { precise = false } = {}) {
  const value = toFiniteNumber(n);
  if (value === null) return "—";
  return (precise ? PRECISE_CURRENCY_FORMATTER : CURRENCY_FORMATTER).format(value);
}

// 1234 -> "1.2K"; 1000000 -> "1M"
export function formatNumber(n) {
  const value = toFiniteNumber(n);
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

// Retrieval score: 0.96912 -> "0.969"
export function formatScore(score) {
  return typeof score === "number" && Number.isFinite(score) ? score.toFixed(3) : "—";
}

// Past -> "3 hours ago"; future -> "in 3 hours"
export function formatRelative(date) {
  if (!date) return "—";
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "—";
  return formatDistanceToNowStrict(d, { addSuffix: true });
}
