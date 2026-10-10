import {
  UserPlus,
  ShieldCheck,
  Activity,
  UserMinus,
  UsersRound,
  Ban,
  Sparkles,
} from "lucide-react";

export { PERMISSION_GROUPS, ALL_PERMISSION_KEYS } from "@/lib/rbac";

// Lookups & formatters for the Settings area (Team & Members, Roles &
// Permissions). Config only — no row data. Status/type maps feed StatusPill;
// filter options seed the toolbar; formatters are imported, never re-inlined.

// --- Member status ---------------------------------------------------------

export const MEMBER_STATUS_MAP = {
  active: { label: "Active", variant: "success", dotClass: "bg-emerald-400" },
  invited: { label: "Invited", variant: "info", dotClass: "bg-sky-400" },
  suspended: { label: "Suspended", variant: "danger", dotClass: "bg-red-400" },
};

export const MEMBER_STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "active", label: "Active" },
  { value: "invited", label: "Invited" },
  { value: "suspended", label: "Suspended" },
];

// --- Activity feed ---------------------------------------------------------

export const ACTIVITY_ACTION_MAP = {
  invited: { label: "invited", icon: UserPlus, tone: "text-sky-600 dark:text-sky-400" },
  role_changed: { label: "changed the role of", icon: ShieldCheck, tone: "text-violet-600 dark:text-violet-300" },
  status_changed: { label: "updated the status of", icon: Activity, tone: "text-amber-600 dark:text-amber-400" },
  suspended: { label: "suspended", icon: Ban, tone: "text-red-600 dark:text-red-400" },
  removed: { label: "removed", icon: UserMinus, tone: "text-red-600 dark:text-red-400" },
  group_changed: { label: "updated groups for", icon: UsersRound, tone: "text-emerald-600 dark:text-emerald-400" },
  role_created: { label: "created role", icon: Sparkles, tone: "text-violet-600 dark:text-violet-300" },
  role_updated: { label: "updated role", icon: ShieldCheck, tone: "text-violet-600 dark:text-violet-300" },
  role_deleted: { label: "deleted role", icon: UserMinus, tone: "text-red-600 dark:text-red-400" },
  group_created: { label: "created group", icon: UsersRound, tone: "text-emerald-600 dark:text-emerald-400" },
};

// --- Seats -----------------------------------------------------------------

// Default seat allowance until Billing wires a real plan limit (read from
// project metadata `seatLimit` when present).
export const DEFAULT_SEAT_LIMIT = 25;

// --- Formatters ------------------------------------------------------------

export function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatRelativeTime(value) {
  if (!value) return "Never";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Never";
  const diff = Date.now() - d.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(value);
}

export function initialsOf(name, email) {
  const src = (name || email || "?").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}
