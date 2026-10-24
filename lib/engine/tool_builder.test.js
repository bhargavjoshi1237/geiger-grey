import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineError } from "./errors.js";
import { loadBuilderContext, runBuilderTurn } from "./tool_builder.js";
import { PROJECT, OTHER_PROJECT, uuid } from "./test_helpers.js";
import { BUILDER_INSTRUCTIONS, BUILDER_LIMITS } from "../grey/tool_builder.js";
import { normalizeToolSpec } from "../grey/tool_spec.js";

const TOOL = uuid(1);
const KB_IMG = uuid(10);
const KB_TEXT = uuid(11);
const KB_ARCHIVED = uuid(12);
const KB_OTHER = uuid(13);
const S = (n) => uuid(100 + n);

// Service-role double: select (incl. head counts)/eq/in/is/order/limit, update(…).select().maybeSingle(),
// and rpc("source_label_counts") computed from the seeded sources.
function memoryAdmin(seed, { failUpdate = false } = {}) {
  const db = Object.fromEntries(Object.entries(seed).map(([table, rows]) => [table, rows.map((r) => structuredClone(r))]));
  const updates = [];
  const rpcCalls = [];
  const from = (table) => {
    const filters = [];
    let op = "select";
    let payload = null;
    let options = {};
    let limit = null;
    let order = null;
    const run = () => {
      const rows = (db[table] ||= []);
      const hit = rows.filter((row) => filters.every((f) => f(row)));
      if (op === "update") {
        updates.push({ table, payload });
        if (failUpdate) return { data: null, error: { code: "57P01", message: "down" } };
        hit.forEach((row) => Object.assign(row, structuredClone(payload)));
        return { data: hit.map((row) => structuredClone(row)), error: null };
      }
      if (options.head) return { data: null, count: hit.length, error: null };
      let out = hit.map((row) => structuredClone(row));
      if (order) out.sort((a, b) => String(a[order]).localeCompare(String(b[order])));
      if (limit !== null) out = out.slice(0, limit);
      return { data: out, error: null };
    };
    const query = {
      select: (_columns, opts = {}) => {
        if (op === "select") options = opts;
        return query;
      },
      update: (value) => ((op = "update"), (payload = value), query),
      eq: (column, value) => (filters.push((row) => row[column] === value), query),
      in: (column, values) => (filters.push((row) => values.includes(row[column])), query),
      is: (column, value) => (filters.push((row) => (row[column] ?? null) === value), query),
      order: (column) => ((order = column), query),
      limit: (n) => ((limit = n), query),
      maybeSingle: async () => {
        const result = run();
        return { data: Array.isArray(result.data) ? (result.data[0] ?? null) : result.data, error: result.error };
      },
      then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
    };
    return query;
  };
  const rpc = async (name, params) => {
    rpcCalls.push({ name, params });
    if (name !== "source_label_counts") return { data: null, error: { code: "42883" } };
    const counts = new Map();
    for (const source of db.sources || []) {
      if (source.project_id !== params.p_project || source.deleted_at) continue;
      if (params.p_kb_ids && !params.p_kb_ids.includes(source.kb_id)) continue;
      for (const label of source.labels || []) counts.set(label, (counts.get(label) || 0) + 1);
    }
    const data = [...counts].map(([label, sources]) => ({ label, sources })).sort((a, b) => b.sources - a.sources);
    return { data, error: null };
  };
  return { db, updates, rpcCalls, from, rpc };
}

const toolRow = (spec = {}) => ({
  id: TOOL,
  project_id: PROJECT,
  name: "Damage classifier",
  description: null,
  status: "draft",
  current_version: 0,
  deleted_at: null,
  spec: normalizeToolSpec({ template: "classify", scope: { kbIds: [KB_IMG] }, ...spec }),
});

const source = (n, kbId, kind, labels = [], extra = {}) => ({
  id: S(n), project_id: PROJECT, kb_id: kbId, kind, labels, deleted_at: null, ...extra,
});

