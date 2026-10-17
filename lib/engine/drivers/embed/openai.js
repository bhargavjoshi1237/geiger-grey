// Embedding driver — OpenAI format: POST {base}/embeddings — OpenAI, Mistral, Together, Fireworks, Jina, Ollama, vLLM, LM Studio…
// Pure request/response shapes live in lib/grey/embedding_models.js.
import { buildEmbedRequest, parseEmbedResponse } from "../../../grey/embedding_models.js";
import { EngineError } from "../../errors.js";
import { requestJson } from "../http.js";

export const FORMAT = "openai";

// -> { vectors: number[][], tokens }
export async function embed({ baseUrl, apiKey, model, texts, inputType, dimensions, signal, timeoutMs, retries, noRedirect, fetch }) {
  const { url, init } = buildEmbedRequest({ format: FORMAT, baseUrl, apiKey, model, texts, inputType, dimensions });
  const json = await requestJson(url, init, { timeoutMs, retries, signal, noRedirect, fetch });
  try {
    return parseEmbedResponse(FORMAT, json, texts);
  } catch {
    throw new EngineError("bad_response", "The embedding provider returned an unexpected response.", { status: 502, retryable: true });
  }
}
