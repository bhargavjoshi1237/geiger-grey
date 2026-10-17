// Rerank driver — Voyage format: POST {base}/rerank.
// Response: { data: [{ index, relevance_score }] }.
import { joinUrl } from "../../../grey/embedding_models.js";
import { EngineError } from "../../errors.js";
import { requestJson } from "../http.js";

export const FORMAT = "voyage";

export function buildRequest({ baseUrl, apiKey, model, query, documents, topN }) {
  const body = { model, query, documents };
  if (topN) body.top_k = topN;
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return { url: joinUrl(baseUrl, "rerank"), init: { method: "POST", headers, body: JSON.stringify(body) } };
}

export function parseResponse(json) {
  if (!Array.isArray(json?.data)) throw new Error("No rerank results.");
  return json.data.map((r) => ({ index: Number(r.index), score: Number(r.relevance_score ?? r.score) }));
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
