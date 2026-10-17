// Pure helpers for the transcription drivers (lib/engine/drivers/transcribe/*): request planning and
// provider response -> segment normalisation. No I/O, so the worker, routes and tests share them.
//
// Segment shape (the transcribe() contract): { startMs, endMs, speaker, text, words? }
//   speaker — "A", "B", … in order of first appearance, or null without diarization
//   words   — [{ text, startMs, endMs }] when the provider returned word timings

const SENTENCE_END = /[.!?…]["'”’)\]]*$/;

const MINUTE_MS = 60 * 1000;
export const POLL_START_MS = 5000;
export const POLL_MAX_MS = 15000;

// AssemblyAI speech models (POST /v2/transcript `speech_models`, verified against the API reference
// 2026-10). The list is a fallback chain: languages outside Universal-3.5 Pro's set route to Universal-2.
export const ASSEMBLYAI_MODELS = {
  standard: ["universal-2"],
  high: ["universal-3-5-pro", "universal-2"],
};

// Model ids that mean "pick by tier" (the registry suggests the generic "universal").
const ASSEMBLYAI_AUTO = new Set(["", "auto", "universal"]);

// Explicit model (Settings → transcription model) wins; otherwise the preset tier picks:
// Universal-2 for fast / balanced / auto, Universal-3.5 Pro (with Universal-2 fallback) for high.
export function assemblyAISpeechModels({ model, tier } = {}) {
  const explicit = typeof model === "string" ? model.trim().toLowerCase() : "";
  if (!ASSEMBLYAI_AUTO.has(explicit)) {
    return explicit === "universal-2" ? ["universal-2"] : [explicit, "universal-2"];
  }
  return tier === "high" ? [...ASSEMBLYAI_MODELS.high] : [...ASSEMBLYAI_MODELS.standard];
}

// OpenAI-format response_format per model: whisper-style models (and unknown self-hosted ones) give
// segment timestamps through verbose_json; the diarize model uses diarized_json; the other gpt-*
// transcribe models only return plain json text.
export function openAIResponseFormat(model) {
  const id = String(model || "").toLowerCase();
  if (id.includes("diarize")) return "diarized_json";
  if (/^gpt-.*transcribe/.test(id)) return "json";
  return "verbose_json";
}

// Default OpenAI-format model when Settings leaves it empty: the first registry suggestion that
// returns segment timestamps (citations deep-link into the media), else the first, else whisper-1.
export function defaultOpenAITranscribeModel(suggestions) {
  const ids = (Array.isArray(suggestions) ? suggestions : []).map((m) => m?.id).filter(Boolean);
  return ids.find((id) => openAIResponseFormat(id) === "verbose_json") || ids[0] || "whisper-1";
}

// 5 s, backing off ×1.5 per poll to 15 s.
export function nextPollDelay(currentMs) {
  const current = Number(currentMs) > 0 ? Number(currentMs) : POLL_START_MS;
  return Math.min(POLL_MAX_MS, Math.round(current * 1.5));
}

// max(30 min, 2 × duration); unknown duration -> 30 min.
export function transcriptionTimeoutMs(durationMs) {
  const duration = Number(durationMs) > 0 ? Number(durationMs) : 0;
  return Math.max(30 * MINUTE_MS, 2 * duration);
}

// Provider error text is shown to users: strip URLs (signed media URLs carry tokens), collapse
// whitespace and cap the length. Callers still pass the result through redact() for keys.
export function cleanProviderMessage(value, max = 300) {
  const text = String(value ?? "")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "Unknown error";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function toMs(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function secondsToMs(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : 0;
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

// Maps provider speaker ids to "A", "B", … in order of first appearance ("S27", "S28", … past Z).
function speakerLabeler() {
  const labels = new Map();
  return (raw) => {
    if (raw === null || raw === undefined || raw === "") return null;
    const key = String(raw);
    if (!labels.has(key)) {
      const i = labels.size;
      labels.set(key, i < 26 ? String.fromCharCode(65 + i) : `S${i + 1}`);
    }
    return labels.get(key);
  };
}

function lastEnd(segments) {
  return segments.reduce((max, s) => Math.max(max, s.endMs), 0);
}

function mapAssemblyWords(words) {
  if (!Array.isArray(words)) return [];
  return words
    .map((w) => {
      const startMs = toMs(w?.start);
      return { text: cleanText(w?.text), startMs, endMs: Math.max(startMs, toMs(w?.end)) };
    })
    .filter((w) => w.text);
}

// Groups timed words into sentences (closing on . ! ? …) for transcripts without diarization.
export function sentencesFromWords(words) {
  const segments = [];
  let current = [];
  const flush = () => {
    if (!current.length) return;
    segments.push({
      startMs: current[0].startMs,
      endMs: Math.max(current[0].startMs, current[current.length - 1].endMs),
      speaker: null,
      text: current.map((w) => w.text).join(" "),
      words: current,
    });
    current = [];
  };
  for (const word of words || []) {
    current.push(word);
    if (SENTENCE_END.test(word.text)) flush();
  }
  flush();
  return segments;
}

// AssemblyAI GET /v2/transcript/{id} (status completed) -> { durationMs, language, segments }.
// Diarized: one segment per utterance. Otherwise (or when no utterances came back): sentences
// built from the word timings; plain text without words becomes one segment over the file.
export function normalizeAssemblyAI(transcript, { diarize = true } = {}) {
  const t = transcript || {};
  const audioMs = secondsToMs(t.audio_duration);
  const utterances = Array.isArray(t.utterances) ? t.utterances : [];
  let segments;

  if (diarize && utterances.length) {
    const label = speakerLabeler();
    segments = utterances
      .map((u) => {
        const startMs = toMs(u?.start);
        const words = mapAssemblyWords(u?.words);
        const segment = {
          startMs,
          endMs: Math.max(startMs, toMs(u?.end)),
          speaker: label(u?.speaker),
          text: cleanText(u?.text),
        };
        return words.length ? { ...segment, words } : segment;
      })
      .filter((s) => s.text);
  } else {
    segments = sentencesFromWords(mapAssemblyWords(t.words));
    const text = cleanText(t.text);
    if (!segments.length && text) {
      segments = [{ startMs: 0, endMs: audioMs, speaker: null, text }];
    }
  }

  return {
    durationMs: audioMs || lastEnd(segments),
    language: t.language_code || null,
    segments,
  };
}

// OpenAI-format transcription response -> { durationMs, language, segments }.
// verbose_json: segments with speaker null. diarized_json: segments with speakers (relabelled A, B…).
// json: text only -> one segment over the file (`durationMs` hint from the caller when known).
export function normalizeOpenAI(body, { durationMs } = {}) {
  const b = body || {};
  const usageMs = b.usage?.type === "duration" ? secondsToMs(b.usage.seconds) : 0;
  const reportedMs = secondsToMs(b.duration) || usageMs;
  const label = speakerLabeler();

  let segments = (Array.isArray(b.segments) ? b.segments : [])
    .map((s) => {
      const startMs = secondsToMs(s?.start);
      return {
        startMs,
        endMs: Math.max(startMs, secondsToMs(s?.end)),
        speaker: label(s?.speaker),
        text: cleanText(s?.text),
      };
    })
    .filter((s) => s.text);

  const text = cleanText(b.text);
  if (!segments.length && text) {
    segments = [{ startMs: 0, endMs: reportedMs || toMs(durationMs), speaker: null, text }];
  }

  const language = b.language || (Array.isArray(b.languages) ? b.languages[0]?.code : null) || null;
  return {
    durationMs: reportedMs || lastEnd(segments) || toMs(durationMs),
    language,
    segments,
  };
}
