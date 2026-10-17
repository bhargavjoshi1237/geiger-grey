// HTML / URL pages (spec §6.2): @mozilla/readability over a linkedom DOM picks the article,
// turndown converts it to Markdown. Also provides the shared turndown setup (tables as GFM,
// images as alt text only) used for DOCX via mammoth.
import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";

const MIN_ARTICLE_CHARS = 200;

const cellText = (node) =>
  String(node.textContent || "")
    .replace(/\s+/g, " ")
    .replace(/\|/g, "\\|")
    .trim();

const childrenNamed = (node, pattern) => Array.from(node?.childNodes || []).filter((c) => pattern.test(String(c.nodeName || "")));

// Rows of this table only (not of tables nested inside its cells). Works on any DOM
// (turndown's domino, linkedom) — no reliance on iterable NodeLists.
function tableRows(table) {
  const rows = [];
  for (const child of childrenNamed(table, /^(tr|thead|tbody|tfoot)$/i)) {
    if (/^tr$/i.test(child.nodeName)) rows.push(child);
    else rows.push(...childrenNamed(child, /^tr$/i));
  }
  return rows;
}

function tableToMarkdown(table) {
  const rows = tableRows(table)
    .map((tr) => childrenNamed(tr, /^(td|th)$/i).map(cellText))
    .filter((r) => r.length && r.some(Boolean));
  if (!rows.length) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const line = (r) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`;
  const [header, ...body] = rows;
  return [line(header), `| ${Array(width).fill("---").join(" | ")} |`, ...body.map(line)].join("\n");
}

export function createTurndown() {
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "_",
    hr: "---",
  });
  td.remove(["script", "style", "noscript", "iframe", "svg", "canvas", "button", "input", "select", "textarea", "template"]);
  td.addRule("gfmTable", {
    filter: "table",
    replacement: (_content, node) => {
      const md = tableToMarkdown(node);
      return md ? `\n\n${md}\n\n` : "\n\n";
    },
  });
  // Never inline image data (mammoth embeds images as base64 data URIs).
  td.addRule("imageAlt", {
    filter: "img",
    replacement: (_content, node) => {
      const alt = String(node.getAttribute?.("alt") || "").trim();
      return alt ? ` ${alt} ` : "";
    },
  });
  return td;
}

export function htmlToMarkdown(html) {
  return createTurndown()
    .turndown(String(html || ""))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function fallbackBody(html) {
  const { document } = parseHTML(html);
  for (const el of document.querySelectorAll("script, style, noscript, nav, header, footer, aside, form")) el.remove();
  return { html: document.body?.innerHTML || document.documentElement?.innerHTML || "", title: document.title || "" };
}

// -> { pages: [{ page: null, markdown }], paginated: false, title }
export function parseHtml({ html, url = null }) {
  const source = String(html || "");
  let contentHtml = "";
  let title = "";
  try {
    const { document } = parseHTML(source);
    if (url) {
      try {
        const base = document.createElement("base");
        base.setAttribute("href", url);
        document.head?.appendChild(base);
      } catch {
        // relative links stay relative
      }
    }
    const article = new Readability(document, { charThreshold: MIN_ARTICLE_CHARS }).parse();
    if (article?.content && String(article.textContent || "").trim().length >= MIN_ARTICLE_CHARS) {
      contentHtml = article.content;
      title = article.title || "";
    }
  } catch {
    // Readability can throw on odd markup; fall back to the body below.
  }
  if (!contentHtml) {
    const body = fallbackBody(source);
    contentHtml = body.html;
    title = title || body.title;
  }
  let markdown = htmlToMarkdown(contentHtml);
  title = String(title || "").replace(/\s+/g, " ").trim();
  if (title && !markdown.startsWith(`# ${title}`)) markdown = `# ${title}\n\n${markdown}`;
  return { pages: [{ page: null, markdown }], paginated: false, title };
}
