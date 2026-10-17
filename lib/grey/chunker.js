// Pure document chunker (spec §6.5).
//
// chunkDocument(blocks, chunking, { countTokens, title }) -> { chunks, meta }
//   blocks   — from markdownToBlocks() (lib/grey/markdown_blocks.js)
//   chunking — preset chunking config { strategy, size, overlap, atomicTables, headingBreadcrumbs }
//   chunks   — [{ ordinal, content, heading_path, page, start_ms, end_ms, token_count, breadcrumb, search_text, metadata }]
//
// Strategies:
//   recursive (default) — sections split at headings; blocks packed up to `size` tokens; oversized
//                         blocks split on paragraph -> line -> sentence -> space; `overlap` tokens are
//                         carried forward within a section only.
//   fixed               — token windows over the whole document with `overlap`.
//   page                — one chunk per page (oversized pages split recursively).
//   semantic            — falls back to recursive (recorded in meta.fallback).
// atomicTables: a table is never split unless it is over 2× `size`, in which case it is split by
// rows with the header repeated. The token budget is never exceeded except by such atomic tables
// (and a single table row that alone exceeds the budget).

export const DEFAULT_CHUNKING = {
  strategy: "recursive",
  size: 512,
  overlap: 64,
  atomicTables: true,
  headingBreadcrumbs: true,
};

const STRATEGIES = new Set(["recursive", "fixed", "page", "semantic"]);
const MIN_SIZE = 32;
const MAX_SIZE = 8192;
const JOIN = "\n\n";

// Rough fallback when no tokenizer is injected (~4 characters per token).
const estimateTokens = (text) => Math.ceil(String(text || "").length / 4);

const clampInt = (value, min, max, fallback) => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export function normalizeChunking(chunking = {}) {
  const size = clampInt(chunking?.size, MIN_SIZE, MAX_SIZE, DEFAULT_CHUNKING.size);
  const overlap = clampInt(chunking?.overlap, 0, Math.floor(size / 2), Math.min(DEFAULT_CHUNKING.overlap, Math.floor(size / 2)));
  const strategy = STRATEGIES.has(chunking?.strategy) ? chunking.strategy : DEFAULT_CHUNKING.strategy;
  return {
    strategy,
    size,
    overlap,
    atomicTables: chunking?.atomicTables ?? DEFAULT_CHUNKING.atomicTables,
    headingBreadcrumbs: chunking?.headingBreadcrumbs ?? DEFAULT_CHUNKING.headingBreadcrumbs,
  };
}

export function buildBreadcrumb(title, headingPath) {
  const parts = [title, ...(headingPath || [])].map((p) => String(p || "").trim()).filter(Boolean);
  return parts.length ? parts.join(" > ") : null;
}

// What gets embedded and full-text indexed: breadcrumb + enrichment context + content.
export function buildSearchText({ breadcrumb, context, content }) {
  return [breadcrumb, context, content].map((p) => String(p || "").trim()).filter(Boolean).join(JOIN);
}

// ---------------------------------------------------------------------------
// Text splitting
// ---------------------------------------------------------------------------

const SEPARATORS = [
  { re: /\n{2,}/, join: "\n\n" },
  { re: /\n/, join: "\n" },
  { re: /(?<=[.!?…])\s+/, join: " " },
  { re: /\s+/, join: " " },
];

function mergeGreedy(pieces, limit, count, joiner) {
  const out = [];
  let current = "";
  for (const piece of pieces) {
    const candidate = current ? `${current}${joiner}${piece}` : piece;
    if (!current || count(candidate) <= limit) current = candidate;
    else {
      out.push(current);
      current = piece;
    }
  }
  if (current) out.push(current);
  return out;
}

// Largest prefix within `limit` tokens, cut at whitespace when possible.
function hardSplit(text, limit, count) {
  const out = [];
  let rest = text;
  while (rest) {
    if (count(rest) <= limit) {
      out.push(rest);
      break;
    }
    let lo = 1;
    let hi = rest.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (count(rest.slice(0, mid)) <= limit) lo = mid;
      else hi = mid - 1;
    }
    let cut = lo;
    const space = rest.slice(0, lo).search(/\s\S*$/);
    if (space > 0) cut = space;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  return out.filter(Boolean);
}

// Splits text into pieces of at most `limit` tokens: paragraph -> line -> sentence -> space -> characters.
export function splitText(text, limit, count = estimateTokens, level = 0) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return [];
  if (count(trimmed) <= limit) return [trimmed];
  if (level >= SEPARATORS.length) return hardSplit(trimmed, limit, count);
  const { re, join } = SEPARATORS[level];
  const parts = trimmed
    .split(re)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length <= 1) return splitText(trimmed, limit, count, level + 1);
  const pieces = parts.flatMap((p) => (count(p) <= limit ? [p] : splitText(p, limit, count, level + 1)));
  return mergeGreedy(pieces, limit, count, join);
}

