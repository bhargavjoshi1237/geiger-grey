// Data access for grey.tools and its child tables (tool_versions, tool_messages, tool_runs), plus the
// tool routes (run, test, publish, builder). status, current_version and test_report are written
// only by the routes (service role) — the DB rejects client writes to them, so updates never send them.
import { BASE_PATH } from "@/lib/base_path";
import { apiFetch, apiStream } from "@/lib/api";
import { createClient } from "./client";
import { isSupabaseConfigured } from "./config";
import { makeRepo, toCamel } from "./repository";

const TOOLS = "tools";
const VERSIONS = "tool_versions";
const MESSAGES = "tool_messages";
const RUNS = "tool_runs";

// The only member-writable columns.
const toolColumns = ["name", "description", "spec"];

const repo = makeRepo({ table: TOOLS, columns: toolColumns, order: "updated_at" });

export const listTools = (projectId) => repo.list(projectId);
export const getTool = (id) => repo.get(id);
export const createTool = (projectId, { name, description, spec } = {}) => repo.create(projectId, { name, description, spec });
export const deleteTool = (id) => repo.remove(id);

// Only the keys given are sent (undefined ones are skipped by toSnakeRow).
export const updateTool = (id, { name, description, spec } = {}) => repo.update(id, { name, description, spec });

// Rows of one tool's child table, scoped to the project. tool_runs has no deleted_at.
async function listChildren(table, { projectId, toolId, ascending, order = "created_at", limit, softDelete = true }) {
  if (!isSupabaseConfigured() || !projectId || !toolId) return [];
  try {
    let query = createClient().from(table).select("*").eq("project_id", projectId).eq("tool_id", toolId);
    if (softDelete) query = query.is("deleted_at", null);
    query = query.order(order, { ascending });
    if (limit) query = query.limit(limit);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(toCamel);
  } catch (error) {
    console.error(`[tools.${table}]`, error);
    return [];
  }
}

export const listToolVersions = (projectId, toolId) =>
  listChildren(VERSIONS, { projectId, toolId, order: "version", ascending: false });

export const listToolMessages = (projectId, toolId) =>
  listChildren(MESSAGES, { projectId, toolId, ascending: true });

export const listToolRuns = (projectId, toolId, { limit = 20 } = {}) =>
  listChildren(RUNS, { projectId, toolId, ascending: false, limit, softDelete: false });

// Route rows may arrive snake_case; the screens read camelCase.
const camelTool = (row) => (row && ("current_version" in row || "project_id" in row) ? toCamel(row) : row);

// Runs the draft (version 0) or a published version -> { data: { result, runId }, error, message }.
// similar[] items carry thumbnailUrl (signed) instead of a storage path.
export const runToolRequest = ({ projectId, toolId, text, image, version = 0 } = {}) =>
  apiFetch(`/tools/${toolId}/run`, { method: "POST", body: { projectId, text, image, version } });

// Leave-one-out tests on the saved draft; the route also saves the report to tools.test_report.
// -> { data: { report }, error, message }
export const runToolTestsRequest = ({ projectId, toolId, includeLlm = false } = {}) =>
  apiFetch(`/tools/${toolId}/test`, { method: "POST", body: { projectId, includeLlm } });

// apiFetch keeps only { error, message } from a failed response; publishing also needs the
// validation `errors` list a 422 carries, so this call reads the whole body.
async function postWithDetails(path, body) {
  try {
    const {
      data: { session },
    } = await createClient().auth.getSession();
    const res = await fetch(`${BASE_PATH}/api${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        data: null,
        error: json.error || `HTTP ${res.status}`,
        message: json.message || null,
        errors: Array.isArray(json.errors) ? json.errors : [],
      };
    }
    return { data: json, error: null, message: null, errors: [] };
  } catch (error) {
    console.error("[tools.publish]", error);
    return {
      data: null,
      error: "network_error",
      message: "Couldn't reach the server. Check your connection and try again.",
      errors: [],
    };
  }
}

// Validates and snapshots the saved draft as the next version.
// -> { data: { tool, version }, error, message, errors } — a 422 "invalid_spec" lists errors: [{ path, message }].
export async function publishToolRequest({ projectId, toolId, note } = {}) {
  const res = await postWithDetails(`/tools/${toolId}/publish`, { projectId, note });
  if (!res.data) return res;
  return {
    ...res,
    data: {
      ...res.data,
      tool: camelTool(res.data.tool),
      version: res.data.version && typeof res.data.version === "object" ? toCamel(res.data.version) : res.data.version,
    },
  };
}

// One builder turn, streamed as NDJSON: start -> delta… / edit… -> done { userMessage,
// assistantMessage, tool } | error. Resolves like apiStream.
export const streamBuilderTurn = ({ projectId, toolId, content, onEvent, signal } = {}) =>
  apiStream(`/tools/${toolId}/builder`, { body: { projectId, content }, onEvent, signal });

// Restores the spec from before the latest edited builder turn -> { data: { tool }, error, message }.
export async function undoBuilderTurn({ projectId, toolId, messageId } = {}) {
  const res = await apiFetch(`/tools/${toolId}/builder/undo`, { method: "POST", body: { projectId, messageId } });
  return res.data ? { ...res, data: { ...res.data, tool: camelTool(res.data.tool) } } : res;
}
