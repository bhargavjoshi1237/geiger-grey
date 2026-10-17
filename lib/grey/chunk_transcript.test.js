import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkTranscript, estimateTokens } from "./chunk_transcript.js";

const s = (startSec, endSec, text, speaker = null, extra = {}) => ({
  startMs: startSec * 1000,
  endMs: endSec * 1000,
  speaker,
  text,
  ...extra,
});

// Ten-second segments with short text, so only the time window matters.
const timeline = (count, { speaker = null, step = 10 } = {}) =>
  Array.from({ length: count }, (_, i) => s(i * step, (i + 1) * step, `Segment ${i}.`, speaker));

const wordCount = (text) => String(text).split(/\s+/).filter(Boolean).length;

test("empty or invalid input gives no chunks", () => {
  assert.deepEqual(chunkTranscript([]), []);
  assert.deepEqual(chunkTranscript(null), []);
  assert.deepEqual(chunkTranscript([s(0, 1, "   "), { text: "" }]), []);
});

test("segments are sorted by start time and empties dropped", () => {
  const chunks = chunkTranscript([s(20, 30, "third."), s(0, 10, "first."), s(10, 12, " "), s(10, 20, "second.")]);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].content, "first. second. third.");
  assert.equal(chunks[0].startMs, 0);
  assert.equal(chunks[0].endMs, 30000);
  assert.equal(chunks[0].ordinal, 0);
});

test("chunks never span more than the window", () => {
  const chunks = chunkTranscript(timeline(12), { windowSeconds: 45, overlapSeconds: 0 });
  assert.ok(chunks.length >= 3);
  for (const c of chunks) assert.ok(c.endMs - c.startMs <= 45000, `${c.startMs}-${c.endMs}`);
  assert.equal(chunks[0].endMs, 40000);
  assert.equal(chunks[1].startMs, 40000);
  assert.equal(chunks.map((c) => c.content).join(" "), timeline(12).map((x) => x.text).join(" "));
});

test("chunks never exceed the token limit", () => {
  const long = "word ".repeat(60).trim(); // 60 words
  const segments = Array.from({ length: 10 }, (_, i) => s(i, i + 1, long));
  const chunks = chunkTranscript(segments, { maxTokens: 150, overlapSeconds: 0, countTokens: wordCount });
  assert.equal(chunks.length, 5);
  for (const c of chunks) {
    assert.ok(c.tokenCount <= 150);
    assert.equal(c.tokenCount, wordCount(c.content));
  }
});

test("a speaker change closes the chunk once it is at least half the window", () => {
  const segments = [s(0, 10, "Hello.", "A"), s(10, 20, "Welcome.", "A"), s(20, 25, "Thanks.", "B"), s(25, 30, "Sure.", "B")];
  const chunks = chunkTranscript(segments, { windowSeconds: 40, overlapSeconds: 0 });
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].content, "Speaker A: Hello. Welcome.");
  assert.deepEqual(chunks[0].speakers, ["A"]);
  assert.equal(chunks[1].content, "Speaker B: Thanks. Sure.");
  assert.equal(chunks[1].startMs, 20000);
});

test("a speaker change before half the window keeps packing and merges lines", () => {
  const segments = [s(0, 5, "Hi.", "A"), s(5, 8, "Hey.", "B"), s(8, 10, "How are you?", "B"), s(10, 14, "Good.", "A")];
  const chunks = chunkTranscript(segments, { windowSeconds: 45 });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].content, "Speaker A: Hi.\nSpeaker B: Hey. How are you?\nSpeaker A: Good.");
  assert.deepEqual(chunks[0].speakers, ["A", "B"]);
});

test("no speaker prefix without diarization", () => {
  const chunks = chunkTranscript([s(0, 5, "One."), s(5, 10, "Two.")]);
  assert.equal(chunks[0].content, "One. Two.");
  assert.deepEqual(chunks[0].speakers, []);
});

