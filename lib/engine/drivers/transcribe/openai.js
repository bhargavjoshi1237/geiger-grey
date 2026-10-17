// OpenAI-format transcription driver (spec §9.1): multipart POST {base}/audio/transcriptions.
// Serves OpenAI, Groq and self-hosted Whisper servers. The worker downloads the media to a temp
// file first (`filePath`); the server enforces its upload limit (25 MB on OpenAI).
import { openAsBlob } from "node:fs";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { EngineError } from "../../errors.js";
import { normalizeOpenAI, openAIResponseFormat } from "../../../grey/transcript_normalize.js";
import { MESSAGES, fetchWithRetry, providerDetail, providerError, readJson } from "./http.js";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const OPENAI_HOST = "api.openai.com";
const OPENAI_MAX_BYTES = 25 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
const TOO_LARGE = /too large|maximum content size|file size|exceeds? the (maximum|limit)/i;

function isOpenAIHost(base) {
  try {
    return new URL(base).hostname === OPENAI_HOST;
  } catch {
    return false;
  }
}

// OpenAI expects ISO-639-1 ("en"); AssemblyAI-style codes ("en_us") are trimmed to the base.
function languageParam(language) {
  const value = typeof language === "string" ? language.trim().toLowerCase() : "";
  if (!value || value === "auto") return null;
  return value.split(/[_-]/)[0];
}

function buildForm({ file, filename, model, format, language }) {
  const form = new FormData();
  form.append("file", file, filename);
  form.append("model", model);
  form.append("response_format", format);
  if (format === "verbose_json") form.append("timestamp_granularities[]", "segment");
  if (format === "diarized_json") form.append("chunking_strategy", "auto");
  if (language && format !== "diarized_json") form.append("language", language);
  return form;
}

export async function transcribeOpenAI({ apiKey, baseUrl, model, filePath, config = {}, signal, custom = false }) {
  if (!filePath) {
    throw new EngineError("invalid_input", "This transcription provider needs the media file downloaded first.", {
      status: 422,
    });
  }
  const base = String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const modelId = model || "whisper-1";

  const { size } = await stat(filePath);
  if (isOpenAIHost(base) && size > OPENAI_MAX_BYTES) {
    throw new EngineError("file_too_large", MESSAGES.tooLarge, { status: 413 });
  }

  const file = await openAsBlob(filePath);
  const filename = basename(filePath);
  const language = languageParam(config.language);
  const headers = apiKey ? { authorization: `Bearer ${apiKey}` } : {};

  const post = (format) =>
    fetchWithRetry(
      `${base}/audio/transcriptions`,
      { method: "POST", headers, body: buildForm({ file, filename, model: modelId, format, language }) },
      { signal, timeoutMs: REQUEST_TIMEOUT_MS, custom },
    );

  let format = openAIResponseFormat(modelId);
  let response = await post(format);
  let payload = await readJson(response);

  // Servers that don't offer verbose_json for this model get one retry with plain json (no timestamps).
  if (response.status === 400 && format === "verbose_json" && /response_format/i.test(providerDetail(payload, apiKey))) {
    format = "json";
    response = await post(format);
    payload = await readJson(response);
  }

  if (!response.ok) {
    if (response.status === 400 && TOO_LARGE.test(providerDetail(payload, apiKey))) {
      throw new EngineError("file_too_large", MESSAGES.tooLarge, { status: 413 });
    }
    throw providerError(response, payload, apiKey);
  }

  const { durationMs, language: detected, segments } = normalizeOpenAI(payload, { durationMs: config.durationMs });
  if (!segments.length) throw new EngineError("no_speech", MESSAGES.noSpeech, { status: 422 });

  return {
    provider: "openai",
    providerJobId: null,
    model: modelId,
    durationMs,
    language: detected,
    segments,
    raw: payload,
  };
}
