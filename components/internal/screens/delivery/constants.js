// Status maps, option lists and small formatters shared by the Delivery screens
// (API Keys, MCP Servers, Widgets).
import { formatRelative } from "@/lib/grey/format";

export const API_KEY_STATUS_MAP = {
  active: { label: "Active", variant: "success" },
  revoked: { label: "Revoked", variant: "danger" },
  expired: { label: "Expired", variant: "warning" },
};

export const MCP_STATUS_MAP = {
  enabled: { label: "Enabled", variant: "success" },
  disabled: { label: "Disabled", variant: "neutral" },
};

export const WIDGET_STATUS_MAP = {
  enabled: { label: "Enabled", variant: "success" },
  disabled: { label: "Disabled", variant: "neutral" },
};

export const SCOPE_OPTIONS = [
  { value: "retrieve", label: "Retrieve", description: "Query chunks directly via the retrieval endpoint." },
  { value: "chat", label: "Chat", description: "Run pipeline chat completions." },
  { value: "mcp", label: "MCP", description: "Serve an MCP server authenticated with this key." },
];

export const MCP_TOOL_DEFS = [
  { key: "search", label: "search", description: "Semantic search over the server's knowledge bases." },
  { key: "ask", label: "ask", description: "Ask a question through the server's pipeline." },
  { key: "get_entity", label: "get_entity", description: "Look up a knowledge graph entity by name or id." },
  { key: "list_sources", label: "list_sources", description: "List sources available to this server." },
];

export const DEFAULT_MCP_TOOLS = { search: true, ask: true, get_entity: false, list_sources: false };

export const WIDGET_POSITION_TABS = [
  { label: "Left", value: "left" },
  { label: "Right", value: "right" },
];

export const DEFAULT_WIDGET_THEME = {
  position: "right",
  accent: "",
  title: "Chat with us",
  greeting: "Hi! Ask me anything about this knowledge base.",
  placeholder: "Type your question…",
};

// Derives a display status for an API key from its revoked/expiry timestamps —
// the row itself only stores `revokedAt`/`expiresAt`, never a status column.
export function computeApiKeyStatus(key) {
  if (key?.revokedAt) return "revoked";
  if (key?.expiresAt && new Date(key.expiresAt).getTime() < Date.now()) return "expired";
  return "active";
}

export function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function lastUsedLabel(value) {
  if (!value) return "Never";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Never";
  return formatRelative(d);
}

// RFC-1123-ish hostname check: dotted labels of letters/digits/hyphens (no
// leading/trailing hyphen), an optional leading wildcard label, or "localhost".
const HOSTNAME_RE =
  /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$|^localhost$/i;

export function isValidHostname(value) {
  return HOSTNAME_RE.test(String(value || "").trim());
}
