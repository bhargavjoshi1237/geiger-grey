// Snake->camel key mapper for route handler responses (top-level keys only).
// Mirrors lib/supabase/repository.js toCamel, duplicated here so server code never
// imports the browser-facing repository/client module chain.
const camel = (k) => k.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

export function toCamel(row) {
  if (!row) return null;
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [camel(k), v]));
}
