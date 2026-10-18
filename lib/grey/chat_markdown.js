// Pure markdown parsing for Playground answers (no I/O, no HTML). Covers what chat models
// actually emit — paragraphs, headings, lists (nested), fenced code, block quotes, GFM
// tables, rules, bold/italic/strike, inline code, links — plus Grey's [n] citation markers.
// The output is a small AST the Playground renders as React nodes, so model text never
// reaches the DOM as markup. Unclosed fences (a reply mid-stream) parse as open code blocks.
//
// Block:  { type: "paragraph" | "heading", inline, level? } | { type: "code", lang, text, open }
//         | { type: "list", ordered, start, items: [{ blocks }] } | { type: "quote", blocks }
//         | { type: "table", align, header, rows } | { type: "hr" }
// Inline: { type: "text", text } | { type: "code", text } | { type: "cite", n }
//         | { type: "strong" | "em" | "del", children } | { type: "link", href, children }

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/;
const HR_RE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const QUOTE_RE = /^\s{0,3}>\s?/;
const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

const indentOf = (line) => line.match(/^\s*/)[0].replace(/\t/g, "  ").length;
const isBlank = (line) => !line.trim();

function isTableStart(lines, i) {
  return lines[i].includes("|") && i + 1 < lines.length && lines[i + 1].includes("|") && TABLE_SEPARATOR_RE.test(lines[i + 1]);
}

function startsBlock(lines, i) {
  const line = lines[i];
  return FENCE_RE.test(line) || HR_RE.test(line) || HEADING_RE.test(line) || QUOTE_RE.test(line) || LIST_RE.test(line) || isTableStart(lines, i);
}

function splitRow(line) {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);
  return row.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function cellAlign(cell) {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  return left ? "left" : null;
}

// Strips the smallest shared indent so nested content parses as top-level blocks.
function dedent(lines) {
  const indents = lines.filter((l) => !isBlank(l)).map(indentOf);
  const cut = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.replace(/\t/g, "  ").slice(Math.min(cut, indentOf(l))));
}

function parseList(lines, start) {
  const first = LIST_RE.exec(lines[start]);
  const base = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      let j = i + 1;
      while (j < lines.length && isBlank(lines[j])) j += 1;
      const next = j < lines.length ? LIST_RE.exec(lines[j]) : null;
      const continues = j < lines.length && (indentOf(lines[j]) > base || (next && next[1].length === base && /\d/.test(next[2]) === ordered));
      if (!continues) break;
      items.at(-1)?.lines.push("");
      i = j;
      continue;
    }
    const m = LIST_RE.exec(line);
    if (m && m[1].length <= base + 1 && m[1].length >= base - 1) {
      if (/\d/.test(m[2]) !== ordered) break;
      items.push({ lines: [m[3]] });
    } else if (items.length && indentOf(line) > base) {
      items.at(-1).lines.push(line);
    } else if (items.length && !startsBlock(lines, i)) {
      // Lazy continuation of the item's paragraph.
      items.at(-1).lines.push(line.trim());
    } else {
      break;
    }
    i += 1;
  }

  const blocks = items.map((item) => {
    const [head, ...rest] = item.lines;
    return { blocks: parseBlocks([head, ...dedent(rest)]) };
  });
  return { block: { type: "list", ordered, start: ordered ? Number.parseInt(first[2], 10) : null, items: blocks }, next: i };
}

