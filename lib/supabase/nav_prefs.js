"use client";

import { createClient } from "./client";
import { isSupabaseConfigured } from "./config";

// Data access for public.user_nav_prefs — the sidebar entries a user has hidden.
// Suite-wide table (owned by geiger-dash, shared `public` schema, no deleted_at), keyed by (product, surface, project_id, user_id) so every Geiger app shares one row per user without colliding on titles like "Overview".
// createClient() defaults to the `grey` schema, so every call here re-scopes to `public` explicitly.
// Which titles may be hidden is declared in geiger-ui.config.js and enforced by @geiger/ui — never here.
// DB is snake_case, the UI is camelCase; map at this boundary. Pure: validate, console.error on failure, return null/false — never throw, never toast.

const TABLE = "user_nav_prefs";
const PRODUCT = "grey";
const SURFACE = "workspace";

function publicClient() {
  return createClient().schema("public");
}

export function normalizeNavPrefs(row) {
  if (!row) return null;
  return {
    id: row.id,
    product: row.product ?? PRODUCT,
    surface: row.surface ?? SURFACE,
    projectId: row.project_id ?? null,
    userId: row.user_id ?? null,
    hidden: Array.isArray(row.hidden) ? row.hidden.filter((t) => typeof t === "string") : [],
  };
}

export async function getNavPrefs(projectId, userId = null) {
  if (!projectId || !isSupabaseConfigured()) return null;
  try {
    let query = publicClient()
      .from(TABLE)
      .select("*")
      .eq("product", PRODUCT)
      .eq("surface", SURFACE)
      .eq("project_id", projectId);
    query = userId ? query.eq("user_id", userId) : query.is("user_id", null);

    const { data, error } = await query.maybeSingle();
    if (error) {
      console.error("[nav_prefs.get]", error.message);
      return null;
    }
    if (!data) {
      return {
        id: null,
        product: PRODUCT,
        surface: SURFACE,
        projectId,
        userId: userId ?? null,
        hidden: [],
      };
    }
    return normalizeNavPrefs(data);
  } catch (e) {
    console.error("[nav_prefs.get]", e);
    return null;
  }
}

// Create-or-update this user's single row (whole hidden list at once — it's small, no benefit to a partial patch). Upserts on the (product, surface, project_id, user_id) unique constraint; no soft delete, so clearing means storing an empty `hidden` array.
export async function saveNavPrefs(projectId, userId, hidden) {
  if (!projectId || !isSupabaseConfigured()) return false;
  try {
    const { error } = await publicClient().from(TABLE).upsert(
      {
        product: PRODUCT,
        surface: SURFACE,
        project_id: projectId,
        user_id: userId || null,
        hidden: Array.isArray(hidden) ? hidden : [],
        created_by: userId || null,
      },
      { onConflict: "product,surface,project_id,user_id" },
    );
    if (error) {
      console.error("[nav_prefs.save]", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[nav_prefs.save]", e);
    return false;
  }
}
