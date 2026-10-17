// Pure Markdown -> block list (spec §6.2). Every parser emits Markdown per page; this turns it
// into the heading / paragraph / list / table / code blocks the chunker packs.
//
// The Markdown lexer is injected (`marked.lexer` in the worker) so this module stays importable
// from anywhere without pulling `marked` into the app bundle.
//
// Block: { type: 'heading'|'paragraph'|'list'|'table'|'code'|'blockquote', text, page, depth?, header?, rows?, lang? }
//   heading -> depth (1-6), text is plain heading text
//   table   -> header = [header line, separator line], rows = one line per row (for header-repeating splits)

const SKIPPED = new Set(["space", "hr", "def", "br"]);

// Inline Markdown -> plain text, for heading paths.
export function plainInline(text) {
  return String(text || "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    // underscores only as emphasis at word boundaries, so snake_case survives
    .replace(/(^|\W)__(.+?)__(?=\W|$)/g, "$1$2")
    .replace(/(^|\W)_(.+?)_(?=\W|$)/g, "$1$2")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(html) {
  return String(html || "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

export function tokensToBlocks(tokens, { page = null } = {}) {
  const blocks = [];
  for (const token of tokens || []) {
    if (!token || SKIPPED.has(token.type)) continue;
    const raw = String(token.raw ?? token.text ?? "");
    switch (token.type) {
      case "heading": {
        const text = plainInline(token.text ?? raw.replace(/^#+\s*/, ""));
        if (text) blocks.push({ type: "heading", depth: Math.min(6, Math.max(1, token.depth || 1)), text, page });
        break;
      }
      case "table": {
        const lines = raw
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        if (lines.length >= 2) {
          blocks.push({ type: "table", text: lines.join("\n"), header: lines.slice(0, 2), rows: lines.slice(2), page });
        } else if (lines.length) {
          blocks.push({ type: "paragraph", text: lines.join("\n"), page });
        }
        break;
      }
      case "code": {
        const text = raw.trim();
        if (text) blocks.push({ type: "code", text, lang: token.lang || null, page });
        break;
      }
      case "list":
      case "blockquote": {
        // trimEnd only: nested list indentation is meaningful.
        const text = raw.replace(/\s+$/, "").replace(/^\n+/, "");
        if (text.trim()) blocks.push({ type: token.type, text, page });
        break;
      }
      case "html": {
        const text = stripTags(raw);
        if (text) blocks.push({ type: "paragraph", text, page });
        break;
      }
      default: {
        const text = raw.trim();
        if (text) blocks.push({ type: "paragraph", text, page });
      }
    }
  }
  return blocks;
}

// input: a Markdown string or [{ page, markdown }]. lexer: (markdown) => tokens.
export function markdownToBlocks(input, { lexer } = {}) {
  if (typeof lexer !== "function") throw new Error("markdownToBlocks needs a lexer (e.g. marked.lexer)");
  const pages = typeof input === "string" ? [{ page: null, markdown: input }] : input || [];
  const blocks = [];
  for (const { page = null, markdown } of pages) {
    const text = String(markdown || "");
    if (!text.trim()) continue;
    blocks.push(...tokensToBlocks(lexer(text), { page }));
  }
  return blocks;
}
