// Data access for grey.mcp_servers — MCP endpoints exposing KBs/pipelines as tools.
import { makeRepo } from "./repository";

const columns = ["name", "kbIds", "pipelineId", "apiKeyId", "tools", "status", "metadata"];

const repo = makeRepo({ table: "mcp_servers", columns });

export const listMcpServers = (projectId) => repo.list(projectId);
export const createMcpServer = (projectId, input) => repo.create(projectId, input);
export const updateMcpServer = (id, patch) => repo.update(id, patch);
export const deleteMcpServer = (id) => repo.remove(id);
