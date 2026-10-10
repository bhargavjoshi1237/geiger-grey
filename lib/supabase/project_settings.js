// Data access for grey.project_settings — one row per project, created lazily on first save.
import { createClient } from "./client";
import { isSupabaseConfigured } from "./config";
import { toCamel, toSnakeRow } from "./repository";

const TABLE = "project_settings";
const columns = [
  "defaultPresetId",
  "defaultEmbeddingModel",
  "monthlySoftCap",
  "capBehavior",
  "alertEmails",
  "retentionDays",
  "logQueries",
  "metadata",
];

const DEFAULTS = {
  id: null,
  defaultPresetId: null,
  defaultEmbeddingModel: "cohere-embed-5-pro",
  monthlySoftCap: null,
  capBehavior: "alert",
  alertEmails: [],
  retentionDays: null,
  logQueries: true,
  metadata: {},
};

// The project's settings, or sensible defaults when nothing has been saved yet.
export async function getProjectSettings(projectId) {
  if (!isSupabaseConfigured() || !projectId) return { ...DEFAULTS, projectId };
  try {
    const { data, error } = await createClient()
      .from(TABLE)
      .select("*")
      .eq("project_id", projectId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw error;
    return data ? toCamel(data) : { ...DEFAULTS, projectId };
  } catch (error) {
    console.error("[project_settings.getProjectSettings]", error);
    return { ...DEFAULTS, projectId };
  }
}

// Create-or-update the project's single settings row.
export async function saveProjectSettings(projectId, patch) {
  if (!isSupabaseConfigured() || !projectId) return null;
  try {
    const row = { ...toSnakeRow(patch, columns), project_id: projectId };
    const { data, error } = await createClient()
      .from(TABLE)
      .upsert(row, { onConflict: "project_id" })
      .select("*")
      .single();
    if (error) throw error;
    return toCamel(data);
  } catch (error) {
    console.error("[project_settings.saveProjectSettings]", error);
    return null;
  }
}