test("an oversized segment with word timings splits at word timings, preferring sentence ends", () => {
  // 100 words, one per second; sentence ends every 10 words.
  const words = Array.from({ length: 100 }, (_, i) => ({
    text: (i + 1) % 10 === 0 ? `w${i}.` : `w${i}`,
    startMs: i * 1000,
    endMs: i * 1000 + 900,
  }));
  const segment = s(0, 100, words.map((w) => w.text).join(" "), "A", { words });
  const chunks = chunkTranscript([segment], { windowSeconds: 45, overlapSeconds: 0 });
  assert.ok(chunks.length >= 3);
  for (const c of chunks) {
    assert.ok(c.endMs - c.startMs <= 45000);
    assert.ok(c.content.startsWith("Speaker A: "));
  }
  // First cut lands on a sentence end inside the window (w39.), not mid-sentence.
  assert.ok(chunks[0].content.endsWith("w39."));
  assert.equal(chunks[0].endMs, 39900);
  assert.equal(chunks[1].startMs, 40000);
  const rejoined = chunks.map((c) => c.content.replace(/^Speaker A: /, "")).join(" ");
  assert.equal(rejoined, words.map((w) => w.text).join(" "));
});

test("an oversized segment without word timings interpolates times across the text", () => {
  const sentence = "alpha beta gamma delta epsilon zeta eta theta iota kappa.";
  const text = Array.from({ length: 9 }, () => sentence).join(" ");
  const chunks = chunkTranscript([s(0, 90, text)], { windowSeconds: 30, overlapSeconds: 0 });
  assert.ok(chunks.length >= 3);
  for (const c of chunks) {
    assert.ok(c.endMs - c.startMs <= 30000, `${c.startMs}-${c.endMs}`);
    assert.ok(c.content.endsWith("kappa."), c.content);
  }
  assert.equal(chunks[0].startMs, 0);
  assert.equal(chunks[chunks.length - 1].endMs, 90000);
  for (let i = 1; i < chunks.length; i += 1) assert.ok(chunks[i].startMs >= chunks[i - 1].endMs);
  assert.equal(chunks.map((c) => c.content).join(" "), text);
});

test("an oversized segment splits on the token limit too", () => {
  const text = Array.from({ length: 40 }, (_, i) => `t${i}`).join(" ");
  const chunks = chunkTranscript([s(0, 10, text)], { maxTokens: 15, overlapSeconds: 0, countTokens: wordCount });
  assert.ok(chunks.length >= 3);
  for (const c of chunks) assert.ok(c.tokenCount <= 15);
});

test("overlap carries trailing whole segments within overlapSeconds", () => {
  const segments = [s(0, 10, "a."), s(10, 20, "b."), s(20, 30, "c."), s(30, 40, "d."), s(40, 44, "e."), s(44, 54, "f.")];
  const withOverlap = chunkTranscript(segments, { windowSeconds: 45, overlapSeconds: 5 });
  assert.equal(withOverlap.length, 2);
  assert.equal(withOverlap[0].content, "a. b. c. d. e.");
  assert.equal(withOverlap[1].content, "e. f.");
  assert.equal(withOverlap[1].startMs, 40000);

  const without = chunkTranscript(segments, { windowSeconds: 45, overlapSeconds: 0 });
  assert.equal(without[1].content, "f.");
  assert.equal(without[1].startMs, 44000);
});

test("overlap never carries a whole previous chunk", () => {
  // "short." alone fills the first chunk (adding the 43 s segment would pass the window); carrying it
  // whole into the next chunk would duplicate the chunk.
  const segments = [s(0, 3, "short."), s(3, 46, "long one.")];
  const chunks = chunkTranscript(segments, { windowSeconds: 45, overlapSeconds: 5 });
  assert.deepEqual(chunks.map((c) => c.content), ["short.", "long one."]);
});

test("ordinals are sequential and chunks stay in time order", () => {
  const shuffled = [...timeline(20)].reverse();
  const chunks = chunkTranscript(shuffled, { windowSeconds: 45 });
  chunks.forEach((c, i) => assert.equal(c.ordinal, i));
  for (let i = 1; i < chunks.length; i += 1) assert.ok(chunks[i].startMs >= chunks[i - 1].startMs);
});

test("default token estimate is about four characters per token", () => {
  assert.equal(estimateTokens("abcdefgh"), 2);
  assert.equal(estimateTokens(""), 0);
});
