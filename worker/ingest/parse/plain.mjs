// Plain-text formats read directly (spec §6.2): Markdown, TXT, JSON as-is; CSV/TSV become a
// Markdown table so the chunker can split it by rows with the header repeated.

export function decodeText(buffer) {
  const text = new TextDecoder("utf-8").decode(buffer);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

const cell = (value) =>
  String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|")
    .trim();

// header: string[], rows: string[][] -> GFM table (rows padded to the widest row).
export function markdownTable(header, rows) {
  const width = Math.max(header.length, ...rows.map((r) => r.length), 1);
  const pad = (r) => Array.from({ length: width }, (_, i) => cell(r[i]));
  const line = (r) => `| ${pad(r).join(" | ")} |`;
  return [line(header), `| ${Array(width).fill("---").join(" | ")} |`, ...rows.map(line)].join("\n");
}

// RFC 4180-ish: quoted fields, doubled quotes, CRLF/LF.
export function parseCsv(text, delimiter = ",") {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => String(v).trim()));
}

export function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  const counts = [",", ";", "\t", "|"].map((d) => [d, firstLine.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

export function csvToMarkdown(text, { delimiter } = {}) {
  const rows = parseCsv(text, delimiter || detectDelimiter(text));
  if (!rows.length) return "";
  const [header, ...body] = rows;
  return markdownTable(header, body);
}

// format: 'markdown' | 'text' | 'csv' | 'json'
export function parsePlain({ buffer, text, format }) {
  const raw = text ?? decodeText(buffer);
  const markdown = format === "csv" ? csvToMarkdown(raw) : raw.replace(/\r\n/g, "\n");
  return { pages: [{ page: null, markdown }], paginated: false };
}
