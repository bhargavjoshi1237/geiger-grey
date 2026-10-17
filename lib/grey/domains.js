// Widget origin allow-list matching (spec §12.4). Pure.
//
// An allowed_domains entry is a hostname ("docs.example.com") or a wildcard
// ("*.example.com", subdomains only — never the bare domain). A page origin
// matches when its hostname equals an entry exactly or is a subdomain of a
// wildcard entry. Origins must be https, except localhost for development.
// Ports are ignored. An empty list allows nothing.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// Tolerates pasted values: "https://Example.com:8443/path" -> "example.com".
export function normalizeDomain(entry) {
  let value = String(entry ?? "").trim().toLowerCase();
  if (!value) return "";
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  value = value.split(/[/?#]/)[0];
  value = value.replace(/:\d+$/, "");
  return value.replace(/\.$/, "");
}

// -> { protocol: "https:", hostname } | null for missing, "null" or malformed origins.
export function parseOrigin(origin) {
  if (typeof origin !== "string" || !origin || origin === "null") return null;
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname) return null;
    return { protocol: url.protocol, hostname: url.hostname.toLowerCase().replace(/\.$/, "") };
  } catch {
    return null;
  }
}

export function isLocalHostname(hostname) {
  const host = String(hostname ?? "").toLowerCase();
  return LOCAL_HOSTS.has(host) || host.endsWith(".localhost");
}

// Exact match, or a "*.domain" entry matching strict subdomains of domain.
export function hostnameMatches(hostname, entry) {
  const host = String(hostname ?? "").toLowerCase();
  const domain = normalizeDomain(entry);
  if (!host || !domain) return false;
  if (domain.startsWith("*.")) {
    const base = domain.slice(2);
    return Boolean(base) && host.length > base.length + 1 && host.endsWith(`.${base}`);
  }
  return host === domain;
}

export function isOriginAllowed(origin, allowedDomains) {
  const parsed = parseOrigin(origin);
  if (!parsed) return false;
  if (parsed.protocol !== "https:" && !isLocalHostname(parsed.hostname)) return false;
  const list = Array.isArray(allowedDomains) ? allowedDomains : [];
  return list.some((entry) => hostnameMatches(parsed.hostname, entry));
}
