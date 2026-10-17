import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NO_PROCESSING_MODEL_MESSAGE, claimEvalRun, runEvalRun } from "./eval_runner.js";
import { PROJECT, jsonResponse, provider, stubFetch, uuid } from "./test_helpers.js";

// Local / custom provider URLs are opt-in (localProvidersAllowed); with the opt-in, custom
// URLs skip DNS and use the stubbed global fetch instead of the pinned transport.
process.env.GREY_ALLOW_LOCAL_PROVIDERS = "1";

globalThis.AI_SDK_LOG_WARNINGS = false;

const RUN = uuid(900);
const SET = uuid(901);
const PIPELINE = uuid(902);
const KB = uuid(903);
const USER = uuid(904);
const SRC_A = uuid(910);
const SRC_B = uuid(911);
const WORKER = "worker-1";

const answerProvider = provider(1, "openai_compatible", { base_url: "http://localhost:9000/v1", models: ["answer-model"] });
const judgeProvider = provider(2, "openai_compatible", { base_url: "http://localhost:8000/v1", models: ["judge-model"] });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// In-memory service-role client: enough of supabase-js's query builder for the engine modules
// the runner touches (select/eq/in/is/order/maybeSingle, insert, update … select).
function memoryAdmin(seed, { rpc = {}, failInsert = () => false } = {}) {
  const db = Object.fromEntries(Object.entries(seed).map(([table, rows]) => [table, rows.map((row) => ({ ...row }))]));
  const rpcCalls = [];
  const thenable = (result) => {
    const value = {
      then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
      abortSignal: () => value,
    };
    return value;
  };

  function builder(table) {
    const filters = [];
    const orders = [];
    let op = { type: "select" };
    const rows = () => (db[table] ||= []);
    const matches = () => rows().filter((row) => filters.every((f) => f(row)));
    const execute = () => {
      if (op.type === "insert") {
        if (failInsert(table)) return { data: null, error: { code: "XX000", message: "insert failed" } };
        const list = Array.isArray(op.payload) ? op.payload : [op.payload];
        rows().push(...list.map((row) => ({ id: randomUUID(), deleted_at: null, ...row })));
        return { data: null, error: null };
      }
      if (op.type === "update") {
        const hit = matches();
        for (const row of hit) Object.assign(row, op.patch);
        return { data: hit.map((row) => ({ id: row.id })), error: null };
      }
      let list = matches();
      for (const [column, ascending] of [...orders].reverse()) {
        list = [...list].sort((a, b) => (a[column] < b[column] ? -1 : a[column] > b[column] ? 1 : 0) * (ascending ? 1 : -1));
      }
      return { data: list.map((row) => ({ ...row })), error: null };
    };
    const query = {
      select: () => query,
      eq: (column, value) => (filters.push((row) => row[column] === value), query),
      in: (column, values) => (filters.push((row) => values.includes(row[column])), query),
      is: (column, value) => (filters.push((row) => (row[column] ?? null) === value), query),
      order: (column, { ascending = true } = {}) => (orders.push([column, ascending]), query),
      abortSignal: () => query,
      insert: (payload) => ((op = { type: "insert", payload }), query),
      update: (patch) => ((op = { type: "update", patch }), query),
      maybeSingle: async () => ({ data: matches()[0] ?? null, error: null }),
      then: (resolve, reject) => Promise.resolve(execute()).then(resolve, reject),
    };
    return query;
  }

  return {
    db,
    rpcCalls,
    from: (table) => builder(table),
    rpc: (name, params) => {
      rpcCalls.push({ name, params });
      if (rpc[name]) return thenable(rpc[name](params));
      if (name === "get_provider_secret") {
        const row = (db.model_providers || []).find((r) => r.id === params.p_provider && r.project_id === params.p_project);
        return thenable({ data: row ? `sk-${row.id.slice(-4)}-test` : null, error: null });
      }
      if (name === "match_chunks_text") {
        return thenable({
          data: [
            { chunk_id: "chunk-a", source_id: SRC_A, source_name: "Refund policy", kb_id: KB, content: "Refunds are issued within 5 days.", page: 1, start_ms: null, end_ms: null, heading_path: null, score: 0.9 },
            { chunk_id: "chunk-b", source_id: SRC_B, source_name: "Shipping", kb_id: KB, content: "Shipping is free over $50.", page: 3, start_ms: null, end_ms: null, heading_path: null, score: 0.4 },
          ],
          error: null,
        });
      }
      return thenable({ data: null, error: { code: "42883", message: `unknown rpc ${name}` } });
    },
  };
}

