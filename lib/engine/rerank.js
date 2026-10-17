// Rerank interface (spec §7.4): dispatches to the connection's rerank driver
// (lib/engine/drivers/rerank/<format>.js). Callers pass a short-lived `signal`
// (retrieval uses 3 s) and fall back to fused order on failure.
import { EngineError } from "./errors.js";
import { connectProvider } from "./secrets.js";
import { suggestedModelsFor } from "../grey/provider_kinds.js";
import * as cohere from "./drivers/rerank/cohere.js";
import * as voyage from "./drivers/rerank/voyage.js";

const DRIVERS = { cohere, voyage };

// One driver call on an already-connected provider. -> [{ index, score }] sorted desc
export async function rerankWithConnection(conn, { model, query, documents, topN, signal, timeoutMs = 10_000, retries = 1 }) {
  const driver = DRIVERS[conn.format];
  if (!driver) throw new EngineError("capability_missing", "This connection's rerank format isn't supported.", { status: 422 });
  const limit = Math.min(Math.max(1, Number(topN) || documents.length), documents.length);
  const raw = await driver.rerank({
    baseUrl: conn.baseUrl,
    apiKey: conn.apiKey,
    model,
    query: String(query ?? ""),
    documents,
    topN: limit,
    signal,
    timeoutMs,
    retries,
    noRedirect: conn.custom,
  });
  const seen = new Set();
  return raw
    .filter((r) => Number.isInteger(r.index) && r.index >= 0 && r.index < documents.length && Number.isFinite(r.score))
    .filter((r) => (seen.has(r.index) ? false : seen.add(r.index)))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// -> [{ index, score }] sorted by score desc (indexes into `documents`)
export async function rerank({ admin, projectId, providerId, model, query, documents, topN, signal }) {
  const docs = Array.isArray(documents) ? documents.map((d) => String(d ?? "")) : [];
  if (!docs.length) return [];
  const conn = await connectProvider({ admin, projectId, providerId, capability: "rerank" });
  const modelId = String(model || "").trim() || suggestedModelsFor(conn.provider, "rerank")[0]?.id;
  if (!modelId) throw new EngineError("no_rerank_model", "Choose a rerank model for this pipeline.", { status: 422 });
  return rerankWithConnection(conn, { model: modelId, query, documents: docs, topN, signal });
}
