// Eval runner (spec §13), dispatched by the worker's `eval` queue. A claimed eval run answers each
// case of its set through the shared pipeline turn (channel 'eval', non-stream, two at a time, no
// request_logs), judges every answer on the project's processing model with structured output, and
// stores eval_results rows plus null-ignoring means in eval_runs.metrics.
// Shared server runtime (worker + Next): relative imports only; the caller passes the service-role
// `admin` client (schema grey).
import { generateText, NoObjectGeneratedError, NoOutputGeneratedError, Output } from "ai";
import { EngineError, isEngineError } from "./errors.js";
import { getProcessingModel } from "./llm.js";
import { resolvePipelineConfig } from "./pipeline_config.js";
import { runPipelineTurn } from "./turn.js";
import { recordUsage, toRetrievedLog } from "./usage.js";
import { runOrdered } from "../grey/batch.js";
import { mapLlmError } from "../grey/llm_errors.js";
import { isTemperatureRejection } from "../grey/model_caps.js";
import {
  METRIC_KEYS,
  aggregateMetrics,
  buildJudgePrompt,
  buildJudgeSchema,
  judgePlan,
  normalizeJudgement,
  parseJudgeText,
  scoreCase,
} from "../grey/eval_metrics.js";

export const NO_PROCESSING_MODEL_MESSAGE = "Set a processing model in Settings → General.";

const CASE_CONCURRENCY = 2;
const JUDGE_MAX_OUTPUT_TOKENS = 4096;
const JUDGE_TIMEOUT_MS = 120_000;
const HEARTBEAT_INTERVAL_MS = 20_000;

// Failures every remaining case would hit too: the run stops instead of spending more tokens.
const FATAL_TURN_CODES = new Set([
  "hosted_unavailable",
  "no_provider",
  "provider_not_found",
  "no_key",
  "capability_missing",
  "no_model",
  "no_base_url",
  "unsafe_base_url",
  "provider_auth",
  "model_not_found",
]);
const FATAL_JUDGE_CODES = new Set(["provider_auth", "model_not_found", "bad_request"]);

const zeroUsage = () => ({ tokensIn: 0, tokensOut: 0 });
const emptyScores = () => Object.fromEntries(METRIC_KEYS.map((key) => [key, null]));
const tokensOf = (usage) => ({ tokensIn: Number(usage?.inputTokens) || 0, tokensOut: Number(usage?.outputTokens) || 0 });

function addUsage(total, usage) {
  for (const stage of ["answer", "judge"]) {
    total[stage].tokensIn += Number(usage?.[stage]?.tokensIn) || 0;
    total[stage].tokensOut += Number(usage?.[stage]?.tokensOut) || 0;
  }
  return total;
}

const serviceError = () =>
  new EngineError("service_unavailable", "The evaluation couldn't load its data — try again.", { status: 503, retryable: true });

/**
 * Leases the next queued eval run (or one whose worker's lease expired) through
 * grey.claim_eval_run(p_worker, p_lease_seconds, p_max_per_project).
 * @returns {Promise<object|null>} the claimed eval_runs row (snake_case), or null when none is due
 * @throws {EngineError} service_unavailable when the claim itself fails
 */
export async function claimEvalRun({ admin, workerId, leaseSeconds = 300, maxPerProject } = {}) {
  const params = { p_worker: workerId, p_lease_seconds: leaseSeconds };
  if (maxPerProject !== undefined && maxPerProject !== null) params.p_max_per_project = maxPerProject;
  const { data, error } = await admin.rpc("claim_eval_run", params);
  if (error) {
    console.error("[engine.eval_runner.claim]", error.code || error.message);
    throw new EngineError("service_unavailable", "Couldn't claim an eval run.", { status: 503, retryable: true });
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row?.id ? row : null;
}

async function loadCases(admin, run) {
  const { data, error } = await admin
    .from("eval_cases")
    .select("id,question,expected_answer,expected_source_ids")
    .eq("project_id", run.project_id)
    .eq("eval_set_id", run.eval_set_id)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) {
    console.error("[engine.eval_runner.cases]", error.code || error.message);
    throw serviceError();
  }
  return data || [];
}