// Rows grouped under a repeated header; each group within `limit` tokens where possible.
export function splitTableRows(table, limit, count = estimateTokens) {
  const header = (table.header || []).join("\n");
  const rows = table.rows || [];
  if (!rows.length) return [table.text];
  const groups = [];
  let current = [];
  for (const row of rows) {
    const candidate = [header, ...current, row].join("\n");
    if (!current.length || count(candidate) <= limit) current.push(row);
    else {
      groups.push([header, ...current].join("\n"));
      current = [row];
    }
  }
  if (current.length) groups.push([header, ...current].join("\n"));
  return groups;
}

// Trailing text of at most `maxTokens`, starting at a sentence boundary when one is available.
function tailText(text, maxTokens, count) {
  if (maxTokens <= 0) return "";
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  let lo = 0;
  let hi = words.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (count(words.slice(words.length - mid).join(" ")) <= maxTokens) lo = mid;
    else hi = mid - 1;
  }
  if (!lo) return "";
  const tail = words.slice(words.length - lo).join(" ");
  const sentence = tail.search(/[.!?…]\s+\S/);
  if (sentence >= 0 && sentence < tail.length - 2) {
    const fromSentence = tail.slice(sentence + 1).trim();
    if (fromSentence) return fromSentence;
  }
  return tail;
}

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

const headingMarkdown = (block) => `${"#".repeat(block.depth || 1)} ${block.text}`;

// Sections start at every heading; heading-only sections produce nothing (their heading lives on
// in the children's heading paths).
function toSections(blocks) {
  const sections = [];
  const stack = [];
  let current = null;
  for (const block of blocks || []) {
    if (!block?.text) continue;
    if (block.type === "heading") {
      while (stack.length && stack[stack.length - 1].depth >= (block.depth || 1)) stack.pop();
      stack.push({ depth: block.depth || 1, text: block.text });
      current = { headingPath: stack.map((h) => h.text), heading: block, blocks: [] };
      sections.push(current);
      continue;
    }
    if (!current) {
      current = { headingPath: [], heading: null, blocks: [] };
      sections.push(current);
    }
    current.blocks.push(block);
  }
  return sections.filter((s) => s.blocks.length);
}

function sectionPieces(section, cfg, count) {
  const pieces = [];
  if (section.heading) {
    const text = headingMarkdown(section.heading);
    pieces.push({ text, tokens: count(text), kind: "heading", page: section.heading.page ?? null });
  }
  for (const block of section.blocks) {
    const page = block.page ?? null;
    const tokens = count(block.text);
    if (block.type === "table") {
      const limit = cfg.atomicTables ? cfg.size * 2 : cfg.size;
      if (tokens <= limit) {
        pieces.push({ text: block.text, tokens, kind: "table", page });
      } else {
        for (const part of splitTableRows(block, cfg.size, count)) pieces.push({ text: part, tokens: count(part), kind: "table", page });
      }
      continue;
    }
    if (tokens <= cfg.size) pieces.push({ text: block.text, tokens, kind: "text", page });
    else for (const part of splitText(block.text, cfg.size, count)) pieces.push({ text: part, tokens: count(part), kind: "text", page });
  }
  return pieces;
}

function finalizeChunk(parts, headingPath, count) {
  const content = parts.map((p) => p.text).join(JOIN).trim();
  if (!content) return null;
  const real = parts.filter((p) => p.kind !== "overlap");
  const pages = real.map((p) => p.page).filter((p) => p != null);
  const page = pages.length ? pages[0] : null;
  const pageEnd = pages.length ? pages[pages.length - 1] : null;
  const metadata = {};
  if (pageEnd != null && pageEnd !== page) metadata.pageEnd = pageEnd;
  if (real.some((p) => p.kind === "table")) metadata.table = true;
  return { content, token_count: count(content), page, heading_path: headingPath?.length ? headingPath : null, metadata };
}

function chunkRecursive(blocks, cfg, count) {
  const out = [];
  for (const section of toSections(blocks)) {
    let parts = [];
    let tokens = 0;
    const flush = () => {
      const chunk = finalizeChunk(parts, section.headingPath, count);
      if (chunk) out.push(chunk);
      const last = parts[parts.length - 1];
      parts = [];
      tokens = 0;
      return last;
    };
    const queue = sectionPieces(section, cfg, count);
    for (let i = 0; i < queue.length; i += 1) {
      const piece = queue[i];
      const joinCost = parts.length ? 1 : 0;
      if (parts.length && tokens + joinCost + piece.tokens > cfg.size) {
        // A heading never sits alone: text is split so its first part fits beside the heading;
        // a table joins it (tables are the documented budget exception).
        if (parts.every((p) => p.kind === "heading")) {
          const room = cfg.size - tokens - joinCost;
          if (piece.kind === "table" || room < MIN_SIZE / 2) {
            tokens += joinCost + piece.tokens;
            parts.push(piece);
            continue;
          }
          const [head, ...rest] = splitText(piece.text, room, count);
          queue.splice(i + 1, 0, ...rest.map((text) => ({ ...piece, text, tokens: count(text) })));
          tokens += joinCost + count(head);
          parts.push({ ...piece, text: head, tokens: count(head) });
          continue;
        }
        const last = flush();
        // overlap: only between text pieces of the same section
        if (cfg.overlap > 0 && last?.kind === "text" && piece.kind === "text") {
          const room = Math.min(cfg.overlap, cfg.size - piece.tokens - 1);
          const tail = tailText(last.text, room, count);
          if (tail) {
            parts.push({ text: tail, tokens: count(tail), kind: "overlap", page: last.page });
            tokens = parts[0].tokens;
          }
        }
      }
      tokens += (parts.length ? 1 : 0) + piece.tokens;
      parts.push(piece);
    }
    flush();
  }
  return out;
}

