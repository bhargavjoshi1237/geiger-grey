// One Grey MCP server, built per HTTP request (spec §12.3): stateless transports can't be
// reused, so every request gets a fresh McpServer from the same factory. Serves the
// 2026-07-28 protocol and, through the stateless legacy fallback, 2025-era clients.
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { registerTools } from "./tools.js";

const SERVER_VERSION = "1.0.0";

const INSTRUCTIONS =
  "Grey knowledge server. Use `search` for relevant passages, `ask` for a grounded answer with citations, " +
  "`get_entity` for knowledge-graph facts and `list_sources` to see what's indexed. Only tools enabled on this server are listed.";

function serverName(server) {
  const slug = String(server?.name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `grey-${slug}` : "grey";
}

// ctx: { admin, projectId, server (mcp_servers row), signal, record(entry) }
export function createGreyMcpServer(ctx) {
  const mcp = new McpServer(
    { name: serverName(ctx.server), title: ctx.server?.name || "Grey", version: SERVER_VERSION },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );
  registerTools(mcp, ctx);
  return mcp;
}

export function createGreyMcpHandler(ctx) {
  return createMcpHandler(() => createGreyMcpServer(ctx), {
    legacy: "stateless",
    onerror: (error) => console.error("[mcp.handler]", error?.message || error),
  });
}
