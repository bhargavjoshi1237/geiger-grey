import { test } from "node:test";
import assert from "node:assert/strict";
import { loadToolForRun, monthStart, monthlyRunCount, recordToolRun } from "./tool_runs.js";
import { PROJECT, OTHER_PROJECT, uuid } from "./test_helpers.js";
import { PRICE_PER_RETRIEVAL } from "../grey/cost.js";

const TOOL = uuid(1);
const USER = uuid(2);
const KEY = uuid(3);

// select/eq/neq/is/gte, count (head) selects, insert(…).select().maybeSingle(), plain inserts.
function memoryAdmin(seed = {}, { failInsert = () => false, failSelect = () => false } = {}) {
  const db = Object.fromEntries(Object.entries(seed).map(([table, rows]) => [table, rows.map((r) => ({ ...r }))]));
  let nextId = 1;
  const from = (table) => {
    const filters = [];
    let op = { type: "select" };
    let options = {};
    const run = () => {
      const rows = (db[table] ||= []);
      if (op.type === "insert") {
        if (failInsert(table)) return { data: null, error: { code: "XX000", message: "insert failed" } };
        const inserted = (Array.isArray(op.payload) ? op.payload : [op.payload]).map((row) => ({ id: `row-${nextId++}`, ...row }));
        rows.push(...inserted);
        return { data: inserted, error: null };
      }
      if (failSelect(table)) return { data: null, count: null, error: { code: "57P01", message: "down" } };
      const hit = rows.filter((row) => filters.every((f) => f(row)));
      return options.head ? { data: null, count: hit.length, error: null } : { data: hit, error: null };
    };
    const query = {
      select: (_columns, opts = {}) => ((options = opts), query),
      eq: (column, value) => (filters.push((row) => row[column] === value), query),
      neq: (column, value) => (filters.push((row) => row[column] !== value), query),
      is: (column, value) => (filters.push((row) => (row[column] ?? null) === value), query),
      gte: (column, value) => (filters.push((row) => row[column] >= value), query),
      insert: (payload) => ((op = { type: "insert", payload }), query),
      maybeSingle: async () => {
        const result = run();
        return { data: Array.isArray(result.data) ? (result.data[0] ?? null) : result.data, error: result.error };
      },
      then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
    };
    return query;
  };
  return { db, from };
}

const result = (extra = {}) => ({
  template: "classify",
  similar: [
    { index: 1, sourceId: uuid(10), score: 0.9, snippet: "secret snippet", labels: ["cat"] },
    { index: 2, sourceId: uuid(11), score: 0.7, snippet: "another", labels: [] },
  ],
  classification: { label: "cat", confidence: 0.8, margin: 0.6, decidedBy: "knn", uncertain: false },
  answer: null,
  usage: { searched: true, embedCalls: 1, llmCalls: 1, tokensIn: 300, tokensOut: 20, model: "vision-1", provider: "openai" },
  timings: { totalMs: 120, searchMs: 80, llmMs: 30 },
  warnings: [],
  ...extra,
});

const parsedImage = { data: "QUJD", mimeType: "image/png", bytes: new Uint8Array(3), width: 640, height: 480, byteLength: 3 };

test("recordToolRun stores summaries (never the text or image) and meters the run", async () => {
  const admin = memoryAdmin();
  const runId = await recordToolRun({
    admin,
    projectId: PROJECT,
    toolId: TOOL,
    version: 2,
    channel: "api",
    status: "ok",
    input: { text: "is this a cat?", image: parsedImage },
    result: result(),
    latencyMs: 123.6,
    apiKeyId: KEY,
    createdBy: USER,
  });
  assert.equal(runId, "row-1");
  const [run] = admin.db.tool_runs;
  assert.deepEqual(run, {
    id: "row-1",
    project_id: PROJECT,
    tool_id: TOOL,
    version: 2,
    channel: "api",
    status: "ok",
    input: { hasText: true, textChars: 14, hasImage: true, imageBytes: 3, width: 640, height: 480 },
    output: {
      label: "cat",
      confidence: 0.8,
      decidedBy: "knn",
      similar: [
        { sourceId: uuid(10), score: 0.9 },
        { sourceId: uuid(11), score: 0.7 },
      ],
      answerChars: 0,
      abstained: null,
    },
    usage: result().usage,
    latency_ms: 124,
    error_code: null,
    api_key_id: KEY,
    created_by: USER,
  });
  const stored = JSON.stringify(admin.db.tool_runs);
  assert.doesNotMatch(stored, /is this a cat|QUJD|secret snippet/);

  const [retrieval, tokens] = admin.db.usage_events;
  assert.deepEqual(retrieval, {
    id: "row-2",
    project_id: PROJECT,
    kind: "retrieval",
    quantity: 1,
    unit_cost: PRICE_PER_RETRIEVAL,
    cost: PRICE_PER_RETRIEVAL,
    ref_type: "tool",
    ref_id: TOOL,
    metadata: { channel: "api", toolId: TOOL, version: 2 },
    created_by: USER,
  });
  assert.equal(tokens.kind, "llm_tokens");
  assert.equal(tokens.quantity, 320);
  assert.equal(tokens.cost, 0);
  assert.equal(tokens.unit_cost, 0);
  assert.deepEqual(tokens.metadata, {
    channel: "api",
    toolId: TOOL,
    version: 2,
    byok: true,
    tokensIn: 300,
    tokensOut: 20,
    model: "vision-1",
    provider: "openai",
  });
});

