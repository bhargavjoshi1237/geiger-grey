// The shared pipeline turn (spec §8.4): cap check → searchChunks → generateAnswer. The
// Playground, v1 API, MCP, widget and eval runner all call this; each keeps its own persistence.
import { searchChunks } from "./retrieval.js";
import { generateAnswer, staticAnswerStream } from "./answer.js";
import { getCapState } from "./usage.js";
import { NO_CONTEXT_ANSWER, RETRIEVAL_ONLY_NOTICE, buildContextBlocks } from "../grey/prompt.js";
import { contextCitations } from "../grey/citations.js";

// cap_behavior = 'retrieval_only' once the monthly soft cap is reached: no generation, the
// most relevant passages instead (search itself is never blocked).
function passagesAnswer(chunks, config) {
  const base = {
    usage: { tokensIn: 0, tokensOut: 0 },
    model: { id: null, provider: null },
    finishReason: "retrieval_only",
  };
  if (!chunks.length) return { ...base, text: NO_CONTEXT_ANSWER, citations: [], noContext: true };
  const passages = buildContextBlocks(chunks, { perChunkTokens: 80, budgetTokens: 2000 });
  return {
    ...base,
    text: `${RETRIEVAL_ONLY_NOTICE}\n\n${passages.text}`,
    citations: config?.retrieval?.citations === false ? [] : contextCitations(passages.chunks),
    noContext: false,
  };
}

// -> { ...generateAnswer result, retrieved, retrievalMeta, timings, retrievalOnly }
// `history` is the prior conversation ([{ role, content }]), without the current query.
export async function runPipelineTurn({ admin, projectId, config, query, history = [], channel, stream = false, abortSignal } = {}) {
  const startedAt = Date.now();
  const cap = await getCapState({ admin, projectId });
  const capMs = Date.now() - startedAt;
  const retrievalOnly = cap.reached && cap.behavior === "retrieval_only";

  const r = config?.retrieval || {};
  const search = await searchChunks({
    admin,
    projectId,
    kbIds: config?.kbIds || [],
    query,
    topK: r.topK,
    hybrid: r.hybrid,
    rerank: r.rerank,
    rerankProviderId: r.rerankProviderId,
    rerankModel: r.rerankModel,
    threshold: r.threshold,
    graphMode: r.graphMode,
    signal: abortSignal,
  });
  const retrievalMs = Date.now() - startedAt - capMs;
  const context = { retrieved: search.chunks, retrievalMeta: search.meta, retrievalOnly, channel: channel ?? null };

  if (retrievalOnly) {
    const answer = passagesAnswer(search.chunks, config);
    return { ...(stream ? staticAnswerStream(answer) : answer), ...context, timings: { capMs, retrievalMs } };
  }

  const generationStarted = Date.now();
  const answer = await generateAnswer({
    admin,
    projectId,
    config,
    messages: [...(history || []), { role: "user", content: query }],
    chunks: search.chunks,
    facts: search.meta.facts,
    stream,
    abortSignal,
  });
  const timings = stream ? { capMs, retrievalMs } : { capMs, retrievalMs, generationMs: Date.now() - generationStarted };
  return { ...answer, ...context, timings };
}
