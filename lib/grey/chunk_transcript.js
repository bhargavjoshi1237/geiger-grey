// Transcript chunking (spec §9.3) — packs time-coded transcript segments into retrieval chunks.
//
// 1. Sort by start time and drop empty segments.
// 2. Split segments that alone exceed the window or token limit at word boundaries, preferring a
//    sentence end in the latter half of the piece. Word timings are used when present; otherwise
//    times are interpolated across the segment by character offset.
// 3. Pack greedily within `windowSeconds` and `maxTokens`, closing a chunk early at a speaker
//    change once it is at least half full (by time or tokens).
// 4. Render consecutive same-speaker lines as "Speaker A: …" (no prefix without diarization).
// 5. Overlap: a new chunk starts with the previous chunk's trailing whole segments that fall
//    within `overlapSeconds` of its end (never the whole previous chunk, never past the limits).
//
// Output: [{ ordinal, content, startMs, endMs, tokenCount, speakers }], ordinals from 0.
// `countTokens` is injectable (the worker passes its tokenizer); the default is ~4 chars/token.

const SENTENCE_END = /[.!?…]["'”’)\]]*$/;

export function estimateTokens(text) {
  return Math.ceil(String(text || "").length / 4);
}

function toMs(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function speakerOf(value) {
  return value === null || value === undefined || value === "" ? null : String(value);
}

function normalizeSegments(segments) {
  return (Array.isArray(segments) ? segments : [])
    .map((s, index) => {
      const startMs = toMs(s?.startMs);
      const words = (Array.isArray(s?.words) ? s.words : [])
        .map((w) => {
          const wordStart = toMs(w?.startMs);
          return { text: cleanText(w?.text), startMs: wordStart, endMs: Math.max(wordStart, toMs(w?.endMs)) };
        })
        .filter((w) => w.text);
      return {
        index,
        text: cleanText(s?.text),
        startMs,
        endMs: Math.max(startMs, toMs(s?.endMs)),
        speaker: speakerOf(s?.speaker),
        words: words.length ? words : null,
      };
    })
    .filter((s) => s.text)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs || a.index - b.index);
}

function line(speaker, text, diarized) {
  return diarized && speaker ? `Speaker ${speaker}: ${text}` : text;
}

// Consecutive same-speaker pieces merge into one line; diarized lines are newline-separated.
function render(pieces, diarized) {
  if (!diarized) return pieces.map((p) => p.text).join(" ");
  const lines = [];
  for (const piece of pieces) {
    const last = lines[lines.length - 1];
    if (last && last.speaker === piece.speaker) last.texts.push(piece.text);
    else lines.push({ speaker: piece.speaker, texts: [piece.text] });
  }
  return lines.map((l) => line(l.speaker, l.texts.join(" "), true)).join("\n");
}

function spanOf(pieces) {
  let end = 0;
  for (const p of pieces) end = Math.max(end, p.endMs);
  return { startMs: pieces[0].startMs, endMs: Math.max(pieces[0].startMs, end) };
}

// Words with times interpolated across the segment by character offset (no word timings).
function interpolatedWords(segment) {
  const total = segment.text.length || 1;
  const span = segment.endMs - segment.startMs;
  const words = [];
  const re = /\S+/g;
  let match;
  while ((match = re.exec(segment.text))) {
    words.push({
      text: match[0],
      startMs: Math.round(segment.startMs + (span * match.index) / total),
      endMs: Math.round(segment.startMs + (span * (match.index + match[0].length)) / total),
    });
  }
  return words;
}

function splitOversized(segment, { windowMs, maxTokens, countTokens, diarized }) {
  const fits = (text, startMs, endMs) =>
    endMs - startMs <= windowMs && countTokens(line(segment.speaker, text, diarized)) <= maxTokens;
  if (fits(segment.text, segment.startMs, segment.endMs)) {
    return [{ text: segment.text, startMs: segment.startMs, endMs: segment.endMs, speaker: segment.speaker }];
  }

  const words = segment.words || interpolatedWords(segment);
  const piece = (list) => ({
    text: list.map((w) => w.text).join(" "),
    startMs: list[0].startMs,
    endMs: Math.max(list[0].startMs, list[list.length - 1].endMs),
    speaker: segment.speaker,
  });
  const fitsWords = (list) => {
    const p = piece(list);
    return fits(p.text, p.startMs, p.endMs);
  };

  const pieces = [];
  let current = [];
  for (const word of words) {
    if (!current.length || fitsWords([...current, word])) {
      current.push(word);
      continue;
    }
    // Prefer to cut after the last sentence end in the latter half of the piece.
    let cut = current.length;
    for (let i = current.length - 1; i >= Math.floor(current.length / 2); i -= 1) {
      if (SENTENCE_END.test(current[i].text)) {
        cut = i + 1;
        break;
      }
    }
    pieces.push(piece(current.slice(0, cut)));
    current = [...current.slice(cut), word];
    if (current.length > 1 && !fitsWords(current)) {
      pieces.push(piece(current.slice(0, -1)));
      current = [word];
    }
  }
  if (current.length) pieces.push(piece(current));
  return pieces;
}

export function chunkTranscript(
  segments,
  { windowSeconds = 45, maxTokens = 512, overlapSeconds = 5, countTokens = estimateTokens } = {},
) {
  const windowMs = Math.max(1, Number(windowSeconds) || 45) * 1000;
  const tokenLimit = Math.max(1, Number(maxTokens) || 512);
  const overlapMs = Math.max(0, Number(overlapSeconds) || 0) * 1000;

  const normalized = normalizeSegments(segments);
  const diarized = normalized.some((s) => s.speaker);
  const pieces = normalized.flatMap((s) =>
    splitOversized(s, { windowMs, maxTokens: tokenLimit, countTokens, diarized }),
  );

  const tokensOf = (list) => countTokens(render(list, diarized));
  const fits = (list) => {
    const { startMs, endMs } = spanOf(list);
    return endMs - startMs <= windowMs && tokensOf(list) <= tokenLimit;
  };
  const halfFull = (list) => {
    const { startMs, endMs } = spanOf(list);
    return (endMs - startMs) / windowMs >= 0.5 || tokensOf(list) / tokenLimit >= 0.5;
  };
  const overlapTail = (previous, next) => {
    if (overlapMs <= 0) return [];
    const previousEnd = spanOf(previous).endMs;
    const tail = [];
    for (let i = previous.length - 1; i >= 1; i -= 1) {
      if (previousEnd - previous[i].startMs > overlapMs) break;
      tail.unshift(previous[i]);
    }
    while (tail.length && !fits([...tail, next])) tail.shift();
    return tail;
  };

  const groups = [];
  let current = [];
  for (const piece of pieces) {
    if (!current.length) {
      current = [piece];
      continue;
    }
    const last = current[current.length - 1];
    const overflow = !fits([...current, piece]);
    const speakerBreak = diarized && piece.speaker !== last.speaker && halfFull(current);
    if (!overflow && !speakerBreak) {
      current.push(piece);
      continue;
    }
    groups.push(current);
    current = [...overlapTail(current, piece), piece];
  }
  if (current.length) groups.push(current);

  return groups.map((group, ordinal) => {
    const content = render(group, diarized);
    const { startMs, endMs } = spanOf(group);
    const speakers = [...new Set(group.map((p) => p.speaker).filter(Boolean))];
    return { ordinal, content, startMs, endMs, tokenCount: countTokens(content), speakers };
  });
}
