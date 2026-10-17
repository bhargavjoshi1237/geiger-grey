import { createClient } from "./client";
import { isSupabaseConfigured } from "./config";

const camel = (k) => k.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
const snake = (k) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

export function toCamel(row) {
  if (!row) return null;
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [camel(k), v]));
}

export function toSnakeRow(input, columns) {
  const out = {};
  for (const key of columns) if (input[key] !== undefined) out[snake(key)] = input[key];
  return out;
}

// list() pages through PostgREST in PAGE_SIZE steps (its default max-rows, so a single request would
// silently stop at 1000) up to MAX_ROWS, a safety cap that warns when hit.
const PAGE_SIZE = 1000;
const MAX_ROWS = 20000;

// Generic CRUD over one grey table; soft deletes via deleted_at. `select` narrows what reads return.
export function makeRepo({ table, columns, normalize = toCamel, order = "created_at", ascending = false, select = "*" }) {
  const tag = `[${table}`;
  return {
    async list(projectId, filters = {}) {
      if (!isSupabaseConfigured() || !projectId) return [];
      try {
        const sb = createClient();
        // Query builders are single-use, so each page builds its own. id breaks ties in `order`
        // so offset paging is deterministic.
        const pageQuery = (from) => {
          let q = sb.from(table).select(select).eq("project_id", projectId).is("deleted_at", null);
          for (const [key, value] of Object.entries(filters)) {
            if (value === undefined || value === null || value === "all") continue;
            q = Array.isArray(value) ? q.in(snake(key), value) : q.eq(snake(key), value);
          }
          q = q.order(order, { ascending });
          if (order !== "id") q = q.order("id", { ascending });
          return q.range(from, from + PAGE_SIZE - 1);
        };

        const rows = [];
        const seen = new Set();
        for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
          const { data, error } = await pageQuery(from);
          if (error) throw error;
          for (const row of data || []) {
            // A row inserted mid-listing shifts later pages by one; skip the repeat it causes.
            if (seen.has(row.id)) continue;
            seen.add(row.id);
            rows.push(row);
          }
          if (!data || data.length < PAGE_SIZE) return rows.map(normalize);
        }
        console.warn(`${tag}.list] stopped at the ${MAX_ROWS}-row cap; results may be truncated`);
        return rows.map(normalize);
      } catch (error) {
        console.error(`${tag}.list]`, error);
        return [];
      }
    },
    async get(id) {
      if (!isSupabaseConfigured() || !id) return null;
      try {
        const { data, error } = await createClient().from(table).select(select).eq("id", id).is("deleted_at", null).maybeSingle();
        if (error) throw error;
        return data ? normalize(data) : null;
      } catch (error) {
        console.error(`${tag}.get]`, error);
        return null;
      }
    },
    async create(projectId, input) {
      if (!isSupabaseConfigured() || !projectId) return null;
      try {
        const row = { ...toSnakeRow(input, ["id", ...columns]), project_id: projectId };
        const { data, error } = await createClient().from(table).insert(row).select(select).single();
        if (error) throw error;
        return normalize(data);
      } catch (error) {
        console.error(`${tag}.create]`, error);
        return null;
      }
    },
    async update(id, patch) {
      if (!isSupabaseConfigured() || !id) return null;
      try {
        const { data, error } = await createClient().from(table).update(toSnakeRow(patch, columns)).eq("id", id).is("deleted_at", null).select(select).single();
        if (error) throw error;
        return normalize(data);
      } catch (error) {
        console.error(`${tag}.update]`, error);
        return null;
      }
    },
    async remove(id) {
      if (!isSupabaseConfigured() || !id) return false;
      try {
        const { error } = await createClient().from(table).update({ deleted_at: new Date().toISOString() }).eq("id", id);
        if (error) throw error;
        return true;
      } catch (error) {
        console.error(`${tag}.remove]`, error);
        return false;
      }
    },
  };
}
