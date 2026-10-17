// Knowledge-graph extraction stage (spec §10.1) and the orphan sweep (§10.3).
// Shared server runtime (Next routes + worker): relative imports only; the caller passes the
// service-role `admin` client. Graph tokens are metered by the caller from the returned `tokens`.
import { generateText, NoObjectGeneratedError, Output } from "ai";
import { isEngineError } from "./errors.js";
import { getProcessingModel } from "./llm.js";
import { batchByTokens, estimateTokens, runOrdered } from "../grey/batch.js";
import { mapLlmError } from "../grey/llm_errors.js";
import {
  DEFAULT_MIN_CONFIDENCE,
  MAX_SEEN_NAMES,
  buildExtractionPrompt,
  extractionSchema,
  ontologyFromTypes,
  sanitizeExtraction,
} from "../grey/graph_schema.js";

const BATCH_TOKENS = 6000;
const MIN_CHUNK_TOKENS = 20;
const DEFAULT_MAX_TOKENS_PER_SOURCE = 300_000;
const CONCURRENCY = 3;
const MAX_OUTPUT_TOKENS = 4096;
const CALL_TIMEOUT_MS = 120_000;

const warning = (code, message) => ({ stage: "graph", code, message });

function chunkTokens(chunk) {
  const stored = Number(chunk?.token_count);
  return Number.isFinite(stored) && stored > 0 ? stored : estimateTokens(chunk?.content);
}

function usageTokens(usage) {
  if (!usage) return 0;
  const input = Number(usage.inputTokens) || 0;
  const output = Number(usage.outputTokens) || 0;
  return input + output || Number(usage.totalTokens) || 0;
}

