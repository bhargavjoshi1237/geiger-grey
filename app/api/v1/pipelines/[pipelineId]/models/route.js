import { isUuid } from "@/lib/server/auth";
import { authenticateApiKey } from "@/lib/server/api_key_auth";
import { OpenAIError, handleOpenAI, openAIErrorResponse, openAIJson } from "@/lib/server/openai_format";
import { resolvePipelineConfig } from "@/lib/engine/pipeline_config";
import { nowSeconds, pipelineModelId } from "@/lib/grey/openai_frames";

export const runtime = "nodejs";

// The single model a pipeline base URL serves, for clients that list models first
// (OpenAI SDK `models.list()` with baseURL …/api/v1/pipelines/<id>).
export const GET = handleOpenAI(async (request, { params }) => {
  const { pipelineId } = await params;
  const { admin, projectId, headers } = await authenticateApiKey(request, { pipelineId });

  try {
    if (!isUuid(pipelineId)) throw new OpenAIError(404, "pipeline_not_found", "Pipeline not found.");
    const config = await resolvePipelineConfig({ admin, projectId, pipelineId, channel: "api" });

    const { data: version, error } = await admin
      .from("pipeline_versions")
      .select("created_at")
      .eq("project_id", projectId)
      .eq("pipeline_id", pipelineId)
      .eq("version", config.version)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) console.error("[api.v1.models]", error.message);
    const created = version?.created_at ? nowSeconds(Date.parse(version.created_at)) : nowSeconds();

    return openAIJson(
      { object: "list", data: [{ id: pipelineModelId(pipelineId, config.version), object: "model", created, owned_by: "grey" }] },
      { headers },
    );
  } catch (error) {
    return openAIErrorResponse(error, headers);
  }
});