const cases = (n, extra = () => ({})) =>
  Array.from({ length: n }, (_, i) => ({
    id: uuid(800 + i),
    project_id: PROJECT,
    eval_set_id: SET,
    question: `Question ${i + 1}?`,
    expected_answer: null,
    expected_source_ids: [],
    created_at: `2026-10-18T00:00:0${i}Z`,
    deleted_at: null,
    ...extra(i),
  }));

function seed({ evalCases = cases(3), settings = true, runExtra = {} } = {}) {
  return {
    model_providers: [answerProvider, judgeProvider],
    project_settings: [
      {
        project_id: PROJECT,
        processing_provider_id: settings ? judgeProvider.id : null,
        processing_model: settings ? "judge-model" : null,
        deleted_at: null,
      },
    ],
    pipelines: [
      {
        id: PIPELINE,
        project_id: PROJECT,
        kb_ids: [KB],
        provider_id: answerProvider.id,
        model: "answer-model",
        temperature: null,
        max_tokens: null,
        system_prompt: "",
        retrieval: { graphMode: "off" },
        status: "draft",
        current_version: 0,
        metadata: {},
        deleted_at: null,
      },
    ],
    pipeline_versions: [],
    // No embedding connection: retrieval degrades to the text arm (match_chunks_text above).
    knowledge_bases: [{ id: KB, project_id: PROJECT, status: "active", embedding_provider_id: null, embedding_model: null, embedding_dims: null, deleted_at: null }],
    eval_cases: evalCases,
    eval_results: [],
    usage_events: [],
    eval_runs: [
      {
        id: RUN,
        project_id: PROJECT,
        eval_set_id: SET,
        pipeline_id: PIPELINE,
        pipeline_version: 0,
        status: "running",
        metrics: {},
        metadata: { note: "kept", error: "stale error from an earlier attempt" },
        locked_by: WORKER,
        locked_until: "2026-10-18T01:00:00Z",
        created_by: USER,
        deleted_at: null,
        ...runExtra,
      },
    ],
  };
}

const completion = (content, usage = { prompt_tokens: 100, completion_tokens: 20 }) =>
  jsonResponse({
    id: "cmpl",
    object: "chat.completion",
    created: 0,
    model: "m",
    choices: [{ index: 0, message: { role: "assistant", content: typeof content === "string" ? content : JSON.stringify(content) }, finish_reason: "stop" }],
    usage: { ...usage, total_tokens: usage.prompt_tokens + usage.completion_tokens },
  });

const userText = (call) => call.body.messages.find((m) => m.role === "user").content;
const questionOf = (call) => userText(call).match(/<question>\n([\s\S]*?)\n<\/question>/)?.[1];

const goodJudgement = () => ({
  claims: [{ statement: "Refunds take 5 days.", supported: true }],
  answerRelevance: 0.9,
  passages: [
    { index: 1, relevant: true },
    { index: 2, relevant: false },
  ],
  expectedStatements: [
    { statement: "Refunds take five days.", supported: true },
    { statement: "Refunds need a receipt.", supported: false },
  ],
});

// answer(call) / judge(call, question) -> Response. Tracks how many LLM calls overlap.
function llmFetch({ answer = () => completion("Refunds take 5 days [1]."), judge = () => completion(goodJudgement()) } = {}) {
  const stats = { inFlight: 0, maxInFlight: 0, answers: 0, judges: 0 };
  const stub = stubFetch(async (url, init, index, call) => {
    stats.inFlight += 1;
    stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
    try {
      await sleep(10);
      if (url === "http://localhost:9000/v1/chat/completions") {
        stats.answers += 1;
        return await answer(call);
      }
      if (url === "http://localhost:8000/v1/chat/completions") {
        stats.judges += 1;
        return await judge(call, questionOf(call));
      }
      throw new Error(`unexpected fetch ${url}`);
    } finally {
      stats.inFlight -= 1;
    }
  });
  return { stub, stats };
}

const claimedRun = (admin) => ({ ...admin.db.eval_runs[0] });

