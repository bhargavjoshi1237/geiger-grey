import { after } from "next/server";
import { isUuid } from "@/lib/server/auth";
import { ApiError } from "@/lib/server/errors";
import { apiError, authenticateApiKey, handleApi, requireAdmin } from "@/lib/server/api_key_auth";
import { logDelivery } from "@/lib/server/delivery_log";
import { createGreyMcpHandler } from "@/lib/server/mcp/server";

export const runtime = "nodejs";
export const maxDuration = 300;

async function loadServer(admin, serverId) {
  const { data, error } = await admin
    .from("mcp_servers")
    .select("id,project_id,name,kb_ids,pipeline_id,api_key_id,tools,status")
    .eq("id", serverId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    console.error("[api.mcp.server]", error.message);
    throw apiError("service_unavailable", 503, "The service is unavailable.");
  }
  return data;
}

// Bearer-authenticated (scope `mcp`; bound to the server's key when it has one), so no CORS.
// A fresh stateless MCP handler serves each request; only tools/call is logged.
async function serve(request, { params }) {
  const { serverId } = await params;
  const admin = requireAdmin();
  if (!isUuid(serverId)) throw new ApiError("not_found", 404, "MCP server not found.");
  const server = await loadServer(admin, serverId);
  if (!server) throw new ApiError("not_found", 404, "MCP server not found.");
  if (server.status === "disabled") throw new ApiError("server_disabled", 403, "This MCP server is disabled.");

  const auth = await authenticateApiKey(request, {
    admin,
    scope: "mcp",
    projectId: server.project_id,
    pipelineId: server.pipeline_id || undefined,
    requiredKeyId: server.api_key_id || undefined,
  });
  // A key limited to some pipelines can't reach a server that isn't bound to one: its search /
  // get_entity / list_sources tools would read knowledge bases outside the key's allow-list.
  const allowedPipelines = Array.isArray(auth.key.pipeline_ids) ? auth.key.pipeline_ids : [];
  if (allowedPipelines.length && !server.pipeline_id) {
    throw new ApiError("not_found", 404, "MCP server not found.");
  }

  // Tool calls are recorded during the exchange and written once the response has finished.
  const calls = [];
  const startedAt = Date.now();
  after(async () => {
    for (const call of calls) {
      await logDelivery({
        admin,
        projectId: server.project_id,
        pipelineId: server.pipeline_id,
        pipelineVersion: call.pipelineVersion ?? null,
        apiKeyId: auth.key.id,
        channel: "mcp",
        query: call.query ?? null,
        status: call.status,
        latencyMs: call.latencyMs,
        turn: call.turn ?? null,
        final: call.final ?? null,
        error: call.error ?? null,
        billed: Boolean(call.billed),
        refType: "mcp_server",
        refId: server.id,
        metadata: { tool: call.tool, serverId: server.id },
      });
    }
  });

  const handler = createGreyMcpHandler({
    admin,
    projectId: server.project_id,
    server,
    signal: request.signal,
    record: (call) => calls.push({ latencyMs: Date.now() - startedAt, ...call }),
  });
  const response = await handler.fetch(request);

  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(auth.headers)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export const GET = handleApi(serve);
export const POST = handleApi(serve);
export const DELETE = handleApi(serve);