test("recordToolRun: answers, errors and unsearched runs", async () => {
  const admin = memoryAdmin();
  await recordToolRun({
    admin,
    projectId: PROJECT,
    toolId: TOOL,
    channel: "playground",
    input: { text: "Q?", image: null },
    result: result({
      classification: null,
      answer: { text: "Five words in this answer.", citations: [], abstained: false, reason: null },
      usage: { searched: false, embedCalls: 0, llmCalls: 0, tokensIn: 0, tokensOut: 0 },
    }),
  });
  const [answered] = admin.db.tool_runs;
  assert.equal(answered.version, 0, "draft runs are version 0");
  assert.equal(answered.output.answerChars, 26);
  assert.equal(answered.output.abstained, false);
  assert.equal(answered.output.label, null);
  assert.deepEqual(answered.input, { hasText: true, textChars: 2, hasImage: false, imageBytes: null, width: null, height: null });
  assert.equal(admin.db.usage_events, undefined, "nothing searched, no tokens: nothing metered");

  await recordToolRun({
    admin,
    projectId: PROJECT,
    toolId: TOOL,
    channel: "mcp",
    status: "error",
    input: {},
    error: { code: "tool_scope_empty" },
  });
  const failed = admin.db.tool_runs[1];
  assert.equal(failed.status, "error");
  assert.equal(failed.error_code, "tool_scope_empty");
  assert.deepEqual(failed.output, {});
  assert.deepEqual(failed.usage, {});
  await recordToolRun({ admin, projectId: PROJECT, toolId: TOOL, channel: "api", status: "error", input: {} });
  assert.equal(admin.db.tool_runs[2].error_code, "internal_error");
});

test("recordToolRun never throws: a failed insert returns null and usage is still recorded", async () => {
  const admin = memoryAdmin({}, { failInsert: (table) => table === "tool_runs" });
  const runId = await recordToolRun({ admin, projectId: PROJECT, toolId: TOOL, channel: "api", input: {}, result: result() });
  assert.equal(runId, null);
  assert.equal(admin.db.usage_events.length, 2);

  const broken = { from: () => { throw new Error("client gone"); } };
  assert.equal(await recordToolRun({ admin: broken, projectId: PROJECT, toolId: TOOL, channel: "api", input: {}, result: result() }), null);
});

test("monthlyRunCount counts this month's ok runs outside tests", async () => {
  const now = new Date("2026-10-21T12:00:00Z");
  assert.equal(monthStart(now), "2026-10-01T00:00:00.000Z");
  const run = (extra) => ({ project_id: PROJECT, tool_id: TOOL, status: "ok", channel: "api", created_at: "2026-10-05T00:00:00.000Z", ...extra });
  const admin = memoryAdmin({
    tool_runs: [
      run(),
      run({ channel: "mcp" }),
      run({ channel: "playground", created_at: "2026-10-01T00:00:00.000Z" }),
      run({ channel: "test" }),
      run({ status: "error" }),
      run({ created_at: "2026-09-30T23:59:59.000Z" }),
      run({ tool_id: uuid(9) }),
      run({ project_id: OTHER_PROJECT }),
    ],
  });
  assert.equal(await monthlyRunCount({ admin, projectId: PROJECT, toolId: TOOL, now }), 3);

  const down = memoryAdmin({}, { failSelect: () => true });
  await assert.rejects(monthlyRunCount({ admin: down, projectId: PROJECT, toolId: TOOL }), { code: "service_unavailable", status: 503 });
});

