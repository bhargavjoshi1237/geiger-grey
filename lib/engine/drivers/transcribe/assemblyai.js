// AssemblyAI transcription driver (spec §9.1–9.2): submit a signed media URL, poll until done,
// normalise utterances (diarized) or sentences into segments, then delete the provider copy.
// AssemblyAI downloads the file itself, so media never streams through the worker, and video
// containers are accepted directly (no ffmpeg).
import { EngineError } from "../../errors.js";
import {
  POLL_START_MS,
  assemblyAISpeechModels,
  nextPollDelay,
  normalizeAssemblyAI,
  transcriptionTimeoutMs,
} from "../../../grey/transcript_normalize.js";
import { MESSAGES, fetchWithRetry, providerDetail, providerError, readJson, sleep } from "./http.js";

const DEFAULT_BASE_URL = "https://api.assemblyai.com";
const REQUEST_TIMEOUT_MS = 30_000;

function apiBase(baseUrl) {
  return String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "").replace(/\/v2$/, "");
}

function submitBody({ fileUrl, speechModels, config }) {
  const language = typeof config?.language === "string" ? config.language.trim() : "";
  return {
    audio_url: fileUrl,
    speech_models: speechModels,
    speaker_labels: config?.diarize !== false,
    punctuate: true,
    format_text: true,
    ...(language && language !== "auto" ? { language_code: language } : { language_detection: true }),
  };
}

export async function transcribeAssemblyAI({
  apiKey,
  baseUrl,
  model,
  fileUrl,
  config = {},
  resumeId,
  onSubmitted,
  signal,
  custom = false,
}) {
  const base = apiBase(baseUrl);
  const headers = { authorization: apiKey, "content-type": "application/json" };
  const speechModels = assemblyAISpeechModels({ model, tier: config.tier });
  const diarize = config.diarize !== false;

  const getTranscript = async (id) => {
    const response = await fetchWithRetry(`${base}/v2/transcript/${encodeURIComponent(id)}`, { headers }, {
      signal,
      timeoutMs: REQUEST_TIMEOUT_MS,
      custom,
    });
    if (response.status === 404) return null;
    const payload = await readJson(response);
    if (!response.ok) throw providerError(response, payload, apiKey);
    return payload;
  };

  const submit = async () => {
    if (!fileUrl) {
      throw new EngineError("invalid_input", "A media URL is required for AssemblyAI transcription.", { status: 422 });
    }
    const response = await fetchWithRetry(
      `${base}/v2/transcript`,
      { method: "POST", headers, body: JSON.stringify(submitBody({ fileUrl, speechModels, config })) },
      { signal, timeoutMs: REQUEST_TIMEOUT_MS, custom },
    );
    const payload = await readJson(response);
    if (!response.ok || !payload?.id) throw providerError(response, payload, apiKey);
    await onSubmitted?.(payload.id);
    return payload;
  };

  // Resume polling a transcript a previous attempt already paid for; resubmit only when it is
  // gone (deleted / expired) or ended in error (AssemblyAI doesn't bill failed transcripts).
  let transcript = resumeId ? await getTranscript(resumeId) : null;
  if (!transcript || transcript.status === "error") transcript = await submit();
  const id = transcript.id;

  const deadline = Date.now() + transcriptionTimeoutMs(config.durationMs);
  let delay = POLL_START_MS;
  while (transcript.status !== "completed") {
    if (transcript.status === "error") {
      throw new EngineError("transcription_failed", `Transcription failed: ${providerDetail(transcript, apiKey)}`, {
        status: 502,
      });
    }
    if (Date.now() + delay > deadline) {
      throw new EngineError("transcription_timeout", MESSAGES.timeout, { status: 504 });
    }
    await sleep(delay, signal);
    delay = nextPollDelay(delay);
    transcript = await getTranscript(id);
    if (!transcript) {
      throw new EngineError("transcription_failed", "Transcription failed: the provider no longer has this transcript.", {
        status: 502,
        retryable: true,
      });
    }
  }

  const { durationMs, language, segments } = normalizeAssemblyAI(transcript, { diarize });

  // Best effort: the caller caches the raw JSON, so the provider copy isn't needed any more.
  await fetchWithRetry(`${base}/v2/transcript/${encodeURIComponent(id)}`, { method: "DELETE", headers }, {
    signal,
    timeoutMs: REQUEST_TIMEOUT_MS,
    retries: 1,
    custom,
  })
    .then((response) => response.body?.cancel())
    .catch(() => {});

  if (!segments.length) throw new EngineError("no_speech", MESSAGES.noSpeech, { status: 422 });

  return {
    provider: "assemblyai",
    providerJobId: id,
    model: transcript.speech_model_used || speechModels[0],
    durationMs,
    language,
    segments,
    raw: transcript,
  };
}