function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Last resort when the model's JSON didn't validate: sanitizeExtraction accepts any shape.
function parseLooseJson(text) {
  if (typeof text !== "string") return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(text.slice(start, end + 1));
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function modelUnavailableMessage(error) {
  if (isEngineError(error) && error.message) return `Knowledge graph skipped: ${error.message}`;
  return "Knowledge graph skipped: the processing model couldn't be loaded — check it in Settings → General.";
}

// Failures every remaining batch would hit too (bad key, unknown model, rejected request shape).
const FATAL_LLM_CODES = new Set(["provider_auth", "model_not_found", "bad_request"]);

// User-facing description of an LLM failure — never raw provider text. `fatal` stops the remaining
// batches.
function describeLlmError(error) {
  if (NoObjectGeneratedError.isInstance(error)) {
    return { fatal: false, message: "The processing model returned output that didn't match the graph format." };
  }
  const mapped = mapLlmError(error);
  return { fatal: FATAL_LLM_CODES.has(mapped.code), message: `Processing model: ${mapped.message}` };
}

// One LLM call. Resolves (never rejects) to { raw, chunkRefs, tokens } or { error, tokens }.
async function extractBatch({ resolved, ontology, batch, seenNames, signal }) {
  const { instructions, prompt, chunkRefs } = buildExtractionPrompt(ontology, batch, seenNames);
  try {
    const result = await generateText({
      model: resolved.model,
      instructions,
      prompt,
      output: Output.object({
        schema: extractionSchema,
        name: "knowledge_graph",
        description: "Entities and relations found in the excerpts.",
      }),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      ...(resolved.supportsTemperature ? { temperature: 0 } : {}),
      timeout: CALL_TIMEOUT_MS,
      abortSignal: signal,
    });
    const tokens = usageTokens(result.totalUsage ?? result.usage);
    try {
      return { raw: result.output, chunkRefs, tokens };
    } catch (error) {
      return { error, tokens };
    }
  } catch (error) {
    const tokens = usageTokens(error?.usage);
    if (NoObjectGeneratedError.isInstance(error)) {
      const raw = parseLooseJson(error.text);
      if (raw) return { raw, chunkRefs, tokens };
    }
    return { error, tokens };
  }
}

/**
 * Extracts entities and relations from a source's live chunks and stores them through
 * grey.kg_upsert_extracted (entity resolution happens in SQL). Never throws: problems are returned
 * as warnings ({ stage: 'graph', code, message }) and never fail the ingestion job.
 *
 * Call it after the chunk swap, and call sweepGraphOrphans after it — re-extraction must find the
 * source's previous entities still live to keep their ids.
 *
 * @param {object} args
 * @param {object} args.admin       service-role Supabase client (schema grey)
 * @param {string} args.projectId
 * @param {string} args.sourceId
 * @param {string} [args.jobId]     recorded on the mentions it creates
 * @param {Array<{ id, content, page, start_ms, token_count }>} args.chunks  live chunk rows, in order
 * @param {{ maxTokensPerSource?: number, minConfidence?: number }} [args.config]  preset graph config
 * @param {AbortSignal} [args.signal]
 * @returns {Promise<{ ok: boolean, entities: number, relations: number, tokens: number, warnings: Array }>}
 */
export async function extractGraph({ admin, projectId, sourceId, jobId, chunks, config, signal }) {
  const warnings = [];
  const entityIds = new Set();
  const relationKeys = new Set();
  let tokens = 0;
  const finish = (ok) => ({ ok, entities: entityIds.size, relations: relationKeys.size, tokens, warnings });

  try {
    let resolved = null;
    try {
      resolved = await getProcessingModel({ admin, projectId });
    } catch (error) {
      warnings.push(warning("graph_unavailable", modelUnavailableMessage(error)));
      return finish(false);
    }
    if (!resolved?.model) {
      warnings.push(warning("graph_unavailable", "Knowledge graph skipped: set a processing model in Settings → General."));
      return finish(false);
    }

    const { data: typeRows, error: ontologyError } = await admin.rpc("ensure_default_ontology", { p_project: projectId });
    if (ontologyError) {
      warnings.push(warning("graph_failed", `Knowledge graph skipped: the ontology couldn't be loaded (database error ${ontologyError.code || "unknown"}).`));
      return finish(false);
    }
    const ontology = ontologyFromTypes(typeRows);

    const eligible = (chunks || []).filter(
      (chunk) => chunk?.id && String(chunk.content ?? "").trim() && chunkTokens(chunk) >= MIN_CHUNK_TOKENS,
    );
    const cap = positiveNumber(config?.maxTokensPerSource) ?? DEFAULT_MAX_TOKENS_PER_SOURCE;
    const selected = [];
    let budget = 0;
    for (const chunk of eligible) {
      const count = chunkTokens(chunk);
      if (budget + count > cap) break;
      selected.push(chunk);
      budget += count;
    }
    if (selected.length < eligible.length) {
      warnings.push(
        warning(
          "graph_truncated",
          `The knowledge graph used the first ${selected.length} of ${eligible.length} chunks (limit ${cap.toLocaleString("en-US")} tokens per source).`,
        ),
      );
    }
    if (!selected.length) return finish(true);

    const batches = batchByTokens(selected, BATCH_TOKENS, { countTokens: chunkTokens });
    const minConfidence = Number.isFinite(Number(config?.minConfidence)) ? Number(config.minConfidence) : DEFAULT_MIN_CONFIDENCE;
    const seen = new Map(); // canonical name -> times extracted, for in-source naming consistency
    const seenNames = () =>
      [...seen.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_SEEN_NAMES)
        .map(([name]) => name);
    let failed = 0;
    let firstFailure = null;
    let fatal = null;

    await runOrdered(batches.length, {
      concurrency: CONCURRENCY,
      shouldStop: () => Boolean(fatal) || Boolean(signal?.aborted),
      start: (index) => extractBatch({ resolved, ontology, batch: batches[index], seenNames: seenNames(), signal }),
      settle: async (_index, outcome) => {
        const value = outcome.ok ? outcome.value : { error: outcome.error, tokens: 0 };
        tokens += value.tokens || 0;
        if (fatal || signal?.aborted) return false;
        if (value.error) {
          failed += 1;
          const described = describeLlmError(value.error);
          firstFailure ??= described.message;
          if (described.fatal) fatal = described.message;
          return !described.fatal;
        }

        const extraction = sanitizeExtraction(value.raw, ontology, value.chunkRefs, { minConfidence });
        if (!extraction.entities.length) return true;
        const { data: refMap, error } = await admin.rpc("kg_upsert_extracted", {
          p_project: projectId,
          p_source: sourceId,
          p_payload: { job_id: jobId ?? null, entities: extraction.entities, relations: extraction.relations },
        });
        if (error) {
          fatal = `Saving the knowledge graph failed (database error ${error.code || "unknown"}).`;
          return false;
        }
        for (const entity of extraction.entities) {
          if (!refMap?.[entity.ref]) continue;
          entityIds.add(refMap[entity.ref]);
          seen.set(entity.name, (seen.get(entity.name) || 0) + 1);
        }
        for (const relation of extraction.relations) {
          const source = refMap?.[relation.source];
          const target = refMap?.[relation.target];
          if (source && target && source !== target) relationKeys.add(`${source}|${target}|${relation.type}`);
        }
        return true;
      },
    });

    if (fatal) {
      warnings.push(warning("graph_failed", fatal));
      return finish(false);
    }
    if (signal?.aborted) {
      warnings.push(warning("graph_aborted", "Knowledge graph extraction stopped before it finished."));
      return finish(false);
    }
    if (failed) {
      warnings.push(
        warning("graph_partial", `${failed} of ${batches.length} parts of this source couldn't be added to the knowledge graph: ${firstFailure}`),
      );
      return finish(false);
    }
    return finish(true);
  } catch {
    warnings.push(warning("graph_failed", "Knowledge graph extraction failed unexpectedly."));
    return finish(false);
  }
}

/**
 * Soft-deletes graph data left without evidence after a chunk swap (grey.kg_sweep_orphans).
 * Run after extraction for the source — or right after the swap when extraction is skipped.
 * Never throws.
 */
export async function sweepGraphOrphans({ admin, projectId, sourceId }) {
  if (!admin || !projectId) return;
  try {
    const { error } = await admin.rpc("kg_sweep_orphans", { p_project: projectId, p_source: sourceId ?? null });
    if (error) console.warn("[graph.sweepGraphOrphans]", error.code || "", error.message || "");
  } catch (error) {
    console.warn("[graph.sweepGraphOrphans]", error?.message || error);
  }
}
