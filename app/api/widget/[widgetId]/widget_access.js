// Shared gate for the public widget routes (spec §12.4): origin allow-list + CORS, widget
// enabled, pipeline set, and the bound API key as a server-side kill switch (never sent to
// the browser). Colocated with the routes; not itself routable.
import { createHash } from "node:crypto";
import { isUuid } from "@/lib/server/auth";
import { ApiError } from "@/lib/server/errors";
import { apiError, assertWithinLimit, loadApiKey, rateLimitHit, requireAdmin } from "@/lib/server/api_key_auth";
import { VARY_ORIGIN, allowedCorsHeaders, requestOrigin } from "@/lib/server/cors";
import { isEngineError } from "@/lib/engine/errors";
import { evaluateKey } from "@/lib/grey/api_key_eval";

const WIDGET_COLUMNS = "id,project_id,name,pipeline_id,api_key_id,allowed_domains,theme,white_label,status";

export const sha256 = (value) => createHash("sha256").update(value).digest("hex");

// Visitor-facing messages: configuration and provider details are for the project owner only.
const UNAVAILABLE = "This assistant isn't available right now.";
const FAILED = "The assistant couldn't answer right now. Please try again.";

export function widgetError(error, headers) {
  if (error instanceof ApiError) return Object.assign(error, { headers: { ...headers, ...(error.headers || {}) } });
  if (isEngineError(error)) {
    if (error.code === "aborted") return apiError("aborted", 499, "The request was cancelled.", headers);
    const status = Number(error.status) || 500;
    if (status === 409 || status === 422 || status === 404) return apiError(error.code, 409, UNAVAILABLE, headers);
    return apiError(error.code, status >= 500 ? status : 502, FAILED, headers);
  }
  console.error("[api.widget]", error);
  return apiError("internal_error", 500, FAILED, headers);
}

// The visitor's address, used only as a rate-limit key (never for authorisation). Assumes the
// platform proxy writes these headers and drops client-supplied copies: on Vercel (VERCEL=1)
// x-vercel-forwarded-for, then x-real-ip; elsewhere x-real-ip, else the first x-forwarded-for
// hop — right when the one proxy in front overwrites that header (as Vercel does); behind
// proxies that append instead, set x-real-ip there.
export function clientIp(request, env = process.env) {
  const first = (name) => request.headers.get(name)?.split(",")[0]?.trim() || "";
  return (env.VERCEL ? first("x-vercel-forwarded-for") : "") || first("x-real-ip") || first("x-forwarded-for") || "unknown";
}

// One hit on a widget rate-limit bucket. Anonymous traffic fails closed: when the limiter
// itself can't answer (rateLimitHit -> null) the request is refused, whereas keyed API routes
// fail open. -> the decision (for X-RateLimit-* headers)
export async function widgetRateLimit({ admin, bucket, limit, cors }) {
  const decision = await rateLimitHit({ admin, bucket, limit });
  if (!decision) throw apiError("service_unavailable", 503, UNAVAILABLE, { ...cors, "Retry-After": "30" });
  assertWithinLimit(decision, cors);
  return decision;
}

async function loadWidget(admin, widgetId) {
  const { data, error } = await admin.from("widgets").select(WIDGET_COLUMNS).eq("id", widgetId).is("deleted_at", null).maybeSingle();
  if (error) {
    console.error("[api.widget.load]", error.message);
    throw apiError("service_unavailable", 503, "The service is unavailable.", VARY_ORIGIN);
  }
  return data;
}

// -> { admin, widget, origin, cors, key }. Throws ApiError with the right headers: no CORS
// headers for a disallowed origin (the browser blocks the response), CORS headers otherwise
// so the widget can read the reason.
export async function widgetAccess(request, widgetId, { methods } = {}) {
  const admin = requireAdmin();
  const origin = requestOrigin(request);
  if (!origin) throw apiError("domain_not_allowed", 403, "This page isn't allowed to use this widget.", VARY_ORIGIN);
  if (!isUuid(widgetId)) throw apiError("not_found", 404, "Widget not found.", VARY_ORIGIN);

  const widget = await loadWidget(admin, widgetId);
  if (!widget) throw apiError("not_found", 404, "Widget not found.", VARY_ORIGIN);
  const cors = allowedCorsHeaders(origin, widget.allowed_domains, { methods });
  if (!cors) throw apiError("domain_not_allowed", 403, "This page isn't allowed to use this widget.", VARY_ORIGIN);

  if (widget.status === "disabled") throw apiError("widget_disabled", 403, "This widget is turned off.", cors);
  if (!widget.pipeline_id) throw apiError("widget_unavailable", 409, UNAVAILABLE, cors);

  let key = null;
  if (widget.api_key_id) {
    key = await loadApiKey(admin, { id: widget.api_key_id });
    const decision = evaluateKey(key, { projectId: widget.project_id, pipelineId: widget.pipeline_id });
    if (!decision.ok) throw apiError("widget_unavailable", 403, UNAVAILABLE, cors);
  }
  return { admin, widget, origin, cors, key };
}

// OPTIONS preflight: allowed origins get the CORS headers, everything else a bare 403.
export async function widgetPreflight(request, widgetId, methods) {
  const origin = requestOrigin(request);
  if (!origin || !isUuid(widgetId)) return new Response(null, { status: 403, headers: VARY_ORIGIN });
  const admin = requireAdmin();
  const widget = await loadWidget(admin, widgetId);
  const cors = widget ? allowedCorsHeaders(origin, widget.allowed_domains, { methods }) : null;
  return cors ? new Response(null, { status: 204, headers: cors }) : new Response(null, { status: 403, headers: VARY_ORIGIN });
}

const COLOR_RE = /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla|oklch|oklab)\([0-9.,%\s/+-]{1,60}\))$/i;
const text = (value, max, fallback = "") => (typeof value === "string" ? value.trim().slice(0, max) : fallback);

// Public appearance only — no ids beyond the widget's own, no key, no pipeline config.
export function publicWidgetConfig(widget) {
  const theme = widget.theme && typeof widget.theme === "object" ? widget.theme : {};
  const accent = text(theme.accent, 80);
  return {
    id: widget.id,
    title: text(theme.title, 80),
    greeting: text(theme.greeting, 500),
    placeholder: text(theme.placeholder, 120),
    position: theme.position === "left" ? "left" : "right",
    accent: COLOR_RE.test(accent) ? accent : "",
    whiteLabel: Boolean(widget.white_label),
  };
}