// Results an earlier attempt of this run already wrote (a reclaimed run resumes, never repeats).
async function loadResults(admin, run) {
  const { data, error } = await admin
    .from("eval_results")
    .select("eval_case_id,scores,metadata")
    .eq("project_id", run.project_id)
    .eq("eval_run_id", run.id)
    .is("deleted_at", null);
  if (error) {
    console.error("[engine.eval_runner.results]", error.code || error.message);
    throw serviceError();
  }
  return new Map((data || []).map((row) => [row.eval_case_id, row]));
}

async function insertResult(admin, run, testCase, value) {
  const { error } = await admin.from("eval_results").insert({
    project_id: run.project_id,
    eval_run_id: run.id,
    eval_case_id: testCase.id,
    answer: value.answer,
    scores: value.scores,
    metadata: value.metadata,
    ...(run.created_by ? { created_by: run.created_by } : {}),
  });
  if (error) {
    console.error("[engine.eval_runner.insertResult]", error.code || error.message);
    return false;
  }
  return true;
}

// Terminal write, guarded on this worker (`owner`) still holding the run's lease.
// -> { status, metrics, error } as written | { status: 'lost' } | { status: 'write_failed' }
async function finishRun(admin, run, owner, { status, error = null, metrics, details = {} }) {
  const metadata = {
    ...(run.metadata && typeof run.metadata === "object" ? run.metadata : {}),
    ...details,
    finishedAt: new Date().toISOString(),
  };
  delete metadata.error;
  if (error) metadata.error = error;

  let query = admin
    .from("eval_runs")
    .update({ status, metrics, metadata, locked_by: null, locked_until: null })
    .eq("id", run.id)
    .eq("status", "running");
  if (owner) query = query.eq("locked_by", owner);
  const { data, error: dbError } = await query.select("id");
  if (dbError) {
    // The lease expires and the run is reclaimed; it resumes from the results already written.
    console.error("[engine.eval_runner.finish]", dbError.code || dbError.message);
    return { status: "write_failed" };
  }
  if (!data?.length) return { status: "lost" };
  return { status, metrics, error };
}

// User-safe { code, message } for a failed pipeline turn (EngineError messages are safe by construction).
function describeTurnError(error) {
  if (isEngineError(error)) return { code: error.code, message: error.message };
  const mapped = mapLlmError(error);
  return { code: mapped.code, message: mapped.message };
}

function describeJudgeError(error) {
  if (NoObjectGeneratedError.isInstance(error) || NoOutputGeneratedError.isInstance(error)) {
    return { code: "judge_invalid_output", message: "The processing model's scores didn't match the expected format.", fatal: false };
  }
  const mapped = mapLlmError(error);
  return { code: mapped.code, message: `Processing model: ${mapped.message}`, fatal: FATAL_JUDGE_CODES.has(mapped.code) };
}

// One retry without sampling params when the provider rejects `temperature`.
async function generateJudgement(call, temperature) {
  try {
    return await generateText({ ...call, ...(temperature === undefined ? {} : { temperature }) });
  } catch (error) {
    if (temperature === undefined || !isTemperatureRejection(error)) throw error;
    return generateText(call);
  }
}

