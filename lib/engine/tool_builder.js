// The tool builder agent (lookup-tools spec §5.9): one streamed turn on the project's processing
// model with a single tool, update_tool, that patches the tool's draft spec through applyToolPatch
// and saves it straight away. The builder can't publish, can't pick provider ids and can only
// point the scope at the project's active knowledge bases.
import { stepCountIs, streamText, tool as defineTool } from "ai";
import { EngineError, isEngineError } from "./errors.js";
import { getProcessingModel } from "./llm.js";
import { kbImageSupport } from "./embeddings.js";
import { mapLlmError } from "../grey/llm_errors.js";
import { applyToolPatch, normalizeToolSpec, summarizeToolSpec, validateToolSpec } from "../grey/tool_spec.js";
import {
  BUILDER_INSTRUCTIONS,
  BUILDER_LIMITS,
  BUILDER_TOOL_NAME,
  builderPatchSchema,
  formatBuilderContext,
  toBuilderMessages,
} from "../grey/tool_builder.js";

const DEFAULT_DEPS = { streamText, getProcessingModel, kbImageSupport };
const FIRST_CHUNK_TIMEOUT_MS = 60_000;
const TURN_TIMEOUT_MS = 110_000; // inside the route's 120 s maxDuration

const UPDATE_TOOL_DESCRIPTION =
  "Change the tool's draft. Send only the settings that change; several can go in one call. " +
  "Returns ok, the changed settings, errors for anything that wasn't applied, the problems still " +
  "blocking publishing and a summary of the tool as it now stands.";

const noProcessingModel = () =>
  new EngineError("no_processing_model", "Set a processing model in Settings → General to use the builder.", { status: 422 });

const sameText = (a, b) => (a ?? "") === (b ?? "");

async function countSources(admin, projectId, kbId, kind) {
  let query = admin.from("sources").select("id", { count: "exact", head: true })
    .eq("project_id", projectId).eq("kb_id", kbId).is("deleted_at", null);
  if (kind) query = query.eq("kind", kind);
  const { count, error } = await query;
  if (error) {
    console.error("[engine.tool_builder.countSources]", error.code || error.message);
    return null;
  }
  return Number.isFinite(count) ? count : null;
}

async function hasProcessingModel(admin, projectId) {
  const { data, error } = await admin.from("project_settings").select("processing_provider_id")
    .eq("project_id", projectId).is("deleted_at", null).maybeSingle();
  if (error) {
    console.error("[engine.tool_builder.settings]", error.code || error.message);
    return false;
  }
  return Boolean(data?.processing_provider_id);
}

/**
 * What the builder may use: the project's active knowledge bases (image support and item counts
 * — two count queries per knowledge base), the labels on items (inside the tool's scope when it
 * has one, else across those knowledge bases) and whether a processing model is set.
 * `processingModel` (boolean) skips the settings read when the caller already knows.
 * -> { kbs: [{ id, name, imageSupport, sources, imageSources }], labels: [{ label, sources }], processingModel }
 */
export async function loadBuilderContext({ admin, projectId, tool, processingModel, deps = {} }) {
  const d = { ...DEFAULT_DEPS, ...deps };
  const { data: rows, error } = await admin.from("knowledge_bases")
    .select("id,name,embedding_provider_id,embedding_model,embedding_dims")
    .eq("project_id", projectId).eq("status", "active").is("deleted_at", null)
    .order("name", { ascending: true }).limit(BUILDER_LIMITS.contextKbs);
  if (error) {
    console.error("[engine.tool_builder.kbs]", error.code || error.message);
    throw new EngineError("service_unavailable", "Couldn't load the project's knowledge bases.", { status: 503, retryable: true });
  }
  const kbRows = rows ?? [];

  const kbs = await Promise.all(kbRows.map(async (kb) => {
    const [support, sources, imageSources] = await Promise.all([
      d.kbImageSupport({ admin, projectId, kb }).catch(() => null),
      countSources(admin, projectId, kb.id),
      countSources(admin, projectId, kb.id, "image"),
    ]);
    return { id: kb.id, name: kb.name, imageSupport: Boolean(support?.supported), sources, imageSources };
  }));

  const activeIds = kbs.map((kb) => kb.id);
  const scopeIds = normalizeToolSpec(tool?.spec).scope.kbIds.filter((id) => activeIds.includes(id));
  let labels = [];
  if (activeIds.length) {
    const { data, error: labelError } = await admin.rpc("source_label_counts", {
      p_project: projectId,
      p_kb_ids: scopeIds.length ? scopeIds : activeIds,
    });
    if (labelError) console.error("[engine.tool_builder.labels]", labelError.code || labelError.message);
    else {
      labels = (data ?? [])
        .filter((row) => typeof row?.label === "string" && row.label)
        .map((row) => ({ label: row.label, sources: Number(row.sources) || 0 }));
    }
  }

  return {
    kbs,
    labels,
    processingModel: typeof processingModel === "boolean" ? processingModel : await hasProcessingModel(admin, projectId),
  };
}