// Flattens blocks into word units carrying page + heading path, for fixed windows.
function wordUnits(blocks, count) {
  const units = [];
  const stack = [];
  for (const block of blocks || []) {
    if (!block?.text) continue;
    let text = block.text;
    if (block.type === "heading") {
      while (stack.length && stack[stack.length - 1].depth >= (block.depth || 1)) stack.pop();
      stack.push({ depth: block.depth || 1, text: block.text });
      text = headingMarkdown(block);
    }
    const headingPath = stack.map((h) => h.text);
    const words = text.match(/\S+\s*/g) || [];
    words.forEach((word, i) => {
      const value = i === words.length - 1 ? `${word.trimEnd()}${JOIN}` : word;
      units.push({ text: value, tokens: count(word.trim()) || 1, page: block.page ?? null, headingPath });
    });
  }
  return units;
}

function chunkFixed(blocks, cfg, count) {
  const units = wordUnits(blocks, count);
  const out = [];
  let start = 0;
  while (start < units.length) {
    let end = start;
    let tokens = 0;
    while (end < units.length && (end === start || tokens + units[end].tokens <= cfg.size)) {
      tokens += units[end].tokens;
      end += 1;
    }
    const content = units
      .slice(start, end)
      .map((u) => u.text)
      .join("")
      .trim();
    const first = units[start];
    const pieces = count(content) <= cfg.size ? [content] : splitText(content, cfg.size, count);
    for (const piece of pieces) {
      out.push({ content: piece, token_count: count(piece), page: first.page, heading_path: first.headingPath.length ? first.headingPath : null, metadata: {} });
    }
    if (end >= units.length) break;
    let next = end;
    let carried = 0;
    while (next > start + 1 && carried + units[next - 1].tokens <= cfg.overlap) {
      next -= 1;
      carried += units[next].tokens;
    }
    start = next;
  }
  return out;
}

function chunkPages(blocks, cfg, count) {
  const out = [];
  const stack = [];
  let group = null;
  const groups = [];
  for (const block of blocks || []) {
    if (!block?.text) continue;
    const page = block.page ?? null;
    if (!group || group.page !== page) {
      group = { page, headingPath: stack.map((h) => h.text), texts: [] };
      groups.push(group);
    }
    if (block.type === "heading") {
      while (stack.length && stack[stack.length - 1].depth >= (block.depth || 1)) stack.pop();
      stack.push({ depth: block.depth || 1, text: block.text });
      if (!group.texts.length) group.headingPath = stack.map((h) => h.text);
      group.texts.push(headingMarkdown(block));
    } else {
      group.texts.push(block.text);
    }
  }
  for (const g of groups) {
    const text = g.texts.join(JOIN).trim();
    if (!text) continue;
    for (const piece of splitText(text, cfg.size, count)) {
      out.push({ content: piece, token_count: count(piece), page: g.page, heading_path: g.headingPath.length ? g.headingPath : null, metadata: {} });
    }
  }
  return out;
}

export function chunkDocument(blocks, chunking = {}, { countTokens, title = null } = {}) {
  const count = typeof countTokens === "function" ? countTokens : estimateTokens;
  const cfg = normalizeChunking(chunking);
  const requested = cfg.strategy;
  const strategy = requested === "semantic" ? "recursive" : requested;
  const raw =
    strategy === "fixed" ? chunkFixed(blocks, cfg, count) : strategy === "page" ? chunkPages(blocks, cfg, count) : chunkRecursive(blocks, cfg, count);

  const chunks = raw
    .filter((c) => c.content && c.content.trim())
    .map((c, ordinal) => {
      const breadcrumb = cfg.headingBreadcrumbs ? buildBreadcrumb(title, c.heading_path) : null;
      return {
        ordinal,
        content: c.content,
        heading_path: c.heading_path,
        page: c.page ?? null,
        start_ms: null,
        end_ms: null,
        token_count: c.token_count,
        breadcrumb,
        search_text: buildSearchText({ breadcrumb, content: c.content }),
        metadata: c.metadata || {},
      };
    });

  return {
    chunks,
    meta: { strategy, requested, fallback: requested === "semantic" ? "semantic" : null, size: cfg.size, overlap: cfg.overlap },
  };
}
