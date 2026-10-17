// API-key authentication + rate limiting for the public surfaces (spec §12.1): v1 routes
// and MCP servers authenticate with `Authorization: Bearer gk_live_…`; widgets use their
// bound key server-side only. Decisions live in the pure lib/grey/api_key_eval.js.
import { after } from "next/server";
import { adminClient } from "@/lib/supabase/admin";
import { hashApiKey } from "@/lib/grey/api_keys";
import {
  RATE_LIMIT_WINDOW_SECONDS,
  evaluateKey,
  extractBearerToken,
  isApiKeyFormat,
  keyRateLimit,
  parseRateLimitResult,
  rateLimitHeaders,
  retryAfterSeconds,
  shouldTouchLastUsed,
} from "@/lib/grey/api_key_eval";
import { ApiError, json } from "./errors.js";

const KEY_COLUMNS =
  "id,project_id,name,prefix,scopes,pipeline_ids,rate_limit_per_min,last_used_at,expires_at,revoked_at,deleted_at";
const WWW_AUTHENTICATE = { "WWW-Authenticate": 'Bearer realm="grey"' };

// ApiError carrying response headers (WWW-Authenticate, Retry-After, X-RateLimit-*).
export function apiError(code, status, message, headers = {}) {
  return Object.assign(new ApiError(code, status, message), { headers });
}

export function requireAdmin() {
  const admin = adminClient();
  if (!admin) throw apiError("service_unavailable", 503, "The service is unavailable.");
  return admin;
}

// handle() for the public JSON routes: ApiError -> { error, message } + its headers.
export function handleApi(fn) {
  return async (request, ctx) => {
    try {
      return await fn(request, ctx);
    } catch (error) {
      if (error instanceof ApiError) {
        return Response.json({ error: error.code, message: error.message }, { status: error.status, headers: error.headers });
      }
      console.error("[lib/server/api_key_auth.handleApi]", error);
      return json({ error: "internal_error", message: "Something went wrong." }, 500);
    }
  };
}

// One hit on a fixed one-minute window (grey.rate_limit_hit).
// -> { allowed, limit, remaining, resetAt } | null when the check itself failed (fails open).
export async function rateLimitHit({ admin, bucket, limit, windowSeconds = RATE_LIMIT_WINDOW_SECONDS }) {
  try {
    const { data, error } = await admin.rpc("rate_limit_hit", {
      p_bucket: bucket,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) throw error;
    return parseRateLimitResult(data, limit);
  } catch (error) {
    console.error("[lib/server/api_key_auth.rateLimitHit]", error?.message || error);
    return null;
  }
}

// Throws 429 rate_limited (with Retry-After) when the decision is over the limit.
export function assertWithinLimit(decision, extraHeaders = {}) {
  if (!decision || decision.allowed) return;
  const retryAfter = retryAfterSeconds(decision.resetAt);
  throw apiError("rate_limited", 429, `Rate limit exceeded — retry in ${retryAfter}s.`, {
    ...extraHeaders,
    ...rateLimitHeaders(decision),
    "Retry-After": String(retryAfter),
  });
}

async function touchLastUsed(admin, keyId) {
  const { error } = await admin.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", keyId);
  if (error) console.error("[lib/server/api_key_auth.touchLastUsed]", error.message);
}

export async function loadApiKey(admin, filter) {
  let query = admin.from("api_keys").select(KEY_COLUMNS).is("deleted_at", null);
  for (const [column, value] of Object.entries(filter)) query = query.eq(column, value);
  const { data, error } = await query.maybeSingle();
  if (error) {
    console.error("[lib/server/api_key_auth.loadApiKey]", error.message);
    throw apiError("service_unavailable", 503, "The service is unavailable.");
  }
  return data;
}

// Bearer key -> { admin, key, projectId, rateLimit, headers }. `headers` (X-RateLimit-*) belong
// on every response. Options: scope, projectId, pipelineId, requiredKeyId (see evaluateKey).
export async function authenticateApiKey(request, { scope, projectId, pipelineId, requiredKeyId, admin: given } = {}) {
  const admin = given || requireAdmin();
  const token = extractBearerToken(request.headers.get("authorization"));
  if (!token || !isApiKeyFormat(token)) {
    throw apiError("invalid_api_key", 401, "Missing or invalid API key.", WWW_AUTHENTICATE);
  }

  const key = await loadApiKey(admin, { key_hash: hashApiKey(token) });
  const decision = evaluateKey(key, { scope, projectId, pipelineId, requiredKeyId });
  if (!decision.ok) {
    throw apiError(decision.code, decision.status, decision.message, decision.status === 401 ? WWW_AUTHENTICATE : {});
  }

  const rateLimit = await rateLimitHit({ admin, bucket: `key:${key.id}`, limit: keyRateLimit(key) });
  assertWithinLimit(rateLimit);

  if (shouldTouchLastUsed(key.last_used_at)) after(() => touchLastUsed(admin, key.id));

  return { admin, key, projectId: key.project_id, rateLimit, headers: rateLimitHeaders(rateLimit) };
}
