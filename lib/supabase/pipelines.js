// Data access for grey.pipelines and grey.pipeline_versions — RAG pipeline configs and their published snapshots.
import { createClient } from "./client";
import { isSupabaseConfigured } from "./config";
import { toCamel, toSnakeRow, makeRepo } from "./repository";
import { getUser } from "./user";

const PIPELINES = "pipelines";
const VERSIONS = "pipeline_versions";
const pipelineColumns = [
  "name",
  "description",
  "kbIds",
  "providerId",
  "model",
  "temperature",
  "maxTokens",
  "systemPrompt",
  "retrieval",
  "status",
  "currentVersion",
  "metadata",
];
const versionColumns = ["pipelineId", "version", "config", "note", "publishedBy", "metadata"];

const repo = makeRepo({ table: PIPELINES, columns: pipelineColumns });

export const listPipelines = (projectId) => repo.list(projectId);
export const getPipeline = (id) => repo.get(id);
export const createPipeline = (projectId, input) => repo.create(projectId, input);
export const updatePipeline = (id, patch) => repo.update(id, patch);
export const deletePipeline = (id) => repo.remove(id);

export async function listPipelineVersions(projectId, pipelineId) {
  if (!isSupabaseConfigured() || !projectId || !pipelineId) return [];
  try {
    const { data, error } = await createClient()
      .from(VERSIONS)
      .select("*")
      .eq("project_id", projectId)
      .eq("pipeline_id", pipelineId)
      .order("version", { ascending: false });
    if (error) throw error;
    return (data || []).map(toCamel);
  } catch (error) {
    console.error("[pipelines.listPipelineVersions]", error);
    return [];
  }
}

// Snapshots the pipeline's current config into a new version row, marks the pipeline live, and advances
// current_version. Returns the updated pipeline, or null on any failure.
export async function publishPipeline(pipeline, note) {
  if (!isSupabaseConfigured() || !pipeline?.id || !pipeline?.projectId) return null;
  try {
    const sb = createClient();
    const user = await getUser();
    const nextVersion = (pipeline.currentVersion || 0) + 1;
    const snapshot = {
      kbIds: pipeline.kbIds,
      providerId: pipeline.providerId,
      model: pipeline.model,
      temperature: pipeline.temperature,
      maxTokens: pipeline.maxTokens,
      systemPrompt: pipeline.systemPrompt,
      retrieval: pipeline.retrieval,
    };
    const versionRow = {
      ...toSnakeRow(
        { pipelineId: pipeline.id, version: nextVersion, config: snapshot, note, publishedBy: user?.id },
        versionColumns,
      ),
      project_id: pipeline.projectId,
    };
    const { error: versionError } = await sb.from(VERSIONS).insert(versionRow);
    if (versionError) throw versionError;

    const { data, error } = await sb
      .from(PIPELINES)
      .update({ status: "live", current_version: nextVersion })
      .eq("id", pipeline.id)
      .select("*")
      .single();
    if (error) throw error;
    return toCamel(data);
  } catch (error) {
    console.error("[pipelines.publishPipeline]", error);
    return null;
  }
}