// The builder may only point the scope at the project's active knowledge bases. A list with an
// unknown id isn't applied at all (applying the rest could silently drop a knowledge base) and is
// reported back. -> { patch, errors }
function guardPatch(patch, activeIds) {
  const kbIds = patch?.scope?.kbIds;
  if (!Array.isArray(kbIds)) return { patch, errors: [] };
  const unknown = kbIds.filter((id) => !activeIds.has(id));
  if (!unknown.length) return { patch, errors: [] };
  const scope = { ...patch.scope };
  delete scope.kbIds;
  return {
    patch: { ...patch, scope },
    errors: [{
      path: "scope.kbIds",
      message: `Not a knowledge base in this project: ${unknown.join(", ")}. Use the ids listed in the context.`,
    }],
  };
}

function toUsage(usage) {
  return { tokensIn: Number(usage?.inputTokens) || 0, tokensOut: Number(usage?.outputTokens) || 0 };
}

function toEngineError(error, signal) {
  if (isEngineError(error)) return error;
  if (signal?.aborted) return new EngineError("aborted", "The request was cancelled.", { status: 499 });
  const mapped = mapLlmError(error);
  console.error("[engine.tool_builder]", mapped.code, mapped.providerStatus ?? "");
  return new EngineError(mapped.code, mapped.message, { status: mapped.status ?? 502, retryable: Boolean(mapped.retryable) });
}

/**
 * One builder turn. `tool` is the grey.tools row (draft spec, name, description), `history` the
 * earlier tool_messages rows oldest first, `message` the member's new message. Emits
 * onEvent({ type: "delta", text }) as the reply streams and onEvent({ type: "edit", changed, spec,
 * name, description, errors }) after every saved change.
 * Throws EngineError before the model is called (no_processing_model, provider or context
 * failures). Once the model has started it always resolves with the turn as far as it got —
 * `error` is the EngineError that stopped it (or null), `tool` the latest saved row (or null):
 * -> { text, aborted, error, specBefore, specAfter, nameBefore, nameAfter, descriptionBefore,
 *      descriptionAfter, edits: [{ changed, errors }], tool, usage: { tokensIn, tokensOut, model, provider } }
 */