const seed = () => ({
  tools: [toolRow()],
  knowledge_bases: [
    { id: KB_IMG, project_id: PROJECT, name: "Claim photos", status: "active", deleted_at: null, embedding_provider_id: "p-emb" },
    { id: KB_TEXT, project_id: PROJECT, name: "Adjuster notes", status: "active", deleted_at: null, embedding_provider_id: "p-emb" },
    { id: KB_ARCHIVED, project_id: PROJECT, name: "Old", status: "archived", deleted_at: null },
    { id: KB_OTHER, project_id: OTHER_PROJECT, name: "Elsewhere", status: "active", deleted_at: null },
  ],
  sources: [
    source(1, KB_IMG, "image", ["scratch"]),
    source(2, KB_IMG, "image", ["scratch", "dent"]),
    source(3, KB_IMG, "document", ["dent"]),
    source(4, KB_IMG, "image", ["scratch"], { deleted_at: "2026-10-01T00:00:00Z" }),
    source(5, KB_TEXT, "note", ["urgent"]),
    { ...source(6, KB_OTHER, "image", ["scratch"]), project_id: OTHER_PROJECT },
  ],
  project_settings: [{ project_id: PROJECT, processing_provider_id: "p-chat", deleted_at: null }],
});

const RESOLVED = { model: { fake: "model" }, modelId: "gpt-test", providerKind: "openai", providerId: "p-chat" };
const kbImageSupport = async ({ kb }) =>
  kb.id === KB_IMG ? { supported: true, model: "embed-image", format: "cohere" } : { supported: false, model: null, format: null };

// streamText double: `script(options, results)` is an async generator yielding stream parts; it can
// call options.tools.update_tool.execute(...) like the SDK does. Tool outputs land in `results`.
function fakeStreamText(script) {
  const calls = [];
  const results = [];
  const fn = (options) => {
    calls.push(options);
    return { stream: script(options, results) };
  };
  return { fn, calls, results };
}

const callTool = async (options, results, input) => {
  const output = await options.tools.update_tool.execute(input, { toolCallId: `call-${results.length + 1}`, messages: [] });
  results.push(output);
  return output;
};

const deps = (streamText, extra = {}) => ({
  streamText,
  getProcessingModel: async () => RESOLVED,
  kbImageSupport,
  ...extra,
});

test("loadBuilderContext: active knowledge bases with image support, counts and in-scope labels", async () => {
  const admin = memoryAdmin(seed());
  const tool = admin.db.tools[0];
  const context = await loadBuilderContext({ admin, projectId: PROJECT, tool, deps: { kbImageSupport } });

  assert.deepEqual(context.kbs, [
    { id: KB_TEXT, name: "Adjuster notes", imageSupport: false, sources: 1, imageSources: 0 },
    { id: KB_IMG, name: "Claim photos", imageSupport: true, sources: 3, imageSources: 2 },
  ]);
  assert.deepEqual(context.labels, [{ label: "scratch", sources: 2 }, { label: "dent", sources: 2 }]);
  assert.deepEqual(admin.rpcCalls, [{ name: "source_label_counts", params: { p_project: PROJECT, p_kb_ids: [KB_IMG] } }]);
  assert.equal(context.processingModel, true);

  // No scope yet: labels across every active knowledge base.
  tool.spec = normalizeToolSpec({ template: "classify" });
  const all = await loadBuilderContext({ admin, projectId: PROJECT, tool, processingModel: false, deps: { kbImageSupport } });
  assert.deepEqual(admin.rpcCalls[1].params.p_kb_ids.sort(), [KB_IMG, KB_TEXT].sort());
  assert.ok(all.labels.some((row) => row.label === "urgent"));
  assert.equal(all.processingModel, false, "a known value skips the settings read");
});