// -> { judgement, usage } | { error: { code, message, fatal }, usage }. Never throws.
async function judgeAnswer({ judge, question, answer, retrieved, facts, expectedAnswer, plan, signal }) {
  const { instructions, prompt, chunks } = buildJudgePrompt({
    question,
    answer,
    chunks: retrieved,
    facts,
    expectedAnswer,
    labelPassages: plan.labelPassages,
    checkExpected: plan.checkExpected,
  });
  const shape = {
    passageCount: chunks.length,
    labelPassages: plan.labelPassages && chunks.length > 0,
    checkExpected: plan.checkExpected,
  };
  try {
    const result = await generateJudgement(
      {
        model: judge.model,
        instructions,
        prompt,
        output: Output.object({
          schema: buildJudgeSchema(shape),
          name: "eval_judgement",
          description: "Claim support, answer relevance and passage labels for one evaluated answer.",
        }),
        maxOutputTokens: JUDGE_MAX_OUTPUT_TOKENS,
        timeout: { totalMs: JUDGE_TIMEOUT_MS },
        abortSignal: signal,
        maxRetries: 2,
      },
      judge.supportsTemperature === false ? undefined : 0,
    );
    const usage = tokensOf(result.usage);
    try {
      return { judgement: normalizeJudgement(result.output, shape), usage };
    } catch (error) {
      return { error: describeJudgeError(error), usage };
    }
  } catch (error) {
    const usage = tokensOf(error?.usage);
    if (NoObjectGeneratedError.isInstance(error)) {
      const raw = parseJudgeText(error.text);
      if (raw) return { judgement: normalizeJudgement(raw, shape), usage };
    }
    return { error: describeJudgeError(error), usage };
  }
}

// One case: pipeline turn → judge → scores. Resolves (never rejects) to
// { answer, scores, metadata, usage, model, failed, fatal } — `fatal` is a message when every
// remaining case would fail the same way.
async function evaluateCase({ admin, projectId, config, judge, testCase, signal }) {
  const expectedSourceIds = Array.isArray(testCase.expected_source_ids) ? testCase.expected_source_ids : [];
  const usage = { answer: zeroUsage(), judge: zeroUsage() };

  let turn;
  try {
    turn = await runPipelineTurn({
      admin,
      projectId,
      config,
      query: testCase.question,
      history: [],
      channel: "eval",
      stream: false,
      abortSignal: signal,
    });
  } catch (error) {
    const described = describeTurnError(error);
    if (!signal?.aborted) console.error("[engine.eval_runner.turn]", described.code);
    return {
      answer: null,
      scores: emptyScores(),
      metadata: { usage, error: { stage: "answer", ...described } },
      usage,
      model: null,
      failed: true,
      fatal: FATAL_TURN_CODES.has(described.code) ? described.message : null,
    };
  }

  usage.answer = { tokensIn: Number(turn.usage?.tokensIn) || 0, tokensOut: Number(turn.usage?.tokensOut) || 0 };
  const retrieved = Array.isArray(turn.retrieved) ? turn.retrieved : [];
  const plan = judgePlan({ expectedSourceIds, expectedAnswer: testCase.expected_answer, retrievedCount: retrieved.length });
  const judged = await judgeAnswer({
    judge,
    question: testCase.question,
    answer: turn.text,
    retrieved,
    facts: turn.retrievalMeta?.facts || [],
    expectedAnswer: testCase.expected_answer,
    plan,
    signal,
  });
  usage.judge = judged.usage;
  if (judged.error && !signal?.aborted) console.error("[engine.eval_runner.judge]", judged.error.code);

  const { scores, basis } = scoreCase({ retrieved, expectedSourceIds, judgement: judged.judgement ?? null });
  const metadata = {
    citations: turn.citations || [],
    retrieved: toRetrievedLog(retrieved).map((entry, i) => ({ ...entry, sourceName: retrieved[i]?.sourceName ?? null })),
    usage,
    noContext: Boolean(turn.noContext),
    retrievalOnly: Boolean(turn.retrievalOnly),
    basis,
    timings: turn.timings ?? null,
    ...(judged.judgement ? { judgement: judged.judgement } : {}),
    ...(judged.error ? { error: { stage: "judge", code: judged.error.code, message: judged.error.message } } : {}),
  };
  return {
    answer: turn.text ?? "",
    scores,
    metadata,
    usage,
    model: turn.model?.id ? turn.model : null,
    failed: Boolean(judged.error),
    fatal: judged.error?.fatal ? judged.error.message : null,
  };
}