export async function runBuilderTurn({ admin, projectId, tool, history = [], message, signal, onEvent, deps = {} }) {
  const d = { ...DEFAULT_DEPS, ...deps };
  const resolved = await d.getProcessingModel({ admin, projectId });
  if (!resolved) throw noProcessingModel();
  const context = await loadBuilderContext({ admin, projectId, tool, processingModel: true, deps: d });
  const activeIds = new Set(context.kbs.map((kb) => kb.id));
  const summarize = (spec) => summarizeToolSpec(spec, { kbNames: context.kbs });

  const specBefore = normalizeToolSpec(tool?.spec);
  const nameBefore = tool?.name ?? "";
  const descriptionBefore = tool?.description ?? null;
  const state = { spec: specBefore, name: nameBefore, description: descriptionBefore, row: null, edits: [] };
  const emit = (event) => {
    try {
      onEvent?.(event);
    } catch (error) {
      console.error("[engine.tool_builder.onEvent]", error?.message);
    }
  };

  // Applies one update_tool call to the current draft and saves it. Never throws: the model gets
  // the outcome as the tool result.
  const applyEdit = async (input) => {
    const guarded = guardPatch(input, activeIds);
    const result = applyToolPatch(state.spec, guarded.patch);
    const errors = [...guarded.errors, ...result.errors];
    const nameChanged = "name" in result.meta && result.meta.name !== state.name;
    const descriptionChanged = "description" in result.meta && !sameText(result.meta.description, state.description);
    const changed = result.changed.filter((path) =>
      path === "name" ? nameChanged : path === "description" ? descriptionChanged : true,
    );
    const outcome = (ok, list) => ({
      ok,
      changed: list,
      errors,
      problems: validateToolSpec(state.spec, { kbIds: [...activeIds] }).errors,
      summary: summarize(state.spec),
    });
    if (!changed.length) return outcome(errors.length === 0, []);

    const update = { spec: result.spec };
    if (nameChanged) update.name = result.meta.name;
    if (descriptionChanged) update.description = result.meta.description || null;
    const { data, error } = await admin.from("tools").update(update)
      .eq("project_id", projectId).eq("id", tool.id).is("deleted_at", null)
      .select("*").maybeSingle();
    if (error || !data) {
      console.error("[engine.tool_builder.save]", error?.code || error?.message || "tool_missing");
      errors.push({ path: "", message: "The change couldn't be saved. Nothing was changed." });
      return outcome(false, []);
    }

    state.spec = result.spec;
    if (nameChanged) state.name = update.name;
    if (descriptionChanged) state.description = update.description;
    state.row = data;
    state.edits.push({ changed, errors });
    emit({ type: "edit", changed, spec: state.spec, name: state.name, description: state.description, errors });
    return outcome(errors.length === 0, changed);
  };

  // One edit at a time, in call order, so concurrent calls can't save out of order.
  let queue = Promise.resolve();
  const updateTool = defineTool({
    description: UPDATE_TOOL_DESCRIPTION,
    inputSchema: builderPatchSchema,
    execute: (input) => {
      const run = queue.then(() => applyEdit(input));
      queue = run.catch(() => {});
      return run;
    },
  });

  const instructions = `${BUILDER_INSTRUCTIONS}\n\n${formatBuilderContext({
    tool,
    spec: specBefore,
    kbs: context.kbs,
    labels: context.labels,
    processingModel: context.processingModel,
  })}`;

  let text = "";
  let breakPending = false;
  let stepUsage = { tokensIn: 0, tokensOut: 0 };
  let totalUsage = null;
  let aborted = false;
  let failure = null;

  try {
    const result = d.streamText({
      model: resolved.model,
      instructions,
      messages: [...toBuilderMessages(history), { role: "user", content: String(message ?? "") }],
      tools: { [BUILDER_TOOL_NAME]: updateTool },
      toolCallConcurrency: 1,
      stopWhen: stepCountIs(BUILDER_LIMITS.maxSteps),
      maxOutputTokens: BUILDER_LIMITS.maxOutputTokens,
      abortSignal: signal,
      maxRetries: 2,
      timeout: { firstChunkMs: FIRST_CHUNK_TIMEOUT_MS, totalMs: TURN_TIMEOUT_MS },
      onError: () => {}, // errors arrive as `error` parts; the default handler logs raw provider text
    });
    for await (const part of result.stream) {
      if (part.type === "text-delta" && part.text) {
        // Text from a later step (after a tool call) starts a new paragraph.
        const piece = breakPending && text ? `\n\n${part.text}` : part.text;
        breakPending = false;
        text += piece;
        emit({ type: "delta", text: piece });
      } else if (part.type === "finish-step") {
        const usage = toUsage(part.usage);
        stepUsage = { tokensIn: stepUsage.tokensIn + usage.tokensIn, tokensOut: stepUsage.tokensOut + usage.tokensOut };
        if (text) breakPending = true;
      } else if (part.type === "finish") {
        totalUsage = toUsage(part.totalUsage);
      } else if (part.type === "error") {
        throw part.error;
      } else if (part.type === "abort" && !signal?.aborted) {
        throw Object.assign(new Error(part.reason || "The model took too long to respond."), { name: "TimeoutError" });
      }
    }
    if (signal?.aborted) aborted = true;
  } catch (error) {
    if (signal?.aborted) aborted = true;
    else failure = toEngineError(error, signal);
  }
  await queue; // a save still in flight belongs to this turn

  const usage = totalUsage ?? stepUsage;
  return {
    text: text.trim(),
    aborted,
    error: failure,
    specBefore,
    specAfter: state.spec,
    nameBefore,
    nameAfter: state.name,
    descriptionBefore,
    descriptionAfter: state.description,
    edits: state.edits,
    tool: state.row,
    usage: { ...usage, model: resolved.modelId ?? null, provider: resolved.providerKind ?? null },
  };
}