test("runBuilderTurn: an update_tool call saves the draft, emits an edit and reports before/after", async () => {
  const admin = memoryAdmin(seed());
  const events = [];
  const fake = fakeStreamText(async function* (options, results) {
    yield { type: "text-delta", id: "t1", text: "Adding the two labels." };
    yield { type: "finish-step", usage: { inputTokens: 900, outputTokens: 40 } };
    await callTool(options, results, {
      name: "Claim damage",
      classify: { labels: [{ value: "scratch" }, { value: "dent", description: "Bent panels." }], mode: "knn" },
    });
    yield { type: "text-delta", id: "t2", text: "Done — it votes with the labels on your photos." };
    yield { type: "finish-step", usage: { inputTokens: 1000, outputTokens: 30 } };
    yield { type: "finish", totalUsage: { inputTokens: 1900, outputTokens: 70 } };
  });

  const turn = await runBuilderTurn({
    admin,
    projectId: PROJECT,
    tool: admin.db.tools[0],
    history: [
      { role: "user", content: "Make a classifier." },
      { role: "assistant", content: "Which labels?" },
    ],
    message: "Use scratch and dent, vote only.",
    onEvent: (event) => events.push(event),
    deps: deps(fake.fn),
  });

  // The model call.
  const options = fake.calls[0];
  assert.equal(options.model, RESOLVED.model);
  assert.ok(options.instructions.startsWith(BUILDER_INSTRUCTIONS));
  assert.ok(options.instructions.includes(`id ${KB_IMG}: "Claim photos"`));
  assert.ok(options.instructions.includes('"scratch": 2'));
  assert.deepEqual(options.messages, [
    { role: "user", content: "Make a classifier." },
    { role: "assistant", content: "Which labels?" },
    { role: "user", content: "Use scratch and dent, vote only." },
  ]);
  assert.deepEqual(Object.keys(options.tools), ["update_tool"]);
  assert.equal(typeof options.stopWhen, "function");
  assert.equal(options.maxOutputTokens, BUILDER_LIMITS.maxOutputTokens);
  assert.equal(options.toolCallConcurrency, 1);

  // The draft was saved, scoped to the project and tool.
  const saved = admin.db.tools[0];
  assert.deepEqual(saved.spec.classify.labels, [{ value: "scratch", description: "" }, { value: "dent", description: "Bent panels." }]);
  assert.equal(saved.spec.classify.mode, "knn");
  assert.equal(saved.spec.budget.maxLlmCalls, 0, "knn forces a zero model budget");
  assert.equal(saved.name, "Claim damage");
  assert.equal(admin.updates.length, 1);
  assert.deepEqual(Object.keys(admin.updates[0].payload).sort(), ["name", "spec"]);

  // What the model got back.
  const [output] = fake.results;
  assert.equal(output.ok, true);
  assert.deepEqual(output.changed, ["name", "classify.labels", "classify.mode", "budget.maxLlmCalls"]);
  assert.deepEqual(output.errors, []);
  assert.deepEqual(output.problems, []);
  assert.match(output.summary, /Labels \(2\): scratch, dent\./);
  assert.match(output.summary, /Searches: Claim photos/);

  // Events: deltas around one edit, the second paragraph separated.
  assert.deepEqual(events.map((e) => e.type), ["delta", "edit", "delta"]);
  assert.equal(events[2].text, "\n\nDone — it votes with the labels on your photos.");
  assert.deepEqual(events[1].changed, output.changed);
  assert.equal(events[1].name, "Claim damage");
  assert.equal(events[1].description, null);
  assert.deepEqual(events[1].spec, saved.spec);

  // The turn.
  assert.equal(turn.text, "Adding the two labels.\n\nDone — it votes with the labels on your photos.");
  assert.equal(turn.aborted, false);
  assert.equal(turn.error, null);
  assert.deepEqual(turn.specBefore, toolRow().spec);
  assert.deepEqual(turn.specAfter, saved.spec);
  assert.equal(turn.nameBefore, "Damage classifier");
  assert.equal(turn.nameAfter, "Claim damage");
  assert.equal(turn.descriptionBefore, null);
  assert.equal(turn.descriptionAfter, null);
  assert.deepEqual(turn.edits, [{ changed: output.changed, errors: [] }]);
  assert.equal(turn.tool.id, TOOL);
  assert.deepEqual(turn.usage, { tokensIn: 1900, tokensOut: 70, model: "gpt-test", provider: "openai" });
});

test("runBuilderTurn: an invalid patch goes back to the model and nothing is saved", async () => {
  const admin = memoryAdmin(seed());
  const events = [];
  const fake = fakeStreamText(async function* (options, results) {
    await callTool(options, results, { search: { topK: 50 }, scope: { kbIds: [KB_IMG, KB_OTHER] } });
    yield { type: "text-delta", id: "t1", text: "That knowledge base isn't in this project." };
    yield { type: "finish-step", usage: { inputTokens: 500, outputTokens: 12 } };
  });

  const turn = await runBuilderTurn({
    admin, projectId: PROJECT, tool: admin.db.tools[0], message: "Search everything, 50 results.",
    onEvent: (event) => events.push(event), deps: deps(fake.fn),
  });

  const [output] = fake.results;
  assert.equal(output.ok, false);
  assert.deepEqual(output.changed, []);
  assert.deepEqual(output.errors.map((e) => e.path).sort(), ["scope.kbIds", "search.topK"]);
  assert.ok(output.errors.find((e) => e.path === "scope.kbIds").message.includes(KB_OTHER));
  assert.ok(output.problems.some((p) => p.path === "classify.labels"), "still-open problems come back too");
  assert.equal(admin.updates.length, 0);
  assert.deepEqual(admin.db.tools[0].spec, toolRow().spec);
  assert.deepEqual(events.map((e) => e.type), ["delta"]);
  assert.deepEqual(turn.edits, []);
  assert.equal(turn.tool, null);
  assert.deepEqual(turn.specAfter, turn.specBefore);
  assert.deepEqual(turn.usage, { tokensIn: 500, tokensOut: 12, model: "gpt-test", provider: "openai" }, "step usage when no finish part");
});