// usage_events: one llm_tokens row per stage for this attempt, at cost 0 on the customer's own
// providers (spec §11). Evals write no request_logs.
async function recordEvalUsage(admin, run, { usage, answerModel, judge }) {
  const stages = [
    { stage: "answer", usage: usage.answer, model: answerModel?.id ?? null, provider: answerModel?.provider ?? null },
    { stage: "judge", usage: usage.judge, model: judge.modelId ?? null, provider: judge.providerKind ?? null },
  ];
  for (const { stage, usage: tokens, model, provider } of stages) {
    const quantity = tokens.tokensIn + tokens.tokensOut;
    if (quantity <= 0) continue;
    await recordUsage({
      admin,
      projectId: run.project_id,
      kind: "llm_tokens",
      quantity,
      unitCost: 0,
      cost: 0,
      refType: "eval_run",
      refId: run.id,
      metadata: {
        byok: true,
        purpose: "eval",
        stage,
        tokensIn: tokens.tokensIn,
        tokensOut: tokens.tokensOut,
        model,
        provider,
        pipelineId: run.pipeline_id ?? null,
        evalSetId: run.eval_set_id ?? null,
      },
      createdBy: run.created_by ?? null,
    });
  }
}

/**
 * Runs one claimed eval run to completion: every case through runPipelineTurn (channel 'eval'),
 * judged on the project's processing model, eval_results written, metrics aggregated into
 * eval_runs.metrics { faithfulness, answerRelevance, contextPrecision, contextRecall, cases, failed }
 * and the run marked completed (or failed when every case errored or the run can't start).
 * Per-case failures never throw — they are stored on the case's result and counted in
 * metrics.failed. The error message for a failed run is stored in eval_runs.metadata.error.
 *
 * Aborting `signal` (shutdown, lost lease) stops between cases without a terminal write; the worker
 * releases the run and a later attempt resumes from the results already written.
 *
 * @param {object} args
 * @param {object} args.admin        service-role Supabase client (schema grey)
 * @param {object} args.run          the claimed eval_runs row (snake_case)
 * @param {string} [args.workerId]   lease holder the terminal write is guarded on (default run.locked_by)
 * @param {AbortSignal} [args.signal]
 * @param {() => Promise<string|boolean|void>} [args.heartbeat]  optional lease check between cases;
 *   'running' / true / undefined keeps going, any other status or false stops the run
 * @returns {Promise<{ status: 'completed'|'failed'|'aborted'|'lost'|'write_failed', metrics?, error? }>}
 */
