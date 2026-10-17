// CORS for the public widget routes (spec §12.4): only allow-listed origins are echoed,
// never "*", never credentials; Vary: Origin on every response so caches keep them apart.
import { isOriginAllowed } from "@/lib/grey/domains";

const ALLOW_HEADERS = "Content-Type";
const MAX_AGE_SECONDS = "600";

export const VARY_ORIGIN = { Vary: "Origin" };

export function requestOrigin(request) {
  return request.headers.get("origin") || null;
}

// Headers for an origin already checked against the widget's allowed_domains.
export function corsHeaders(origin, { methods = "GET, POST, OPTIONS" } = {}) {
  return {
    ...VARY_ORIGIN,
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers": ALLOW_HEADERS,
    "Access-Control-Max-Age": MAX_AGE_SECONDS,
  };
}

// -> CORS headers when `origin` is allowed, else null.
export function allowedCorsHeaders(origin, allowedDomains, options) {
  return origin && isOriginAllowed(origin, allowedDomains) ? corsHeaders(origin, options) : null;
}

export function preflightResponse(headers) {
  return headers
    ? new Response(null, { status: 204, headers })
    : new Response(null, { status: 403, headers: VARY_ORIGIN });
}
