import { formatDistanceToNowStrict } from "date-fns";

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"];

// 1536 -> "1.5 KB"
export function formatBytes(n) {
  const bytes = Number(n);
  if (!Number.isFinite(bytes)) return "—";
  if (bytes === 0) return "0 B";
  const exponent = Math.min(
    BYTE_UNITS.length - 1,
    Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024)),
  );
  const value = bytes / 1024 ** exponent;
  const formatted = exponent === 0 ? String(bytes) : value.toFixed(value < 10 ? 1 : 0);
  return `${formatted} ${BYTE_UNITS[exponent]}`;
}

// 3725000 -> "1h 02m"; 185000 -> "3m 05s"
export function formatDuration(ms) {
  const totalSeconds = Math.round(Number(ms) / 1000);
  if (!Number.isFinite(totalSeconds)) return "—";
  const safeSeconds = Math.max(0, totalSeconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  const pad = (v) => String(v).padStart(2, "0");
  if (hours > 0) return `${hours}h ${pad(minutes)}m`;
  return `${minutes}m ${pad(seconds)}s`;
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
  const value = Number(n);
  if (!Number.isFinite(value)) return "—";
  return (precise ? PRECISE_CURRENCY_FORMATTER : CURRENCY_FORMATTER).format(value);
}

// 1234 -> "1.2K"; 1000000 -> "1M"
export function formatNumber(n) {
  const value = Number(n);
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

// Date -> "3 hours ago"
export function formatRelative(date) {
  if (!date) return "—";
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "—";
  return `${formatDistanceToNowStrict(d)} ago`;
}
