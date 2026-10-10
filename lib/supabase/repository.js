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

// Generic CRUD over one grey table; soft deletes via deleted_at.
export function makeRepo({ table, columns, normalize = toCamel, order = "created_at", ascending = false }) {
  const tag = `[${table}`;
  return {
    async list(projectId, filters = {}) {
      if (!isSupabaseConfigured() || !projectId) return [];
      try {
        let q = createClient().from(table).select("*").eq("project_id", projectId).is("deleted_at", null);
        for (const [key, value] of Object.entries(filters)) {
          if (value === undefined || value === null || value === "all") continue;
          q = Array.isArray(value) ? q.in(snake(key), value) : q.eq(snake(key), value);
        }
        const { data, error } = await q.order(order, { ascending });
        if (error) throw error;
        return (data || []).map(normalize);
      } catch (error) {
        console.error(`${tag}.list]`, error);
        return [];
      }
    },
    async get(id) {
      if (!isSupabaseConfigured() || !id) return null;
      try {
        const { data, error } = await createClient().from(table).select("*").eq("id", id).is("deleted_at", null).maybeSingle();
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
        const { data, error } = await createClient().from(table).insert(row).select("*").single();
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
        const { data, error } = await createClient().from(table).update(toSnakeRow(patch, columns)).eq("id", id).is("deleted_at", null).select("*").single();
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
