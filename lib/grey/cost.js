// Pure cost estimation for ingestion presets (no I/O, no browser/Node APIs)
export const TIER_ORDER = ["fast", "balanced", "high"];

// Baseline per-page prices used when a preset's tier is "auto" (range from fast to high)
export const SYSTEM_TIER_PRICES = { fast: 0.002, balanced: 0.006, high: 0.02 };

const round6 = (amount) => Number(amount.toFixed(6));

const PAGE_KINDS = new Set(["document", "image", "web", "note"]);
const MEDIA_KINDS = new Set(["audio", "video"]);

// Estimates low/high cost for a single file under a given ingestion preset
export function estimateFileCost(file, preset) {
  const { tier, config } = preset;
  const { prices } = config;
  const breakdown = [];
  let low = 0;
  let high = 0;

  if (PAGE_KINDS.has(file.kind)) {
    const pages = file.pageCount || 0;
    const lowPrice = tier === "auto" ? SYSTEM_TIER_PRICES.fast : prices.perPage;
    const highPrice = tier === "auto" ? SYSTEM_TIER_PRICES.high : prices.perPage;
    const lowAmount = round6(pages * lowPrice);
    const highAmount = round6(pages * highPrice);
    breakdown.push({ label: "Pages", amount: highAmount });
    low += lowAmount;
    high += highAmount;
  }

  if (MEDIA_KINDS.has(file.kind)) {
    const minutes = (file.durationMs || 0) / 60_000;
    const mediaAmount = round6(minutes * prices.perMediaMinute);
    breakdown.push({ label: "Media", amount: mediaAmount });
    low += mediaAmount;
    high += mediaAmount;

    if (file.kind === "video" && config.media?.keyframes) {
      const keyframeAmount = round6(minutes * prices.perKeyframeMinute);
      breakdown.push({ label: "Keyframes", amount: keyframeAmount });
      low += keyframeAmount;
      high += keyframeAmount;
    }
  }

  const tokens = file.tokenCount || 0;

  if (config.graph?.extract) {
    const graphAmount = round6((tokens / 1e6) * prices.perMillionTokensGraph);
    breakdown.push({ label: "Graph extraction", amount: graphAmount });
    low += graphAmount;
    high += graphAmount;
  }

  if (config.enrichment?.contextual) {
    const enrichAmount = round6((tokens / 1e6) * prices.perMillionTokensContextual);
    breakdown.push({ label: "Contextual enrichment", amount: enrichAmount });
    low += enrichAmount;
    high += enrichAmount;
  }

  return { low: round6(low), high: round6(high), breakdown };
}

// Sums low/high cost across multiple files under a given ingestion preset
export function estimateTotal(files, preset) {
  return files.reduce(
    (totals, file) => {
      const { low, high } = estimateFileCost(file, preset);
      return { low: round6(totals.low + low), high: round6(totals.high + high) };
    },
    { low: 0, high: 0 }
  );
}
