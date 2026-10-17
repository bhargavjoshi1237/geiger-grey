// Geiger Notes boards (spec §6.1): notes.project_boards nodes/edges rendered as Markdown —
// board name -> heading, each node's text fields -> paragraphs, edges -> "A → B" lines.
// Nodes are read in visual order (top-to-bottom, then left-to-right).

const TEXT_FIELDS = ["label", "text", "caption", "name", "title", "description", "url"];

export function stripHtml(value) {
  return String(value ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

function nodeTexts(node) {
  const data = node?.data && typeof node.data === "object" ? node.data : {};
  const seen = new Set();
  const out = [];
  for (const field of TEXT_FIELDS) {
    const text = typeof data[field] === "string" ? stripHtml(data[field]) : "";
    if (text && !seen.has(text)) {
      seen.add(text);
      out.push(text);
    }
  }
  if (Array.isArray(data.items)) {
    const items = data.items
      .map((item) => {
        const text = stripHtml(typeof item === "string" ? item : item?.text ?? item?.label ?? item?.title ?? "");
        if (!text) return null;
        const done = typeof item === "object" && (item.done || item.checked || item.completed);
        return `- [${done ? "x" : " "}] ${text}`;
      })
      .filter(Boolean);
    if (items.length) out.push(items.join("\n"));
  }
  return out;
}

const position = (node) => ({ x: Number(node?.position?.x) || 0, y: Number(node?.position?.y) || 0 });

const shortLabel = (texts, fallback) => {
  const first = (texts[0] || "").split("\n")[0].trim();
  return first ? (first.length > 80 ? `${first.slice(0, 77)}…` : first) : fallback;
};

export function renderNotesBoard(board) {
  const nodes = (Array.isArray(board?.nodes) ? board.nodes : []).slice();
  const edges = Array.isArray(board?.edges) ? board.edges : [];
  nodes.sort((a, b) => position(a).y - position(b).y || position(a).x - position(b).x);

  const parts = [`# ${stripHtml(board?.name) || "Untitled board"}`];
  const description = stripHtml(board?.description);
  if (description) parts.push(description);

  const labels = new Map();
  for (const node of nodes) {
    const texts = nodeTexts(node);
    labels.set(node?.id, shortLabel(texts, null));
    if (texts.length) parts.push(texts.join("\n\n"));
  }

  const links = edges
    .map((edge) => {
      const from = labels.get(edge?.source);
      const to = labels.get(edge?.target);
      if (!from || !to) return null;
      const label = stripHtml(edge?.label ?? edge?.data?.label ?? "");
      return `- ${from} → ${to}${label ? ` (${label})` : ""}`;
    })
    .filter(Boolean);
  if (links.length) parts.push(`## Connections\n\n${links.join("\n")}`);

  return parts.join("\n\n");
}

export function parseNotesBoard(board) {
  return { pages: [{ page: null, markdown: renderNotesBoard(board) }], paginated: false, title: stripHtml(board?.name) || null };
}