export async function runEvalRun({ admin, run, workerId, signal, heartbeat } = {}) {
  const projectId = run?.project_id;
  const owner = workerId || run?.locked_by || null;
  const startedAt = new Date().toISOString();
  const lease = { lost: false, lastBeatAt: Date.now() };
  const stopped = () => Boolean(signal?.aborted) || lease.lost;
  const aborted = () => ({ status: "aborted", reason: lease.lost ? "lease_lost" : signal?.reason?.code || "aborted" });

  async function beat() {
    if (typeof heartbeat !== "function" || Date.now() - lease.lastBeatAt < HEARTBEAT_INTERVAL_MS) return;
    lease.lastBeatAt = Date.now();
    try {
      const status = await heartbeat();
      if (status === false || (typeof status === "string" && status !== "running")) lease.lost = true;
    } catch (error) {
      // The worker loop heartbeats on its own schedule too; one failed extra beat isn't fatal.
      console.error("[engine.eval_runner.heartbeat]", error?.code || error?.message);
    }
  }

  let caseCount = 0;
  try {
    const cases = await loadCases(admin, run);
    caseCount = cases.length;
    const fail = (message) =>
      finishRun(admin, run, owner, {
        status: "failed",
        error: message,
        metrics: aggregateMetrics([], { cases: caseCount, failed: caseCount }),
        details: { startedAt },
      });

    if (!cases.length) return await fail("This eval set has no cases — add some and run it again.");

    let judge;
    try {
      judge = await getProcessingModel({ admin, projectId });
    } catch (error) {
      return await fail(isEngineError(error) ? `Processing model: ${error.message}` : NO_PROCESSING_MODEL_MESSAGE);
    }
    if (!judge?.model) return await fail(NO_PROCESSING_MODEL_MESSAGE);

    if (!run.pipeline_id) return await fail("This run's pipeline was deleted.");
    let config;
    try {
      config = await resolvePipelineConfig({
        admin,
        projectId,
        pipelineId: run.pipeline_id,
        channel: "eval",
        version: run.pipeline_version,
      });
    } catch (error) {
      if (error?.code === "pipeline_not_found") return await fail("This run's pipeline was deleted.");
      return await fail(isEngineError(error) ? error.message : "The pipeline couldn't be loaded.");
    }

    const existing = await loadResults(admin, run);
    const outcomes = cases
      .filter((testCase) => existing.has(testCase.id))
      .map((testCase) => {
        const row = existing.get(testCase.id);
        return { scores: row.scores, failed: Boolean(row.metadata?.error), usage: row.metadata?.usage, error: row.metadata?.error?.message };
      });
    const todo = cases.filter((testCase) => !existing.has(testCase.id));
    const attemptUsage = { answer: zeroUsage(), judge: zeroUsage() };
    let answerModel = null;
    let fatal = null;

    await runOrdered(todo.length, {
      concurrency: CASE_CONCURRENCY,
      shouldStop: () => Boolean(fatal) || stopped(),
      start: (index) => evaluateCase({ admin, projectId, config, judge, testCase: todo[index], signal }),
      settle: async (index, outcome) => {
        const value = outcome.ok
          ? outcome.value
          : {
              answer: null,
              scores: emptyScores(),
              metadata: { error: { stage: "answer", code: "case_failed", message: "This case failed unexpectedly." } },
              usage: { answer: zeroUsage(), judge: zeroUsage() },
              model: null,
              failed: true,
              fatal: null,
            };
        if (!outcome.ok) console.error("[engine.eval_runner.case]", outcome.error?.code || outcome.error?.name);
        addUsage(attemptUsage, value.usage);
        answerModel ??= value.model;
        // A case cut short by an abort isn't a real result — the next attempt runs it again.
        if (stopped()) return false;

        if (!(await insertResult(admin, run, todo[index], value))) {
          fatal = "The evaluation couldn't save its results — try again.";
          return false;
        }
        outcomes.push({ scores: value.scores, failed: value.failed, usage: value.usage, error: value.metadata?.error?.message });
        if (value.fatal) fatal ??= value.fatal;
        await beat();
        return !fatal && !stopped();
      },
    });

    await recordEvalUsage(admin, run, { usage: attemptUsage, answerModel, judge });
    if (stopped()) return aborted();

    // Cases never run (a fatal error stopped the run) count as failed.
    const failed = outcomes.filter((o) => o.failed).length + (cases.length - outcomes.length);
    const metrics = aggregateMetrics(
      outcomes.map((o) => o.scores),
      { cases: cases.length, failed },
    );
    const error =
      fatal ?? (failed >= cases.length ? outcomes.find((o) => o.error)?.error || "Every case in this run failed." : null);
    return await finishRun(admin, run, owner, {
      status: error ? "failed" : "completed",
      error,
      metrics,
      details: {
        startedAt,
        resolvedVersion: config.version,
        judge: { model: judge.modelId ?? null, provider: judge.providerKind ?? null },
        usage: outcomes.reduce((total, o) => addUsage(total, o.usage), { answer: zeroUsage(), judge: zeroUsage() }),
      },
    });
  } catch (error) {
    if (stopped()) return aborted();
    console.error("[engine.eval_runner.run]", error?.code || error?.message);
    try {
      return await finishRun(admin, run, owner, {
        status: "failed",
        error: isEngineError(error) ? error.message : "The evaluation failed unexpectedly.",
        metrics: aggregateMetrics([], { cases: caseCount, failed: caseCount }),
        details: { startedAt },
      });
    } catch (writeError) {
      console.error("[engine.eval_runner.finish]", writeError?.message);
      return { status: "write_failed" };
    }
  }
}
