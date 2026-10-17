// Best-effort reads of other suite products' schemas, for Grey's "import from Assets/Notes" pickers.
// assets.assets and notes.project_boards are owned and migrated by their own products, not Grey — we
// only read what their RLS already exposes to the signed-in member. Returns [] on any failure (schema
// not exposed to PostgREST, table renamed, RLS denies, product not provisioned, etc.) — never throws.
import { createClient } from "./client";
import { isSupabaseConfigured } from "./config";

// assets.assets.type -> grey.sources.kind. Types Grey can't ingest (3d, raw, archive) aren't offered.
const ASSET_TYPE_TO_KIND = {
  document: "document",
  pdf: "document",
  image: "image",
  audio: "audio",
  video: "video",
};

// assets.assets rows this project owns whose file is stored (Grey fetches the bytes through Assets'
// internal read-url route), as lightweight pickable items. `kind` comes from assets.type; `mime` is
// the stored file's real MIME type (assets.format is a display label like "MP4", not a MIME type).
export async function listImportableAssets(projectId) {
  if (!isSupabaseConfigured() || !projectId) return [];
  try {
    const { data, error } = await createClient()
      .schema("assets")
      .from("assets")
      .select("id, name, type, mime_type, size_bytes, storage_key, storage_status, thumbnail_url")
      .eq("project_id", projectId)
      .eq("storage_status", "stored")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data || [])
      .filter((row) => row.storage_key && ASSET_TYPE_TO_KIND[row.type])
      .map((row) => ({
        id: row.id,
        name: row.name,
        kind: ASSET_TYPE_TO_KIND[row.type],
        mime: row.mime_type || null,
        bytes: row.size_bytes ?? null,
        url: row.thumbnail_url || null,
      }));
  } catch (error) {
    console.error("[suite_imports.listImportableAssets]", error);
    return [];
  }
}

// notes.project_boards rows this project owns, as lightweight pickable items.
export async function listImportableNotes(projectId) {
  if (!isSupabaseConfigured() || !projectId) return [];
  try {
    const { data, error } = await createClient()
      .schema("notes")
      .from("project_boards")
      .select("id, name, updated_at")
      .eq("project_id", projectId)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return (data || []).map((row) => ({
      id: row.id,
      name: row.name,
      mime: "application/x-notes-board",
      bytes: null,
      url: null,
    }));
  } catch (error) {
    console.error("[suite_imports.listImportableNotes]", error);
    return [];
  }
}