test("runBuilderTurn: same name and description aren't changes; a failed save is reported", async () => {
  const admin = memoryAdmin(seed(), { failUpdate: true });
  const fake = fakeStreamText(async function* (options, results) {
    await callTool(options, results, { name: "Damage classifier", description: null });
    await callTool(options, results, { search: { topK: 5 } });
    yield { type: "finish", totalUsage: { inputTokens: 10, outputTokens: 1 } };
  });

  const turn = await runBuilderTurn({ admin, projectId: PROJECT, tool: admin.db.tools[0], message: "x", deps: deps(fake.fn) });

  assert.deepEqual(fake.results[0], { ...fake.results[0], ok: true, changed: [] });
  assert.equal(admin.updates.length, 1, "only the real change tried to save");
  assert.equal(fake.results[1].ok, false);
  assert.match(fake.results[1].errors.at(-1).message, /couldn't be saved/);
  assert.deepEqual(turn.edits, []);
  assert.equal(admin.db.tools[0].spec.search.topK, 8);
});

test("runBuilderTurn: no processing model is a 422 before any model call", async () => {
  const admin = memoryAdmin(seed());
  const fake = fakeStreamText(async function* () {});
  await assert.rejects(
    runBuilderTurn({
      admin, projectId: PROJECT, tool: admin.db.tools[0], message: "hi",
      deps: deps(fake.fn, { getProcessingModel: async () => null }),
    }),
    (error) => error instanceof EngineError && error.code === "no_processing_model" && error.status === 422
      && /Settings → General/.test(error.message),
  );
  assert.equal(fake.calls.length, 0);
});

test("runBuilderTurn: a provider error after an edit keeps the edit and maps the error", async () => {
  const admin = memoryAdmin(seed());
  const fake = fakeStreamText(async function* (options, results) {
    await callTool(options, results, { search: { topK: 3 } });
    yield { type: "finish-step", usage: { inputTokens: 100, outputTokens: 5 } };
    yield { type: "error", error: Object.assign(new Error("rate limit: sk-secret-123456789"), { statusCode: 429 }) };
  });

  const turn = await runBuilderTurn({ admin, projectId: PROJECT, tool: admin.db.tools[0], message: "x", deps: deps(fake.fn) });

  assert.ok(turn.error instanceof EngineError);
  assert.equal(turn.error.code, "rate_limited");
  assert.ok(!turn.error.message.includes("sk-secret"));
  assert.equal(turn.edits.length, 1);
  assert.equal(admin.db.tools[0].spec.search.topK, 3);
  assert.equal(turn.usage.tokensIn, 100);
});

test("runBuilderTurn: a cancelled turn resolves as aborted with its partial text", async () => {
  const admin = memoryAdmin(seed());
  const controller = new AbortController();
  const fake = fakeStreamText(async function* () {
    yield { type: "text-delta", id: "t1", text: "Let me" };
    controller.abort();
    const error = new Error("aborted");
    error.name = "AbortError";
    throw error;
  });

  const turn = await runBuilderTurn({
    admin, projectId: PROJECT, tool: admin.db.tools[0], message: "x", signal: controller.signal, deps: deps(fake.fn),
  });

  assert.equal(turn.aborted, true);
  assert.equal(turn.error, null);
  assert.equal(turn.text, "Let me");
});

test("runBuilderTurn: a timeout abort the caller didn't ask for is an error", async () => {
  const admin = memoryAdmin(seed());
  const fake = fakeStreamText(async function* () {
    yield { type: "abort", reason: "first chunk timeout" };
  });
  const turn = await runBuilderTurn({ admin, projectId: PROJECT, tool: admin.db.tools[0], message: "x", deps: deps(fake.fn) });
  assert.equal(turn.aborted, false);
  assert.equal(turn.error?.code, "timeout");
});
