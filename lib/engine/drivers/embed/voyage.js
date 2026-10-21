// Embedding driver — Voyage format: POST {base}/embeddings with input_type document|query
// (images and voyage-multimodal-* text: POST {base}/multimodalembeddings).
// Pure request/response shapes live in lib/grey/embedding_models.js.
import {
  buildEmbedRequest,
  buildImageEmbedRequest,
  parseEmbedResponse,
  parseImageEmbedResponse,
} from "../../../grey/embedding_models.js";
import { EngineError } from "../../errors.js";
import { requestJson } from "../http.js";

export const FORMAT = "voyage";

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

// images: [{ data /* base64 */, mimeType }]; `model` is the image model (imageEmbeddingSpec).
// -> { vectors: number[][], tokens }
export async function embedImages({ baseUrl, apiKey, model, images, inputType, dimensions, signal, timeoutMs, retries, noRedirect, fetch }) {
  const { url, init } = buildImageEmbedRequest({ format: FORMAT, baseUrl, apiKey, model, images, inputType, dimensions });
  const json = await requestJson(url, init, { timeoutMs, retries, signal, noRedirect, fetch });
  try {
    return parseImageEmbedResponse(FORMAT, json, images.length);
  } catch {
    throw new EngineError("bad_response", "The embedding provider returned an unexpected response.", { status: 502, retryable: true });
  }
}
