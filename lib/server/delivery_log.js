// request_logs + usage_events for the public surfaces (spec §11, §12.5), written in after()
// so logging never delays or fails a response. Channel api | mcp | widget.
import { after } from "next/server";
import { recordRequestLog, recordUsage, toRetrievedLog } from "@/lib/engine/usage";
import { PRICE_PER_RETRIEVAL } from "@/lib/grey/cost";

// One delivery request. `turn` is a runPipelineTurn result (or a { retrieved, retrievalMeta }
// stand-in for retrieve-only calls), `final` the finished answer. `billed` charges one
// retrieval — only for requests that completed a search.
export async function logDelivery({
  admin,
  projectId,
  pipelineId = null,
  pipelineVersion = null,
  apiKeyId = null,
  conversationId = null,
  channel,
  query = null,
  status = "ok",
  latencyMs = null,
  turn = null,
  final = null,
  error = null,
  aborted = false,
  billed = false,
  refType = null,
  refId = null,
  metadata = {},
}) {
  const meta = turn?.retrievalMeta ?? {};
  const tokensIn = final?.usage?.tokensIn ?? null;
  const tokensOut = final?.usage?.tokensOut ?? null;
  const model = final?.model?.id ?? null;
  const provider = final?.model?.provider ?? null;
  const charge = billed && status === "ok";

  await recordRequestLog({
    admin,
    projectId,
    pipelineId,
    conversationId,
    apiKeyId,
    channel,
    query,
    status,
    latencyMs,
    retrieved: toRetrievedLog(turn?.retrieved ?? []),
    tokensIn,
    tokensOut,
    cost: charge ? PRICE_PER_RETRIEVAL : 0,
    metadata: {
      ...metadata,
      pipelineVersion,
      model,
      provider,
      noContext: Boolean(final?.noContext),
      retrievalOnly: Boolean(turn?.retrievalOnly),
      aborted: Boolean(aborted),
      ...(error ? { errorCode: error.code ?? "internal_error" } : {}),
      scoreKind: meta.scoreKind ?? null,
      degraded: meta.degraded ?? null,
      rerank: meta.rerank ?? null,
      graph: meta.graph ?? null,
      candidateCount: meta.candidateCount ?? 0,
      timings: { ...(meta.timings ?? {}), ...(turn?.timings ?? {}) },
    },
  });

  if (charge) {
    await recordUsage({
      admin,
      projectId,
      kind: "retrieval",
      quantity: 1,
      unitCost: PRICE_PER_RETRIEVAL,
      cost: PRICE_PER_RETRIEVAL,
      refType,
      refId,
      metadata: { channel, pipelineId, apiKeyId, ...(metadata.tool ? { tool: metadata.tool } : {}) },
    });
  }

  const tokens = (tokensIn ?? 0) + (tokensOut ?? 0);
  if (tokens > 0) {
    await recordUsage({
      admin,
      projectId,
      kind: "llm_tokens",
      quantity: tokens,
      unitCost: 0,
      cost: 0,
      refType,
      refId,
      metadata: { byok: true, tokensIn, tokensOut, model, provider, channel, pipelineId, apiKeyId },
    });
  }
}

// Registers the log write in after() and returns settle(outcome); the first call wins.
// Every request path must settle once it knows its outcome (status, turn, final, error, …).
export function scheduleDeliveryLog(base) {
  const startedAt = base.startedAt ?? Date.now();
  let resolveOutcome;
  const outcome = new Promise((resolve) => {
    resolveOutcome = resolve;
  });
  after(async () => {
    const result = await outcome;
    await logDelivery({
      ...base,
      ...result,
      latencyMs: result.latencyMs ?? Date.now() - startedAt,
      metadata: { ...(base.metadata || {}), ...(result.metadata || {}) },
    });
  });
  let settled = false;
  return (result) => {
    if (settled) return;
    settled = true;
    resolveOutcome({ latencyMs: Date.now() - startedAt, ...result });
  };
}
