// Rerank driver — Cohere format: POST {base}/v2/rerank (or {base}/rerank when the base
// URL is versioned, e.g. Jina https://api.jina.ai/v1). Also served by vLLM and
// Infinity. Response: { results: [{ index, relevance_score }] }.
import { cohereUrl } from "../../../grey/embedding_models.js";
import { EngineError } from "../../errors.js";
import { requestJson } from "../http.js";

export const FORMAT = "cohere";

export function buildRequest({ baseUrl, apiKey, model, query, documents, topN }) {
  const body = { model, query, documents };
  if (topN) body.top_n = topN;
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return { url: cohereUrl(baseUrl, "rerank"), init: { method: "POST", headers, body: JSON.stringify(body) } };
}

export function parseResponse(json) {
  if (!Array.isArray(json?.results)) throw new Error("No rerank results.");
  return json.results.map((r) => ({ index: Number(r.index), score: Number(r.relevance_score ?? r.score) }));
}

// -> [{ index, score }] (unsorted)
export async function rerank({ baseUrl, apiKey, model, query, documents, topN, signal, timeoutMs, retries, noRedirect, fetch }) {
  const { url, init } = buildRequest({ baseUrl, apiKey, model, query, documents, topN });
  const json = await requestJson(url, init, { timeoutMs, retries, signal, noRedirect, fetch });
  try {
    return parseResponse(json);
  } catch {
    throw new EngineError("bad_response", "The rerank provider returned an unexpected response.", { status: 502, retryable: true });
  }
}
