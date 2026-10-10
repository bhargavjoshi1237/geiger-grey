// Data access for grey.ingestion_presets — system presets (project_id null) plus a project's own overrides.
import { createClient } from "./client";
import { isSupabaseConfigured } from "./config";
import { toCamel, makeRepo } from "./repository";

const TABLE = "ingestion_presets";
const columns = ["name", "tier", "isSystem", "description", "config", "metadata"];

// Fixed ids seeded by the ingestion migration — stable so UI code can special-case them.
export const SYSTEM_PRESET_IDS = {
  fast: "00000000-0000-4000-8000-000000000001",
  balanced: "00000000-0000-4000-8000-000000000002",
  high: "00000000-0000-4000-8000-000000000003",
  auto: "00000000-0000-4000-8000-000000000004",
};

const repo = makeRepo({ table: TABLE, columns });

// System presets first (readable by everyone), then this project's custom presets.
export async function listPresets(projectId) {
  if (!isSupabaseConfigured() || !projectId) return [];
  try {
    const { data, error } = await createClient()
      .from(TABLE)
      .select("*")
      .is("deleted_at", null)
      .or(`project_id.is.null,project_id.eq.${projectId}`)
      .order("is_system", { ascending: false })
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data || []).map(toCamel);
  } catch (error) {
    console.error("[ingestion_presets.listPresets]", error);
    return [];
  }
}

export const createPreset = (projectId, input) => repo.create(projectId, input);
export const updatePreset = (id, patch) => repo.update(id, patch);
export const deletePreset = (id) => repo.remove(id);
