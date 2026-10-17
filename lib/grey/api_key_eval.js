// API-key decisions for the public surfaces (spec §12.1). Pure — the route helper
// (lib/server/api_key_auth.js) does the lookup, the rate-limit RPC and the headers.

export const DEFAULT_RATE_LIMIT_PER_MIN = 60;
export const RATE_LIMIT_WINDOW_SECONDS = 60;
export const LAST_USED_TOUCH_MS = 60_000;

const KEY_RE = /^gk_live_[A-Za-z0-9]{32}$/;

const deny = (status, code, message) => ({ ok: false, status, code, message });

// "Bearer <token>" -> token; anything else (missing, other schemes, extra parts) -> null.
export function extractBearerToken(header) {
  if (typeof header !== "string") return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header.trim());
  return match ? match[1] : null;
}

// Cheap shape check so malformed tokens never reach the database.
export function isApiKeyFormat(token) {
  return typeof token === "string" && KEY_RE.test(token);
}

function timeOf(value) {
  if (value === null || value === undefined || value === "") return null;
  const t = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

// Decision for one api_keys row (snake_case). ctx:
//   scope          required scope ('retrieve' | 'chat' | 'mcp'); omitted = no scope check
//   projectId      the resource's project, when the route already knows it
//   pipelineId     the pipeline being served; must be in a non-empty pipeline_ids
//   requiredKeyId  a key the resource is bound to (MCP server / widget)
//   now            ms timestamp (tests)
// -> { ok: true } | { ok: false, status, code, message }
// Order: unknown → revoked → expired → project/pipeline (404, no existence leak) →
// bound-key mismatch → scope.
export function evaluateKey(row, ctx = {}) {
  const now = Number.isFinite(ctx.now) ? ctx.now : Date.now();
  if (!row || row.deleted_at) return deny(401, "invalid_api_key", "Invalid API key.");
  if (row.revoked_at) return deny(401, "api_key_revoked", "This API key has been revoked.");
  const expiresAt = timeOf(row.expires_at);
  if (expiresAt !== null && expiresAt <= now) return deny(401, "api_key_expired", "This API key has expired.");

  if (ctx.projectId && row.project_id !== ctx.projectId) return deny(404, "not_found", "Not found.");
  const pipelineIds = Array.isArray(row.pipeline_ids) ? row.pipeline_ids : [];
  if (ctx.pipelineId && pipelineIds.length && !pipelineIds.includes(ctx.pipelineId)) {
    return deny(404, "not_found", "Not found.");
  }

  if (ctx.requiredKeyId && row.id !== ctx.requiredKeyId) {
    return deny(403, "key_not_bound", "This API key isn't the one bound to this resource.");
  }

  const scopes = Array.isArray(row.scopes) ? row.scopes : [];
  if (ctx.scope && !scopes.includes(ctx.scope)) {
    return deny(403, "insufficient_scope", `This API key doesn't have the "${ctx.scope}" scope.`);
  }
  return { ok: true };
}

export function keyRateLimit(row) {
  const n = Number(row?.rate_limit_per_min);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_RATE_LIMIT_PER_MIN;
}

// last_used_at is written at most once per minute per key.
export function shouldTouchLastUsed(lastUsedAt, now = Date.now()) {
  const t = timeOf(lastUsedAt);
  return t === null || now - t >= LAST_USED_TOUCH_MS;
}

// grey.rate_limit_hit returns one row ({ allowed, hits, remaining, reset_at }); supabase-js
// hands back an array for set-returning functions. -> { allowed, limit, remaining, resetAt } | null
export function parseRateLimitResult(data, limit) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object" || typeof row.allowed !== "boolean") return null;
  const resetAt = timeOf(row.reset_at);
  const remaining = Number(row.remaining);
  return {
    allowed: row.allowed,
    limit,
    remaining: Number.isFinite(remaining) ? Math.max(0, remaining) : 0,
    resetAt: resetAt ?? null,
  };
}

// Whole seconds until the window resets (at least 1).
export function retryAfterSeconds(resetAt, now = Date.now()) {
  if (!Number.isFinite(resetAt)) return RATE_LIMIT_WINDOW_SECONDS;
  return Math.max(1, Math.ceil((resetAt - now) / 1000));
}

// X-RateLimit-* headers for a rate-limit decision (Reset is a Unix timestamp in seconds).
export function rateLimitHeaders(decision) {
  if (!decision) return {};
  const headers = {
    "X-RateLimit-Limit": String(decision.limit),
    "X-RateLimit-Remaining": String(decision.remaining),
  };
  if (Number.isFinite(decision.resetAt)) headers["X-RateLimit-Reset"] = String(Math.ceil(decision.resetAt / 1000));
  return headers;
}
