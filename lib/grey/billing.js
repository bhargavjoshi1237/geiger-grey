// Pure ingestion metering (spec §11): Grey records quantities for everything, but cost is
// non-zero only for work Grey itself performs (page parsing). Work done on the customer's own
// provider accounts (transcription, enrichment, graph extraction) is recorded with cost 0 and
// metadata.byok = true. One usage_events row per (ingestion job, kind).
import { SYSTEM_TIER_PRICES } from "./cost.js";

// Matches the upload estimate (lib/grey/file_analysis.js): ~500 tokens per page.
export const TOKENS_PER_PAGE = 500;

export const BYOK_KINDS = new Set(["media_minute", "contextual_tokens", "graph_tokens", "llm_tokens"]);

// How a retried attempt of the same job merges into the existing row:
//   first -> the first attempt's quantity stands (a retry re-reads the parse/transcript cache)
//   add   -> quantities accumulate (a retry only enriches/extracts what is still missing)
export const USAGE_MERGE = {
  page: "first",
  media_minute: "first",
  contextual_tokens: "add",
  graph_tokens: "add",
  llm_tokens: "add",
};

const round6 = (n) => Number(Number(n).toFixed(6));

// Pages actually parsed. Paginated formats (PDF, slides) count pages with text; flowing
// formats (DOCX, HTML, Markdown...) are billed per ~500 tokens, minimum one page.
export function billablePages({ paginated, pageCount = 0, tokenCount = 0 }) {
  if (paginated) return Math.max(0, Math.floor(Number(pageCount) || 0));
  const tokens = Number(tokenCount) || 0;
  return tokens > 0 ? Math.max(1, Math.ceil(tokens / TOKENS_PER_PAGE)) : 0;
}

// The tier the work was actually done at: a layout/vlm/auto preset served by the text engine
// is billed at the Fast tier.
export function tierUsed({ tier, tierDowngraded }) {
  return tierDowngraded ? "fast" : tier || "fast";
}

// Per-page price at the tier actually used. A downgraded parse never costs more than the
// preset's own per-page price.
export function pageUnitPrice({ tier, prices, tierDowngraded }) {
  const configured = Number(prices?.perPage);
  const presetPrice = Number.isFinite(configured) && configured >= 0 ? configured : SYSTEM_TIER_PRICES[tier] ?? SYSTEM_TIER_PRICES.fast;
  return tierDowngraded ? Math.min(presetPrice, SYSTEM_TIER_PRICES.fast) : presetPrice;
}

// `page` row. A cached parse is recorded as 0 pages (metadata.cached) so the job still shows it.
export function pageUsage({ pages, cached = false, tier, prices, tierDowngraded = false, engine = null }) {
  const quantity = cached ? 0 : Math.max(0, Math.floor(Number(pages) || 0));
  if (!quantity && !cached) return null;
  const unitCost = pageUnitPrice({ tier, prices, tierDowngraded });
  return {
    kind: "page",
    quantity,
    unitCost,
    cost: round6(quantity * unitCost),
    metadata: { tier: tierUsed({ tier, tierDowngraded }), cached: Boolean(cached), ...(engine ? { engine } : {}) },
  };
}

// Customer-account work: quantity recorded, cost 0.
export function byokUsage(kind, quantity, metadata = {}) {
  if (!BYOK_KINDS.has(kind)) throw new Error(`Not a BYOK usage kind: ${kind}`);
  const q = Number(quantity) || 0;
  if (q <= 0) return null;
  return { kind, quantity: round6(q), unitCost: 0, cost: 0, metadata: { ...metadata, byok: true } };
}

export function mediaUsage({ durationMs, ...metadata }) {
  const minutes = (Number(durationMs) || 0) / 60_000;
  return byokUsage("media_minute", Number(minutes.toFixed(3)), metadata);
}

export function sumCost(events) {
  return round6((events || []).filter(Boolean).reduce((sum, e) => sum + (Number(e.cost) || 0), 0));
}
