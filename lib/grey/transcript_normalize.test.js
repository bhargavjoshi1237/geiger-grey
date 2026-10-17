import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assemblyAISpeechModels,
  cleanProviderMessage,
  defaultOpenAITranscribeModel,
  nextPollDelay,
  normalizeAssemblyAI,
  normalizeOpenAI,
  openAIResponseFormat,
  sentencesFromWords,
  transcriptionTimeoutMs,
} from "./transcript_normalize.js";
import { chunkTranscript } from "./chunk_transcript.js";

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/transcribe/${name}`, import.meta.url), "utf8"));

test("AssemblyAI utterances become speaker segments with word timings", () => {
  const out = normalizeAssemblyAI(fixture("assemblyai_completed.json"), { diarize: true });
  assert.equal(out.durationMs, 13000);
  assert.equal(out.language, "en_us");
  assert.deepEqual(
    out.segments.map(({ startMs, endMs, speaker, text }) => ({ startMs, endMs, speaker, text })),
    [
      { startMs: 240, endMs: 1400, speaker: "A", text: "Welcome to the show." },
      { startMs: 2100, endMs: 3200, speaker: "B", text: "Thanks for having me." },
      { startMs: 11800, endMs: 12700, speaker: "A", text: "Let's begin." },
    ],
  );
  assert.deepEqual(out.segments[0].words[0], { text: "Welcome", startMs: 240, endMs: 640 });
});

test("AssemblyAI speakers are relabelled A, B… in order of first appearance", () => {
  const out = normalizeAssemblyAI({
    audio_duration: 4,
    utterances: [
      { speaker: "2", start: 0, end: 1000, text: "first" },
      { speaker: "1", start: 1000, end: 2000, text: "second" },
      { speaker: "2", start: 2000, end: 3000, text: "third" },
    ],
  });
  assert.deepEqual(out.segments.map((x) => x.speaker), ["A", "B", "A"]);
});

test("AssemblyAI without diarization gives sentences from word timings, speaker null", () => {
  const out = normalizeAssemblyAI(fixture("assemblyai_completed.json"), { diarize: false });
  assert.deepEqual(
    out.segments.map(({ startMs, endMs, speaker, text }) => ({ startMs, endMs, speaker, text })),
    [
      { startMs: 240, endMs: 1400, speaker: null, text: "Welcome to the show." },
      { startMs: 2100, endMs: 3200, speaker: null, text: "Thanks for having me." },
      { startMs: 11800, endMs: 12700, speaker: null, text: "Let's begin." },
    ],
  );
});

test("AssemblyAI text without words falls back to one segment over the file", () => {
  const out = normalizeAssemblyAI({ audio_duration: 30, text: "Only text here.", words: [], utterances: null });
  assert.deepEqual(out.segments, [{ startMs: 0, endMs: 30000, speaker: null, text: "Only text here." }]);
});

test("AssemblyAI with no speech gives no segments", () => {
  const out = normalizeAssemblyAI({ audio_duration: 5, text: "", words: [], utterances: [] });
  assert.deepEqual(out.segments, []);
  assert.equal(out.durationMs, 5000);
});

test("normalised AssemblyAI segments feed chunkTranscript", () => {
  const { segments } = normalizeAssemblyAI(fixture("assemblyai_completed.json"));
  const chunks = chunkTranscript(segments);
  assert.equal(chunks.length, 1);
  assert.equal(
    chunks[0].content,
    "Speaker A: Welcome to the show.\nSpeaker B: Thanks for having me.\nSpeaker A: Let's begin.",
  );
  assert.equal(chunks[0].startMs, 240);
  assert.equal(chunks[0].endMs, 12700);
});

test("OpenAI verbose_json segments are converted to ms with speaker null", () => {
  const out = normalizeOpenAI(fixture("openai_verbose.json"));
  assert.equal(out.durationMs, 9500);
  assert.equal(out.language, "english");
  assert.deepEqual(out.segments, [
    { startMs: 0, endMs: 4200, speaker: null, text: "The quick brown fox." },
    { startMs: 4200, endMs: 9480, speaker: null, text: "Jumps over the lazy dog." },
  ]);
});

test("OpenAI diarized_json keeps speakers, relabelled A, B", () => {
  const out = normalizeOpenAI(fixture("openai_diarized.json"));
  assert.deepEqual(out.segments.map((x) => [x.speaker, x.text]), [["A", "Hi there."], ["B", "Hello."]]);
  assert.equal(out.durationMs, 6000);
});

test("OpenAI plain json text becomes one segment using the duration hint", () => {
  const out = normalizeOpenAI({ text: "Hello world.", languages: [{ code: "en" }] }, { durationMs: 42000 });
  assert.deepEqual(out.segments, [{ startMs: 0, endMs: 42000, speaker: null, text: "Hello world." }]);
  assert.equal(out.language, "en");
  assert.equal(out.durationMs, 42000);
});

test("sentencesFromWords closes on sentence punctuation", () => {
  const words = [
    { text: "Is", startMs: 0, endMs: 100 },
    { text: "it?", startMs: 100, endMs: 300 },
    { text: "Yes", startMs: 400, endMs: 500 },
  ];
  assert.deepEqual(sentencesFromWords(words).map((x) => x.text), ["Is it?", "Yes"]);
});

test("AssemblyAI speech models follow the tier unless a model is set", () => {
  assert.deepEqual(assemblyAISpeechModels({ tier: "fast" }), ["universal-2"]);
  assert.deepEqual(assemblyAISpeechModels({ tier: "balanced" }), ["universal-2"]);
  assert.deepEqual(assemblyAISpeechModels({ tier: "auto" }), ["universal-2"]);
  assert.deepEqual(assemblyAISpeechModels({ tier: "high" }), ["universal-3-5-pro", "universal-2"]);
  assert.deepEqual(assemblyAISpeechModels({ model: "universal", tier: "high" }), ["universal-3-5-pro", "universal-2"]);
  assert.deepEqual(assemblyAISpeechModels({ model: "auto", tier: "fast" }), ["universal-2"]);
  assert.deepEqual(assemblyAISpeechModels({ model: "universal-2", tier: "high" }), ["universal-2"]);
  assert.deepEqual(assemblyAISpeechModels({ model: "universal-3-5-pro" }), ["universal-3-5-pro", "universal-2"]);
});

test("OpenAI response format depends on the model", () => {
  assert.equal(openAIResponseFormat("whisper-1"), "verbose_json");
  assert.equal(openAIResponseFormat("whisper-large-v3-turbo"), "verbose_json");
  assert.equal(openAIResponseFormat(undefined), "verbose_json");
  assert.equal(openAIResponseFormat("gpt-4o-transcribe"), "json");
  assert.equal(openAIResponseFormat("gpt-transcribe"), "json");
  assert.equal(openAIResponseFormat("gpt-4o-transcribe-diarize"), "diarized_json");
});

test("the default OpenAI-format model prefers a timestamped registry suggestion", () => {
  const openai = [{ id: "gpt-4o-transcribe" }, { id: "whisper-1" }];
  assert.equal(defaultOpenAITranscribeModel(openai), "whisper-1");
  assert.equal(defaultOpenAITranscribeModel([{ id: "whisper-large-v3-turbo" }]), "whisper-large-v3-turbo");
  assert.equal(defaultOpenAITranscribeModel([{ id: "gpt-transcribe" }]), "gpt-transcribe");
  assert.equal(defaultOpenAITranscribeModel([]), "whisper-1");
});

test("polling backs off from 5 s to 15 s and times out at max(30 min, 2x duration)", () => {
  assert.equal(nextPollDelay(5000), 7500);
  assert.equal(nextPollDelay(12000), 15000);
  assert.equal(nextPollDelay(15000), 15000);
  assert.equal(transcriptionTimeoutMs(null), 30 * 60 * 1000);
  assert.equal(transcriptionTimeoutMs(10 * 60 * 1000), 30 * 60 * 1000);
  assert.equal(transcriptionTimeoutMs(60 * 60 * 1000), 120 * 60 * 1000);
});

test("provider messages lose URLs and are capped", () => {
  const msg = cleanProviderMessage("Download error, unable to download https://x.supabase.co/obj?token=abc  please retry");
  assert.equal(msg, "Download error, unable to download [url] please retry");
  assert.equal(cleanProviderMessage(""), "Unknown error");
  assert.equal(cleanProviderMessage("x".repeat(500)).length, 300);
});
