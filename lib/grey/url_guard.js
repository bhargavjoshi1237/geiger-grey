// SSRF guard (spec §6.1, §14) for URL sources and custom provider base URLs.
// The address and URL checks are pure; DNS resolution and fetch are injectable
// (`lookup`, `fetch`) and default to Node's resolver / global fetch.
//
// These checks run before the request, and the request resolves the host again, so
// callers reaching user-supplied hosts also connect through lib/engine/net.js, which
// re-applies resolvedAddressesArePublic() at connect time (no DNS-rebinding window).
// Redirects are re-checked per hop (guardedFetch) or refused (provider calls).

export class UrlGuardError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "UrlGuardError";
    this.code = code;
  }
}

const MESSAGES = {
  invalid_url: "That isn't a valid URL.",
  unsupported_scheme: "Only http and https URLs are supported.",
  https_required: "Use an https URL.",
  credentials_in_url: "URLs can't include a username or password.",
  blocked_host: "This address points to a private network and can't be used.",
  private_address: "This address points to a private network and can't be used.",
  dns_failed: "Couldn't resolve this URL's host.",
  too_many_redirects: "The URL redirected too many times.",
};

const fail = (code) => {
  throw new UrlGuardError(code, MESSAGES[code]);
};

// --- IP parsing --------------------------------------------------------------

function parseIPv4(text) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n <= 255) ? parts : null;
}

// -> 8 16-bit groups, or null.
function parseIPv6(text) {
  let s = String(text).toLowerCase();
  const zone = s.indexOf("%");
  if (zone !== -1) s = s.slice(0, zone);
  if (!s.includes(":")) return null;
  // A trailing dotted IPv4 (::ffff:1.2.3.4) becomes the last two groups.
  let tail = [];
  const lastColon = s.lastIndexOf(":");
  const v4 = parseIPv4(s.slice(lastColon + 1));
  if (v4) {
    tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
    s = s.slice(0, lastColon + 1);
    if (!s.endsWith("::")) s = s.slice(0, -1);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const toGroups = (part) => (part ? part.split(":") : []);
  const head = toGroups(halves[0]);
  const rest = halves.length === 2 ? toGroups(halves[1]) : [];
  const valid = (g) => /^[0-9a-f]{1,4}$/.test(g);
  if (![...head, ...rest].every(valid)) return null;
  const explicit = head.length + rest.length + tail.length;
  if (halves.length === 1 && explicit !== 8) return null;
  if (halves.length === 2 && explicit > 7) return null;
  const zeros = halves.length === 2 ? Array(8 - explicit).fill(0) : [];
  return [...head.map((g) => parseInt(g, 16)), ...zeros, ...rest.map((g) => parseInt(g, 16)), ...tail];
}

function v4InRange(parts, base, bits) {
  const toInt = (p) => ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((toInt(parts) & mask) >>> 0) === ((toInt(base) & mask) >>> 0);
}

const PRIVATE_V4 = [
  [[0, 0, 0, 0], 8], // "this" network
  [[10, 0, 0, 0], 8],
  [[100, 64, 0, 0], 10], // carrier-grade NAT
  [[127, 0, 0, 0], 8], // loopback
  [[169, 254, 0, 0], 16], // link-local (cloud metadata)
  [[172, 16, 0, 0], 12],
  [[192, 0, 0, 0], 24],
  [[192, 0, 2, 0], 24],
  [[192, 88, 99, 0], 24],
  [[192, 168, 0, 0], 16],
  [[198, 18, 0, 0], 15],
  [[198, 51, 100, 0], 24],
  [[203, 0, 113, 0], 24],
  [[224, 0, 0, 0], 4], // multicast
  [[240, 0, 0, 0], 4], // reserved + broadcast
];

function isPrivateV4(parts) {
  return PRIVATE_V4.some(([base, bits]) => v4InRange(parts, base, bits));
}

function embeddedV4(groups, hi, lo) {
  return [groups[hi] >> 8, groups[hi] & 255, groups[lo] >> 8, groups[lo] & 255];
}

function isPrivateV6(g) {
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return isPrivateV4(embeddedV4(g, 6, 7)); // ::ffff:a.b.c.d (mapped)
  if (g.slice(0, 4).every((x) => x === 0) && g[4] === 0xffff && g[5] === 0) return isPrivateV4(embeddedV4(g, 6, 7)); // ::ffff:0:a.b.c.d (translated)
  if (g.slice(0, 6).every((x) => x === 0)) return isPrivateV4(embeddedV4(g, 6, 7)); // ::a.b.c.d (deprecated)
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPrivateV4(embeddedV4(g, 6, 7)); // NAT64
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return true; // 64:ff9b:1::/48 local-use NAT64
  if (g[0] === 0x2002) return isPrivateV4(embeddedV4(g, 1, 2)); // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return true; // 2001::/32 Teredo (embedded address is obfuscated)
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x0100 && g.slice(1, 4).every((x) => x === 0)) return true; // discard
  return false;
}

