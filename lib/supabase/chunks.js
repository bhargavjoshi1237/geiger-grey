// Data access for grey.chunks — paginated chunk listing with a total count for the pager, and
// passage text for a Playground reply's context view.
// Only live chunks are listed (staged rows belong to an ingestion job still in progress), and
// only display columns are selected: embeddings, fts and search_text never reach the browser.
import { createClient } from "./client";
import { isSupabaseConfigured } from "./config";
import { toCamel } from "./repository";

const TABLE = "chunks";
const COLUMNS =
  "id, project_id, kb_id, source_id, ordinal, content, token_count, page, start_ms, end_ms, heading_path, metadata, created_at, updated_at";

export async function listChunks(projectId, { kbId, sourceId, page = 1, pageSize = 25 } = {}) {
  if (!isSupabaseConfigured() || !projectId) return { rows: [], count: 0 };
  try {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    let q = createClient()
      .from(TABLE)
      .select(COLUMNS, { count: "exact" })
      .eq("project_id", projectId)
      .eq("state", "live")
      .is("deleted_at", null);
    if (kbId) q = q.eq("kb_id", kbId);
    if (sourceId) q = q.eq("source_id", sourceId);
    const { data, error, count } = await q.order("ordinal", { ascending: true }).range(from, to);
    if (error) throw error;
    return { rows: (data || []).map(toCamel), count: count || 0 };
  } catch (error) {
    console.error("[chunks.listChunks]", error);
    return { rows: [], count: 0 };
  }
}

// Full text of specific chunks (a reply's context passages) -> Map(id -> content), or null on
// failure. Chunks deleted since (a re-ingest) are simply missing from the map.
export async function getChunkContents(projectId, ids = []) {
  if (!isSupabaseConfigured() || !projectId || !ids.length) return new Map();
  try {
    const { data, error } = await createClient()
      .from(TABLE)
      .select("id, content")
      .eq("project_id", projectId)
      .in("id", ids)
      .is("deleted_at", null);
    if (error) throw error;
    return new Map((data || []).map((row) => [row.id, row.content ?? ""]));
  } catch (error) {
    console.error("[chunks.getChunkContents]", error);
    return null;
  }
}