function parseBlocks(lines) {
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i += 1;
      continue;
    }

    const fence = FENCE_RE.exec(line);
    if (fence) {
      const marker = fence[1];
      const closing = new RegExp(`^\\s{0,3}\\${marker[0]}{${marker.length},}\\s*$`);
      const body = [];
      i += 1;
      while (i < lines.length && !closing.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      const open = i >= lines.length;
      blocks.push({ type: "code", lang: fence[2] || null, text: body.join("\n"), open });
      i += 1;
      continue;
    }

    if (HR_RE.test(line)) {
      blocks.push({ type: "hr" });
      i += 1;
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, inline: parseInline(heading[2]) });
      i += 1;
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const body = [];
      while (i < lines.length && !isBlank(lines[i]) && (QUOTE_RE.test(lines[i]) || body.length)) {
        if (!QUOTE_RE.test(lines[i]) && startsBlock(lines, i)) break;
        body.push(lines[i].replace(QUOTE_RE, ""));
        i += 1;
      }
      blocks.push({ type: "quote", blocks: parseBlocks(body) });
      continue;
    }

    if (isTableStart(lines, i)) {
      const header = splitRow(lines[i]);
      const align = splitRow(lines[i + 1]).map(cellAlign);
      const rows = [];
      i += 2;
      while (i < lines.length && !isBlank(lines[i]) && lines[i].includes("|")) {
        const cells = splitRow(lines[i]);
        rows.push(header.map((_, c) => parseInline(cells[c] ?? "")));
        i += 1;
      }
      blocks.push({ type: "table", align: header.map((_, c) => align[c] ?? null), header: header.map((h) => parseInline(h)), rows });
      continue;
    }

    if (LIST_RE.test(line)) {
      const { block, next } = parseList(lines, i);
      blocks.push(block);
      i = next;
      continue;
    }

    const body = [line.trim()];
    i += 1;
    while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines, i)) {
      body.push(lines[i].trim());
      i += 1;
    }
    blocks.push({ type: "paragraph", inline: parseInline(body.join("\n")) });
  }

  return blocks;
}

// Earliest match wins; on a tie the earlier rule does (code before links before emphasis).
const INLINE_RULES = [
  { type: "code", re: /`([^`\n]+)`/ },
  { type: "link", re: /\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/ },
  { type: "cite", re: /\[(\d+(?:\s*,\s*\d+)*)\](?!\()/ },
  { type: "strong", re: /\*\*(?=\S)([\s\S]*?\S)\*\*|__(?=\S)([\s\S]*?\S)__/ },
  { type: "del", re: /~~(?=\S)([\s\S]*?\S)~~/ },
  { type: "em", re: /(?<![\w*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![\w*])|(?<![\w_])_(?=[^\s_])([^_\n]*?[^\s_])_(?![\w_])/ },
  { type: "url", re: /https?:\/\/[^\s<>()[\]]*[^\s<>()[\].,;:!?'"]/ },
];

function pushText(tokens, text) {
  if (!text) return;
  const last = tokens.at(-1);
  if (last?.type === "text") last.text += text;
  else tokens.push({ type: "text", text });
}

export function parseInline(text) {
  const tokens = [];
  let rest = String(text ?? "");

  while (rest) {
    let best = null;
    for (const rule of INLINE_RULES) {
      const match = rule.re.exec(rest);
      if (match && (!best || match.index < best.match.index)) best = { rule, match };
    }
    if (!best) {
      pushText(tokens, rest);
      break;
    }

    const { rule, match } = best;
    pushText(tokens, rest.slice(0, match.index));
    const inner = match[1] ?? match[2] ?? "";
    if (rule.type === "code") tokens.push({ type: "code", text: inner });
    else if (rule.type === "link") tokens.push({ type: "link", href: match[2], children: parseInline(inner) });
    else if (rule.type === "url") tokens.push({ type: "link", href: match[0], children: [{ type: "text", text: match[0] }] });
    else if (rule.type === "cite") {
      for (const part of inner.split(",")) tokens.push({ type: "cite", n: Number(part.trim()) });
    } else tokens.push({ type: rule.type, children: parseInline(inner) });
    rest = rest.slice(match.index + match[0].length);
  }

  return tokens;
}

export function parseMarkdown(text) {
  return parseBlocks(String(text ?? "").replace(/\r\n?/g, "\n").split("\n"));
}
