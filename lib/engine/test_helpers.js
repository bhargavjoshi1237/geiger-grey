// Test doubles for engine modules: a minimal service-role Supabase client and a
// scripted global fetch. Used only by lib/engine/*.test.js.

export const PROJECT = "11111111-1111-4111-8111-111111111111";
export const OTHER_PROJECT = "22222222-2222-4222-8222-222222222222";

export const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// tables: { model_providers: [rows], project_settings: [rows] }; secrets: { [providerId]: key }
export function fakeAdmin({ tables = {}, secrets = {} } = {}) {
  return {
    rpc: async (name, params) => {
      if (name !== "get_provider_secret") return { data: null, error: { code: "42883" } };
      const row = (tables.model_providers || []).find(
        (r) => r.id === params.p_provider && r.project_id === params.p_project && !r.deleted_at,
      );
      return { data: row ? secrets[row.id] ?? null : null, error: null };
    },
    from(table) {
      const filters = [];
      const query = {
        select: () => query,
        eq: (col, value) => (filters.push((r) => r[col] === value), query),
        is: (col, value) => (filters.push((r) => (r[col] ?? null) === value), query),
        maybeSingle: async () => ({
          data: (tables[table] || []).find((r) => filters.every((f) => f(r))) || null,
          error: null,
        }),
      };
      return query;
    },
  };
}

// handler(url, init, callIndex) -> Response | Promise<Response>. Returns { calls, restore }.
export function stubFetch(handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const call = { url: String(url), init, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    return handler(call.url, init, calls.length - 1, call);
  };
  return { calls, restore: () => (globalThis.fetch = original) };
}

export const jsonResponse = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

export const provider = (id, kind, extra = {}) => ({
  id: uuid(id),
  project_id: PROJECT,
  name: `${kind} connection`,
  provider: kind,
  base_url: null,
  models: [],
  metadata: {},
  deleted_at: null,
  ...extra,
});
