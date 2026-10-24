import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import {
  LOOKUP_NAME_MAX,
  MCP_TOOL_NAMES,
  decodeCursor,
  enabledLookupToolIds,
  enabledToolNames,
  encodeCursor,
  formatAnswerText,
  formatEntityText,
  formatLookupText,
  formatSearchText,
  lookupToolDescription,
  lookupToolNames,
  registerTools,
  scopeConfigToServer,
} from "./tools.js";
import { TEMPLATE_INFO } from "../../grey/tool_spec.js";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const KB_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const KB_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const KB_OTHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

// Chainable, awaitable stand-in for the service-role client (filters: eq, neq, is, in, gte, or of
// eq's; range; maybeSingle; head counts). `rpcs` maps function names to (params) => data.
function fakeAdmin(tables, rpcs = {}) {
  return {
    rpc: async (name, params) =>
      rpcs[name] ? { data: rpcs[name](params), error: null } : { data: null, error: { message: "not stubbed" } },
    from(table) {
      const filters = [];
      let range = null;
      let head = false;
      const rows = () => {
        let out = (tables[table] || []).filter((r) => filters.every((f) => f(r)));
        if (range) out = out.slice(range[0], range[1] + 1);
        return out;
      };
      const query = {
        select: (_columns, options = {}) => ((head = Boolean(options.head)), query),
        eq: (col, value) => (filters.push((r) => r[col] === value), query),
        gte: (col, value) => (filters.push((r) => r[col] >= value), query),
        neq: (col, value) => (filters.push((r) => r[col] !== value), query),
        is: (col, value) => (filters.push((r) => (r[col] ?? null) === value), query),
        in: (col, values) => (filters.push((r) => values.includes(r[col])), query),
        or: (expr) => {
          const terms = expr.split(",").map((t) => t.split(".eq."));
          filters.push((r) => terms.some(([col, value]) => r[col] === value));
          return query;
        },
        not: () => query,
        order: () => query,
        limit: () => query,
        range: (from, to) => ((range = [from, to]), query),
        maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
        then(resolve, reject) {
          const result = head ? { data: null, count: rows().length, error: null } : { data: rows(), error: null };
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

async function rpcCall(handler, method, params) {
  const res = await handler.fetch(
    new Request("http://grey.test/api/mcp/x", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );
  const text = await res.text();
  const data = text.split("\n").find((line) => line.startsWith("data: "));
  return JSON.parse(data ? data.slice(6) : text).result;
}

function serve(server, tables = {}, rpcs = {}, extra = {}) {
  const calls = [];
  const ctx = {
    admin: fakeAdmin(tables, rpcs),
    projectId: PROJECT,
    server,
    signal: undefined,
    record: (c) => calls.push(c),
    ...extra,
  };
  const handler = createMcpHandler(
    async () => {
      const mcp = new McpServer({ name: "grey-test", version: "1.0.0" }, { capabilities: { tools: {} } });
      await registerTools(mcp, ctx);
      return mcp;
    },
    { legacy: "stateless" },
  );
  return { handler, calls };
}

test("tool names match the Delivery UI keys and only enabled tools count", () => {
  assert.deepEqual(MCP_TOOL_NAMES, ["search", "ask", "get_entity", "list_sources"]);
  assert.deepEqual(enabledToolNames({ search: true, ask: false, get_entity: true, extra: true }), ["search", "get_entity"]);
  assert.deepEqual(enabledToolNames({}), []);
  assert.deepEqual(enabledToolNames(null), []);
});

test("tools/list exposes only the enabled tools, all read-only", async () => {
  const { handler } = serve({ id: "s1", kb_ids: [KB_A], pipeline_id: null, tools: { search: true, list_sources: true } });
  const { tools } = await rpcCall(handler, "tools/list", {});
  assert.deepEqual(tools.map((t) => t.name).sort(), ["list_sources", "search"]);
  for (const tool of tools) assert.equal(tool.annotations.readOnlyHint, true);
  const search = tools.find((t) => t.name === "search");
  assert.equal(search.inputSchema.properties.topK.maximum, 20);
  assert.deepEqual(search.inputSchema.required, ["query"]);
});

test("a server with no enabled tools lists none", async () => {
  const { handler } = serve({ id: "s1", kb_ids: [], pipeline_id: null, tools: {} });
  const { tools } = await rpcCall(handler, "tools/list", {});
  assert.deepEqual(tools, []);
});

test("list_sources stays inside the server's knowledge bases and pages with a cursor", async () => {
  const source = (n, kb, extra = {}) => ({
    id: `00000000-0000-4000-8000-00000000000${n}`,
    project_id: PROJECT,
    kb_id: kb,
    name: `Doc ${n}`,
    kind: "document",
    status: "ready",
    deleted_at: null,
    created_at: "2026-10-01T00:00:00Z",
    ...extra,
  });
  const tables = {
    knowledge_bases: [
      { id: KB_A, name: "Docs", project_id: PROJECT, deleted_at: null },
      { id: KB_B, name: "Support", project_id: PROJECT, deleted_at: null },
      { id: KB_OTHER, name: "Elsewhere", project_id: PROJECT, deleted_at: null },
    ],
    sources: [
      source(1, KB_A),
      source(2, KB_A),
      source(3, KB_B),
      source(4, KB_OTHER),
      source(5, KB_A, { status: "processing" }),
      source(6, KB_A, { deleted_at: "2026-10-02" }),
    ],
  };
  const { handler, calls } = serve({ id: "s1", kb_ids: [KB_A, KB_B], pipeline_id: null, tools: { list_sources: true } }, tables);

  const page1 = await rpcCall(handler, "tools/call", { name: "list_sources", arguments: { limit: 2 } });
  assert.deepEqual(page1.structuredContent.sources.map((s) => s.name), ["Doc 1", "Doc 2"]);
  assert.equal(page1.structuredContent.sources[0].knowledgeBase, "Docs");
  assert.ok(page1.structuredContent.nextCursor);

  const page2 = await rpcCall(handler, "tools/call", {
    name: "list_sources",
    arguments: { limit: 2, cursor: page1.structuredContent.nextCursor },
  });
  assert.deepEqual(page2.structuredContent.sources.map((s) => s.name), ["Doc 3"]);
  assert.equal(page2.structuredContent.nextCursor, null);

  const outside = await rpcCall(handler, "tools/call", { name: "list_sources", arguments: { kbId: KB_OTHER } });
  assert.equal(outside.isError, true);
  assert.deepEqual(calls.map((c) => c.tool), ["list_sources", "list_sources"]);
});

test("engine errors become tool errors and are recorded as failed calls", async () => {
  const { handler, calls } = serve({ id: "s1", kb_ids: [], pipeline_id: null, tools: { ask: true } });
  const result = await rpcCall(handler, "tools/call", { name: "ask", arguments: { question: "What is Grey?" } });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /isn't connected to a pipeline/);
  assert.deepEqual(calls, [{ tool: "ask", query: "What is Grey?", status: "error", error: { code: "no_pipeline" } }]);
});

test("ask narrows the pipeline's knowledge bases to the server's set, never widens it", () => {
  const config = { pipelineId: "p", kbIds: [KB_A, KB_B], retrieval: { topK: 5 } };
  assert.deepEqual(scopeConfigToServer(config, { kb_ids: [KB_B, KB_OTHER] }).kbIds, [KB_B]);
  assert.deepEqual(scopeConfigToServer(config, { kb_ids: [KB_OTHER] }).kbIds, []);
  assert.equal(scopeConfigToServer(config, { kb_ids: [] }), config);
  assert.equal(scopeConfigToServer(config, { kb_ids: null }), config);
});

test("get_entity stays inside the server's knowledge bases and never serves aliases or descriptions", async () => {
  const E = "e0000000-0000-4000-8000-000000000001";
  const F = "e0000000-0000-4000-8000-000000000002";
  const G = "e0000000-0000-4000-8000-000000000003";
  const live = { project_id: PROJECT, deleted_at: null };
  const tables = {
    knowledge_bases: [{ id: KB_A, name: "Docs", ...live }],
    kg_entities: [
      { id: E, name: "Alphaco", type_id: "t-org", aliases: ["Secret Alias"], description: "From another KB", properties: { email: "x@y.z" }, merged_into: null, ...live },
      { id: F, name: "Betaco", type_id: "t-org", merged_into: null, ...live },
      { id: G, name: "Gammaco", type_id: "t-org", merged_into: null, ...live },
    ],
    kg_types: [{ id: "t-org", name: "Organization" }, { id: "t-rel", name: "related_to" }],
    kg_relations: [
      { id: "r-other-kb", source_entity_id: E, target_entity_id: F, type_id: "t-rel", source_app: "grey", confidence: 0.9, valid_to: null, ...live },
      { id: "r-manual", source_entity_id: E, target_entity_id: G, type_id: "t-rel", source_app: "manual", confidence: 0.5, valid_to: null, ...live },
    ],
    kg_mentions: [
      { entity_id: E, chunk_id: "c-a", ...live },
      { entity_id: F, chunk_id: "c-a", ...live },
      { entity_id: G, chunk_id: "c-a", ...live },
      { relation_id: "r-other-kb", chunk_id: "c-other", ...live },
    ],
    chunks: [
      { id: "c-a", source_id: "s-a", kb_id: KB_A, content: "Alphaco, Betaco and Gammaco.", page: 1, start_ms: null, state: "live", ...live },
      { id: "c-other", source_id: "s-o", kb_id: KB_OTHER, content: "Alphaco acquired Betaco.", page: 1, start_ms: null, state: "live", ...live },
    ],
    sources: [{ id: "s-a", name: "a.pdf", ...live }, { id: "s-o", name: "o.pdf", ...live }],
  };
  const rpcs = { kg_live_entity: ({ p_entity }) => p_entity, kg_entity_grounded: () => true };
  const { handler } = serve({ id: "s1", kb_ids: [KB_A], pipeline_id: null, tools: { get_entity: true } }, tables, rpcs);
  const result = await rpcCall(handler, "tools/call", { name: "get_entity", arguments: { id: E } });
  const entity = result.structuredContent.entity;
  assert.equal(entity.name, "Alphaco");
  assert.equal(entity.type, "Organization");
  assert.equal("aliases" in entity, false);
  assert.equal("description" in entity, false);
  assert.equal("properties" in entity, false);
  assert.deepEqual(entity.relations.map((r) => `${r.subject} ${r.relation} ${r.object}`), ["Alphaco related_to Gammaco"]);
  assert.deepEqual(entity.mentions.map((m) => m.sourceName), ["a.pdf"]);
  assert.doesNotMatch(result.content[0].text, /Secret Alias|another KB|Betaco/);
});

test("formatting and cursors", () => {
  assert.equal(formatEntityText(null), "No matching entity in the connected knowledge bases.");
  assert.equal(formatEntityText({ name: "Acme", type: "Organization", relations: [], mentions: [] }), "Acme (Organization)");
  assert.equal(formatSearchText([]), "No matching passages in the connected knowledge bases.");
  const text = formatSearchText([{ sourceName: "Guide", page: 3, startMs: null, content: "Hello" }]);
  assert.equal(text, "[1] Guide — p. 3\nHello");
  assert.equal(
    formatAnswerText("Grey is a RAG platform [1].", [{ index: 1, title: "Intro", page: null, startMs: 75_000 }]),
    "Grey is a RAG platform [1].\n\nSources:\n[1] Intro — 01:15",
  );
  assert.equal(decodeCursor(encodeCursor(50)), 50);
  assert.equal(decodeCursor(undefined), 0);
  assert.equal(decodeCursor("garbage"), null);
});