test("claimEvalRun leases through claim_eval_run and returns the row or null", async () => {
  const row = { id: RUN, status: "running", locked_by: WORKER };
  const admin = memoryAdmin({}, { rpc: { claim_eval_run: () => ({ data: [row], error: null }) } });
  assert.deepEqual(await claimEvalRun({ admin, workerId: WORKER, leaseSeconds: 300 }), row);
  assert.deepEqual(admin.rpcCalls[0], { name: "claim_eval_run", params: { p_worker: WORKER, p_lease_seconds: 300 } });

  await claimEvalRun({ admin, workerId: WORKER, leaseSeconds: 120, maxPerProject: 2 });
  assert.deepEqual(admin.rpcCalls[1].params, { p_worker: WORKER, p_lease_seconds: 120, p_max_per_project: 2 });

  const empty = memoryAdmin({}, { rpc: { claim_eval_run: () => ({ data: [], error: null }) } });
  assert.equal(await claimEvalRun({ admin: empty, workerId: WORKER, leaseSeconds: 300 }), null);

  const broken = memoryAdmin({}, { rpc: { claim_eval_run: () => ({ data: null, error: { code: "57P01" } }) } });
  await assert.rejects(claimEvalRun({ admin: broken, workerId: WORKER, leaseSeconds: 300 }), { name: "EngineError", code: "service_unavailable" });
});

test("runEvalRun answers and judges every case, then stores results, metrics and usage", async () => {
  const evalCases = cases(4, (i) => {
    if (i === 0) return { expected_source_ids: [SRC_A, uuid(999)] }; // source-based precision/recall
    if (i === 1) return { expected_answer: "Five days, with a receipt." }; // judge labels + expected statements
    return {}; // judge-labelled precision, no recall
  });
  const admin = memoryAdmin(seed({ evalCases }));
  const { stub, stats } = llmFetch();
  try {
    const result = await runEvalRun({ admin, run: claimedRun(admin), signal: new AbortController().signal });
    assert.equal(result.status, "completed");

    assert.equal(stats.answers, 4);
    assert.equal(stats.judges, 4);
    assert.equal(stats.maxInFlight, 2, "cases run two at a time");

    const judgeCalls = stub.calls.filter((c) => c.url.startsWith("http://localhost:8000/"));
    const caseOneJudge = judgeCalls.find((c) => questionOf(c) === "Question 1?");
    assert.doesNotMatch(userText(caseOneJudge), /reference_answer/);
    assert.doesNotMatch(caseOneJudge.body.messages[0].content, /passages: for each passage/);
    const caseTwoJudge = judgeCalls.find((c) => questionOf(c) === "Question 2?");
    assert.match(userText(caseTwoJudge), /<reference_answer>\nFive days, with a receipt\.\n<\/reference_answer>/);
    assert.match(userText(caseTwoJudge), /\[1\] Refund policy — p\. 1\nRefunds are issued within 5 days\./);

    const results = admin.db.eval_results;
    assert.equal(results.length, 4);
    const byCase = Object.fromEntries(results.map((r) => [r.eval_case_id, r]));
    assert.deepEqual(byCase[evalCases[0].id].scores, { faithfulness: 1, answerRelevance: 0.9, contextPrecision: 1, contextRecall: 0.5 });
    assert.deepEqual(byCase[evalCases[1].id].scores, { faithfulness: 1, answerRelevance: 0.9, contextPrecision: 1, contextRecall: 0.5 });
    assert.deepEqual(byCase[evalCases[2].id].scores, { faithfulness: 1, answerRelevance: 0.9, contextPrecision: 1, contextRecall: null });

    const first = byCase[evalCases[0].id];
    assert.equal(first.project_id, PROJECT);
    assert.equal(first.eval_run_id, RUN);
    assert.equal(first.created_by, USER);
    assert.equal(first.answer, "Refunds take 5 days [1].");
    assert.equal(first.metadata.citations[0].sourceId, SRC_A);
    assert.deepEqual(first.metadata.retrieved.map((r) => [r.chunkId, r.sourceId, r.rank, r.sourceName]), [
      ["chunk-a", SRC_A, 1, "Refund policy"],
      ["chunk-b", SRC_B, 2, "Shipping"],
    ]);
    assert.ok(first.metadata.retrieved.every((r) => !("content" in r)), "no chunk content in results");
    assert.deepEqual(first.metadata.usage, { answer: { tokensIn: 100, tokensOut: 20 }, judge: { tokensIn: 100, tokensOut: 20 } });
    assert.deepEqual(first.metadata.basis, { contextPrecision: "sources", contextRecall: "sources" });
    assert.equal(byCase[evalCases[1].id].metadata.basis.contextRecall, "expected_answer");

    const run = admin.db.eval_runs[0];
    assert.equal(run.status, "completed");
    assert.equal(run.locked_by, null);
    assert.equal(run.locked_until, null);
    assert.deepEqual(run.metrics, {
      faithfulness: 1,
      answerRelevance: 0.9,
      contextPrecision: 1,
      contextRecall: 0.5,
      cases: 4,
      failed: 0,
    });
    assert.equal(run.metadata.note, "kept");
    assert.equal(run.metadata.error, undefined, "a completed run clears an earlier error");
    assert.equal(run.metadata.resolvedVersion, 0);
    assert.deepEqual(run.metadata.judge, { model: "judge-model", provider: "openai_compatible" });

    const usage = admin.db.usage_events;
    assert.equal(usage.length, 2);
    for (const row of usage) {
      assert.equal(row.kind, "llm_tokens");
      assert.equal(row.cost, 0);
      assert.equal(row.unit_cost, 0);
      assert.equal(row.quantity, 4 * 120);
      assert.equal(row.ref_type, "eval_run");
      assert.equal(row.ref_id, RUN);
      assert.equal(row.created_by, USER);
      assert.equal(row.metadata.byok, true);
      assert.equal(row.metadata.purpose, "eval");
    }
    assert.deepEqual(usage.map((u) => [u.metadata.stage, u.metadata.model]).sort(), [
      ["answer", "answer-model"],
      ["judge", "judge-model"],
    ]);
    assert.equal(admin.db.request_logs, undefined, "evals write no request_logs");
  } finally {
    stub.restore();
  }
});