const toolRow = (extra = {}) => ({
  id: TOOL,
  project_id: PROJECT,
  name: "Pet sorter",
  description: null,
  spec: { template: "classify", scope: { kbIds: ["kb-draft"] }, classify: { labels: ["cat", "dog"] } },
  status: "live",
  current_version: 2,
  deleted_at: null,
  ...extra,
});

const versionRow = (version, kbId) => ({
  project_id: PROJECT,
  tool_id: TOOL,
  version,
  spec: { template: "find_similar", scope: { kbIds: [kbId] } },
  deleted_at: null,
});

test("loadToolForRun: the draft is version 0 and its spec is normalised", async () => {
  const admin = memoryAdmin({ tools: [toolRow({ status: "draft", current_version: 0 })], tool_versions: [] });
  for (const version of [0, null, undefined, "0"]) {
    const loaded = await loadToolForRun({ admin, projectId: PROJECT, toolId: TOOL, version });
    assert.equal(loaded.version, 0);
    assert.equal(loaded.tool.id, TOOL);
    assert.equal(loaded.spec.schemaVersion, 1);
    assert.equal(loaded.spec.template, "classify");
    assert.deepEqual(loaded.spec.scope.kbIds, ["kb-draft"]);
    assert.equal(loaded.spec.classify.mode, "auto");
  }
  const junk = memoryAdmin({ tools: [toolRow({ spec: "not a spec" })] });
  assert.equal((await loadToolForRun({ admin: junk, projectId: PROJECT, toolId: TOOL, version: 0 })).spec.template, "find_similar");
});

test("loadToolForRun: published versions, 'live' and the errors", async () => {
  const admin = memoryAdmin({ tools: [toolRow()], tool_versions: [versionRow(1, "kb-v1"), versionRow(2, "kb-v2")] });
  const pinned = await loadToolForRun({ admin, projectId: PROJECT, toolId: TOOL, version: 1 });
  assert.equal(pinned.version, 1);
  assert.deepEqual(pinned.spec.scope.kbIds, ["kb-v1"]);
  assert.equal(pinned.spec.template, "find_similar");
  const live = await loadToolForRun({ admin, projectId: PROJECT, toolId: TOOL, version: "live" });
  assert.equal(live.version, 2);
  assert.deepEqual(live.spec.scope.kbIds, ["kb-v2"]);

  await assert.rejects(loadToolForRun({ admin, projectId: PROJECT, toolId: TOOL, version: 7 }), {
    code: "tool_version_not_found",
    status: 404,
    message: "Version 7 of this tool doesn't exist.",
  });
  await assert.rejects(loadToolForRun({ admin, projectId: PROJECT, toolId: TOOL, version: -1 }), { code: "tool_version_not_found" });
  await assert.rejects(loadToolForRun({ admin, projectId: PROJECT, toolId: TOOL, version: "abc" }), { code: "tool_version_not_found" });
  await assert.rejects(loadToolForRun({ admin, projectId: OTHER_PROJECT, toolId: TOOL, version: 0 }), { code: "tool_not_found", status: 404 });
  await assert.rejects(loadToolForRun({ admin, projectId: PROJECT, toolId: uuid(99) }), { code: "tool_not_found" });

  const draftOnly = memoryAdmin({ tools: [toolRow({ status: "draft", current_version: 0 })], tool_versions: [versionRow(1, "kb-v1")] });
  await assert.rejects(loadToolForRun({ admin: draftOnly, projectId: PROJECT, toolId: TOOL, version: 1 }), { code: "tool_not_live", status: 409 });
  await assert.rejects(loadToolForRun({ admin: draftOnly, projectId: PROJECT, toolId: TOOL, version: "live" }), { code: "tool_not_live" });

  const deleted = memoryAdmin({ tools: [toolRow({ deleted_at: "2026-10-20T00:00:00Z" })] });
  await assert.rejects(loadToolForRun({ admin: deleted, projectId: PROJECT, toolId: TOOL }), { code: "tool_not_found" });

  const down = memoryAdmin({ tools: [toolRow()] }, { failSelect: () => true });
  await assert.rejects(loadToolForRun({ admin: down, projectId: PROJECT, toolId: TOOL }), { code: "service_unavailable" });
});