export function isIpAddress(text) {
  const s = stripBrackets(text);
  return Boolean(parseIPv4(s) || parseIPv6(s));
}

// True for loopback, private, link-local, CGNAT, multicast, reserved and
// documentation ranges (IPv4, IPv6, and IPv4 embedded in IPv6).
export function isPrivateAddress(text) {
  const s = stripBrackets(text);
  const v4 = parseIPv4(s);
  if (v4) return isPrivateV4(v4);
  const v6 = parseIPv6(s);
  if (v6) return isPrivateV6(v6);
  return true; // unparseable addresses are never trusted
}

function stripBrackets(text) {
  return String(text || "").replace(/^\[|\]$/g, "");
}

// The connect-time decision (lib/engine/net.js) for one DNS answer: every address must be
// public — a single private entry rejects the lot, so a mixed record can't be raced.
// addresses: [{ address }] | [string] (dns.lookup with { all: true }). -> boolean
export function resolvedAddressesArePublic(addresses) {
  const list = (Array.isArray(addresses) ? addresses : [addresses]).map((a) => (typeof a === "string" ? a : a?.address));
  return list.length > 0 && list.every((a) => a && !isPrivateAddress(a));
}

// Local / private provider base URLs (Ollama, vLLM, LM Studio on localhost or a LAN) are
// allowed only under `next dev` (NODE_ENV=development) or with GREY_ALLOW_LOCAL_PROVIDERS=1
// (a single-tenant self-hosted deployment). Everything else — production, test, an unset
// NODE_ENV (e.g. the worker) — is strict. URL sources are always strict. Pass process.env.
export function localProvidersAllowed(env = {}) {
  return env?.NODE_ENV === "development" || env?.GREY_ALLOW_LOCAL_PROVIDERS === "1";
}

// --- hostnames and URLs --------------------------------------------------------

export function isBlockedHostname(hostname) {
  const host = stripBrackets(hostname).toLowerCase().replace(/\.$/, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".internal") || host.endsWith(".local") || host.endsWith(".localdomain")) return true;
  if (isIpAddress(host)) return isPrivateAddress(host);
  return false;
}

// Synchronous shape checks. `allowLocal` (dev only) skips the private-network rules.
export function checkUrl(raw, { allowHttp = true, allowLocal = false } = {}) {
  let url;
  try {
    url = raw instanceof URL ? new URL(raw.href) : new URL(String(raw || "").trim());
  } catch {
    fail("invalid_url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") fail("unsupported_scheme");
  if (url.protocol === "http:" && !allowHttp) fail("https_required");
  if (url.username || url.password) fail("credentials_in_url");
  if (!allowLocal && isBlockedHostname(url.hostname)) fail("blocked_host");
  return url;
}

async function defaultLookup(hostname) {
  const { lookup } = await import("node:dns/promises");
  return lookup(hostname, { all: true, verbatim: true });
}

// Shape checks, then every resolved address must be public.
// `lookup(hostname)` -> [{ address }] (Node's dns.promises.lookup with { all: true }).
export async function assertPublicUrl(raw, { allowHttp = true, allowLocal = false, lookup = defaultLookup } = {}) {
  const url = checkUrl(raw, { allowHttp, allowLocal });
  if (allowLocal) return url;
  const host = stripBrackets(url.hostname);
  if (isIpAddress(host)) return url; // literal IPs were checked in checkUrl
  let addresses;
  try {
    addresses = await lookup(host);
  } catch {
    fail("dns_failed");
  }
  const list = (Array.isArray(addresses) ? addresses : [addresses]).map((a) => (typeof a === "string" ? a : a?.address));
  if (!list.length || list.some((a) => !a)) fail("dns_failed");
  if (!resolvedAddressesArePublic(list)) fail("private_address");
  return url;
}

// Provider base URLs: https and public, unless `allowLocal` (see localProvidersAllowed)
// also admits http://localhost-style servers. -> normalized URL string.
export async function assertPublicBaseUrl(raw, { allowLocal = false, lookup } = {}) {
  const url = await assertPublicUrl(raw, { allowHttp: allowLocal, allowLocal, lookup });
  return url.href.replace(/\/+$/, "");
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

// fetch() that re-checks every redirect hop (max `maxRedirects`).
export async function guardedFetch(raw, init = {}, { fetch: fetchImpl = globalThis.fetch, lookup, maxRedirects = 5, allowHttp = true, allowLocal = false } = {}) {
  let current = raw;
  let request = { ...init };
  for (let hop = 0; ; hop++) {
    const url = await assertPublicUrl(current, { allowHttp, allowLocal, lookup });
    const res = await fetchImpl(url.href, { ...request, redirect: "manual" });
    const location = res.headers?.get?.("location");
    if (!REDIRECTS.has(res.status) || !location) return res;
    if (hop >= maxRedirects) fail("too_many_redirects");
    await res.body?.cancel?.().catch(() => {});
    current = new URL(location, url);
    const method = String(request.method || "GET").toUpperCase();
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
      request = { ...request, method: "GET", body: undefined };
    }
  }
}