test("runEvalRun fails the run when no processing model is set", async () => {
  const admin = memoryAdmin(seed({ settings: false }));
  const { stub, stats } = llmFetch();
  try {
    const result = await runEvalRun({ admin, run: claimedRun(admin) });
    assert.equal(result.status, "failed");
    assert.equal(result.error, NO_PROCESSING_MODEL_MESSAGE);
    assert.equal(stats.answers + stats.judges, 0);
    const run = admin.db.eval_runs[0];
    assert.equal(run.status, "failed");
    assert.equal(run.metadata.error, "Set a processing model in Settings → General.");
    assert.deepEqual(run.metrics, { faithfulness: null, answerRelevance: null, contextPrecision: null, contextRecall: null, cases: 3, failed: 3 });
    assert.equal(admin.db.eval_results.length, 0);
  } finally {
    stub.restore();
  }
});

test("runEvalRun counts a failed judgement and keeps source-based scores", async () => {
  const evalCases = cases(3, (i) => (i === 1 ? { expected_source_ids: [SRC_B] } : {}));
  const admin = memoryAdmin(seed({ evalCases }));
  const { stub } = llmFetch({
    judge: (call, question) => (question === "Question 2?" ? completion("I'd rather not score this.") : completion(goodJudgement())),
  });
  try {
    const result = await runEvalRun({ admin, run: claimedRun(admin) });
    assert.equal(result.status, "completed");
    const run = admin.db.eval_runs[0];
    assert.equal(run.metrics.cases, 3);
    assert.equal(run.metrics.failed, 1);
    assert.equal(run.metrics.faithfulness, 1);

    const failed = admin.db.eval_results.find((r) => r.eval_case_id === evalCases[1].id);
    assert.equal(failed.answer, "Refunds take 5 days [1].");
    assert.equal(failed.metadata.error.stage, "judge");
    assert.equal(failed.metadata.error.code, "judge_invalid_output");
    // SRC_B is retrieved at rank 2 of 2.
    assert.deepEqual(failed.scores, { faithfulness: null, answerRelevance: null, contextPrecision: 0.5, contextRecall: 1 });
  } finally {
    stub.restore();
  }
});

