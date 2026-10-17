import { handleApi } from "@/lib/server/api_key_auth";
import { resolvePipelineConfig } from "@/lib/engine/pipeline_config";
import { publicWidgetConfig, widgetAccess, widgetError, widgetPreflight } from "../widget_access.js";

export const runtime = "nodejs";

const METHODS = "GET, OPTIONS";

export const OPTIONS = handleApi(async (request, { params }) => {
  const { widgetId } = await params;
  return widgetPreflight(request, widgetId, METHODS);
});

// Appearance for public/widget.js. Fails (and the widget stays hidden) unless the widget is
// enabled, the page origin is allowed, the bound key is live and the pipeline is published.
export const GET = handleApi(async (request, { params }) => {
  const { widgetId } = await params;
  const { admin, widget, cors } = await widgetAccess(request, widgetId, { methods: METHODS });
  try {
    await resolvePipelineConfig({ admin, projectId: widget.project_id, pipelineId: widget.pipeline_id, channel: "widget" });
  } catch (error) {
    throw widgetError(error, cors);
  }
  return Response.json(publicWidgetConfig(widget), { headers: { ...cors, "Cache-Control": "no-store" } });
});
