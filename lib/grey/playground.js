// Pure helpers for the Playground (no I/O): conversation grouping for the history rail, what
// to tell the user about a finished reply, and its context view — all derived from the message
// row the chat route saves (finishReason, aborted, error, noContext, knowledgeOnly, context, stats in metadata).
import { differenceInCalendarDays } from "date-fns";
import { formatDuration, formatLatency, formatNumber } from "./format.js";
import { contextBlockHeader } from "./prompt.js";

const RECENCY_GROUPS = [
  { label: "Today", maxDays: 0 },
  { label: "Yesterday", maxDays: 1 },
  { label: "Previous 7 days", maxDays: 7 },
  { label: "Previous 30 days", maxDays: 30 },
  { label: "Older", maxDays: Infinity },
];

const touchedAt = (c) => new Date(c?.updatedAt || c?.createdAt || 0);

// Newest first, bucketed by calendar day. -> [{ label, items }] (empty groups dropped)
export function groupConversations(conversations = [], now = new Date()) {
  const sorted = [...(conversations || [])].sort((a, b) => touchedAt(b) - touchedAt(a));
  const groups = RECENCY_GROUPS.map((g) => ({ label: g.label, items: [] }));
  for (const conversation of sorted) {
    const days = Math.max(0, differenceInCalendarDays(now, touchedAt(conversation)));
    groups[RECENCY_GROUPS.findIndex((g) => days <= g.maxDays)].items.push(conversation);
  }
  return groups.filter((g) => g.items.length);
}

// "p. 12" or "01:15" for a citation or context passage that has a location. -> string | null
export function citationLocation(citation) {
  if (citation?.page) return `p. ${citation.page}`;
  if (citation?.startMs !== undefined && citation?.startMs !== null) return formatDuration(citation.startMs);
  return null;
}

// Why a reply is incomplete, if it is. -> null | { tone: "warning" | "danger" | "neutral", text, fixInPipeline? }
export function replyNotice(message) {
  if (message?.role !== "assistant" || message.pending) return null;
  const meta = message.metadata || {};
  const empty = !String(message.content ?? "").trim();
  if (meta.finishReason === "length") {
    return empty
      ? {
          tone: "warning",
          text: `No answer — the model spent its whole output limit${message.tokensOut ? ` (${message.tokensOut.toLocaleString("en-US")} tokens)` : ""} before replying. Raise Max tokens on the pipeline.`,
          fixInPipeline: true,
        }
      : { tone: "warning", text: "Cut off at the pipeline's Max tokens limit.", fixInPipeline: true };
  }
  if (meta.error) return { tone: "danger", text: "The reply stopped early because of an error." };
  if (meta.aborted) return { tone: "neutral", text: "Stopped before it finished." };
  return null;
}

// Where the answer came from, when that's worth flagging. -> string | null
export function replySource(message) {
  if (message?.role !== "assistant" || message.pending) return null;
  const meta = message.metadata || {};
  if (meta.knowledgeOnly === false) return meta.noContext ? "Answered from general knowledge" : "General knowledge allowed";
  if (meta.noContext) return "Not found in the knowledge base";
  return null;
}

const count = (n) => Number(n).toLocaleString("en-US");

// 151.4 -> "151 tok/s"; 7.66 -> "7.7 tok/s". -> string | null
function tokenRate(tokens, ms) {
  if (!(Number(tokens) > 0) || !(Number(ms) > 0)) return null;
  const perSecond = Number(tokens) / (Number(ms) / 1000);
  return `${perSecond < 10 ? perSecond.toFixed(1) : formatNumber(Math.round(perSecond))} tok/s`;
}

// The reply header's timing segments, from metadata.stats: the query embedding, then the model's
// generation once the reply is saved. Generation speed is output tokens over the time after the
// first token. -> [{ key, label, time, rate, detail: string[] }]
export function replyMetrics(message) {
  if (message?.role !== "assistant") return [];
  const { embedding, generation } = message.metadata?.stats || {};
  const metrics = [];
  if (Number.isFinite(embedding?.ms)) {
    metrics.push({
      key: "embedding",
      label: "Embedding",
      time: formatLatency(embedding.ms),
      rate: tokenRate(embedding.tokens, embedding.ms),
      detail: [
        embedding.model || "Query embedding",
        embedding.tokens ? `${count(embedding.tokens)} query tokens in ${formatLatency(embedding.ms)}` : null,
      ].filter(Boolean),
    });
  }
  if (Number.isFinite(generation?.ms)) {
    const first = Number.isFinite(generation.firstTokenMs) ? generation.firstTokenMs : null;
    const tokensIn = Number(message.tokensIn) || 0;
    const tokensOut = Number(message.tokensOut) || 0;
    const latency = Number(message.latencyMs);
    metrics.push({
      key: "generation",
      label: "LLM",
      time: formatLatency(generation.ms),
      rate: tokenRate(tokensOut, first !== null && generation.ms > first ? generation.ms - first : generation.ms),
      detail: [
        message.metadata?.model || "Model",
        first !== null ? `First token after ${formatLatency(first)}` : null,
        tokensIn || tokensOut ? `${count(tokensIn)} tokens in · ${count(tokensOut)} out` : null,
        message.latencyMs !== null && Number.isFinite(latency) ? `Whole reply ${formatLatency(latency)}` : null,
      ].filter(Boolean),
    });
  }
  return metrics;
}

// The context view's summary of metadata.context: how the passages were chosen and how much of
// the token budget they used. -> null | string ("Best 6 of 32 matches · 54% of the 6,000-token budget")
export function contextSummary(context) {
  const passages = context?.passages?.length ?? 0;
  if (!passages) return null;
  const retrieved = Number(context.retrieved) || passages;
  const candidates = Number(context.candidates) || 0;
  const selection =
    retrieved > passages
      ? `${passages} of the top ${retrieved} matches fit the budget`
      : candidates > passages
        ? `Best ${passages} of ${candidates} matches`
        : `All ${passages} ${passages === 1 ? "match" : "matches"}`;
  const budget = Number(context.budgetTokens) || 0;
  if (!budget) return selection;
  const share = Math.min(100, Math.round(((Number(context.tokens) || 0) / budget) * 100));
  return `${selection} · ${share}% of the ${budget.toLocaleString("en-US")}-token budget`;
}

// A passage as the model received it: the chunk's text (trimmed the way its context block was)
// once loaded, else the stored snippet. `contents` is Map(chunkId -> content). -> { text, full }
export function passageText(passage, contents) {
  const content = contents?.get(passage?.chunkId);
  if (content === undefined) return { text: passage?.snippet ?? "", full: false };
  return { text: passage.truncated ? `${content.slice(0, passage.chars)}…` : content, full: true };
}

// The whole context block, "[n] header\ntext" per passage, the way the model received it.
export function contextText(passages = [], contents) {
  return (passages || [])
    .map((p) => {
      const header = contextBlockHeader(p.index, { sourceName: p.title, page: p.page, startMs: p.startMs });
      return `${header}\n${passageText(p, contents).text}`;
    })
    .join("\n\n");
}