test("runEvalRun stops on an error every case would hit and fails the run", async () => {
  const admin = memoryAdmin(seed({ evalCases: cases(5) }));
  const { stub, stats } = llmFetch({
    answer: () => jsonResponse({ error: { message: "Invalid API key sk-should-never-leak" } }, 401),
  });
  try {
    const result = await runEvalRun({ admin, run: claimedRun(admin) });
    assert.equal(result.status, "failed");
    assert.ok(stats.answers <= 3, `stopped early (${stats.answers} answer calls)`);
    assert.equal(stats.judges, 0);
    const run = admin.db.eval_runs[0];
    assert.equal(run.status, "failed");
    assert.equal(run.metrics.cases, 5);
    assert.equal(run.metrics.failed, 5, "cases that never ran count as failed");
    assert.match(run.metadata.error, /rejected the API key/);
    assert.doesNotMatch(JSON.stringify(admin.db.eval_results), /sk-should-never-leak/);
    assert.ok(admin.db.eval_results.every((r) => r.metadata.error.stage === "answer" && r.metadata.error.code === "provider_auth"));
  } finally {
    stub.restore();
  }
});

test("runEvalRun marks the run failed when every case errors", async () => {
  const admin = memoryAdmin(seed({ evalCases: cases(2) }));
  const { stub } = llmFetch({ judge: () => completion("not json at all") });
  try {
    const result = await runEvalRun({ admin, run: claimedRun(admin) });
    assert.equal(result.status, "failed");
    const run = admin.db.eval_runs[0];
    assert.equal(run.metrics.failed, 2);
    assert.equal(run.metadata.error, "The processing model's scores didn't match the expected format.");
  } finally {
    stub.restore();
  }
});

test("an aborted run stops without a terminal write and a later attempt resumes", async () => {
  const admin = memoryAdmin(seed({ evalCases: cases(3) }));
  const controller = new AbortController();
  const { stub } = llmFetch({
    answer: async (call) => {
      // Case 3 only starts once case 1 is stored; abort as it begins, while the slower case 2 is
      // still in flight.
      if (/Question: Question 2\?/.test(userText(call))) await sleep(80);
      if (/Question: Question 3\?/.test(userText(call))) controller.abort(Object.assign(new Error("shutdown"), { code: "shutdown" }));
      return completion("Refunds take 5 days [1].");
    },
  });
  try {
    const result = await runEvalRun({ admin, run: claimedRun(admin), signal: controller.signal });
    assert.deepEqual(result, { status: "aborted", reason: "shutdown" });
    assert.equal(admin.db.eval_runs[0].status, "running", "no terminal write after an abort");
    assert.deepEqual(admin.db.eval_results.map((r) => r.eval_case_id), [uuid(800)]);
  } finally {
    stub.restore();
  }

  const retry = llmFetch();
  try {
    const result = await runEvalRun({ admin, run: claimedRun(admin), signal: new AbortController().signal });
    assert.equal(result.status, "completed");
    assert.equal(retry.stats.answers, 2, "only the cases without a result run again");
    assert.deepEqual(admin.db.eval_results.map((r) => r.eval_case_id).sort(), [uuid(800), uuid(801), uuid(802)]);
    assert.equal(admin.db.eval_runs[0].metrics.cases, 3);
    assert.equal(admin.db.eval_runs[0].metrics.failed, 0);
  } finally {
    retry.stub.restore();
  }
});

test("a run whose lease moved to another worker isn't overwritten", async () => {
  const admin = memoryAdmin(seed({ evalCases: cases(1) }));
  const run = claimedRun(admin);
  admin.db.eval_runs[0].locked_by = "worker-2";
  const { stub } = llmFetch();
  try {
    const result = await runEvalRun({ admin, run });
    assert.deepEqual(result, { status: "lost" });
    assert.equal(admin.db.eval_runs[0].status, "running");
    assert.equal(admin.db.eval_runs[0].locked_by, "worker-2");

    // The worker passes its own id; it decides the guard over the row's snapshot.
    assert.deepEqual(await runEvalRun({ admin, run, workerId: "worker-3" }), { status: "lost" });
    const owned = await runEvalRun({ admin, run, workerId: "worker-2" });
    assert.equal(owned.status, "completed");
    assert.equal(admin.db.eval_runs[0].status, "completed");
  } finally {
    stub.restore();
  }
});

test("an empty eval set fails with a clear message", async () => {
  const admin = memoryAdmin(seed({ evalCases: [] }));
  const result = await runEvalRun({ admin, run: claimedRun(admin) });
  assert.equal(result.status, "failed");
  assert.match(admin.db.eval_runs[0].metadata.error, /no cases/);
});
