// Tiny document fixtures built in memory for the parser tests — no binaries in the repo.
// A minimal ZIP writer (stored entries) is enough for DOCX/PPTX; XLSX comes from exceljs;
// the PDF is assembled by hand with a correct xref table.
import { crc32 } from "node:zlib";
import ExcelJS from "exceljs";

const enc = new TextEncoder();
const xml = (s) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${s}`;

export function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const data = typeof content === "string" ? enc.encode(content) : content;
    const crc = crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const para = (text, style) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const tcell = (text) => `<w:tc>${para(text)}</w:tc>`;

export function buildDocx() {
  const body = [
    para("Employee Handbook", "Heading1"),
    para("Welcome to the company. This handbook explains our policies."),
    para("Leave", "Heading2"),
    para("Staff get 25 days of annual leave."),
    `<w:tbl><w:tr>${tcell("Type")}${tcell("Days")}</w:tr><w:tr>${tcell("Annual")}${tcell("25")}</w:tr><w:tr>${tcell("Sick")}${tcell("10")}</w:tr></w:tbl>`,
  ].join("");
  return zip({
    "[Content_Types].xml": xml(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    ),
    "_rels/.rels": xml(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ),
    "word/_rels/document.xml.rels": xml(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    ),
    "word/styles.xml": xml(
      `<w:styles ${W}><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>`,
    ),
    "word/document.xml": xml(`<w:document ${W}><w:body>${body}</w:body></w:document>`),
  });
}

const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const slide = (title, body) =>
  xml(
    `<p:sld ${P}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>` +
      `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>` +
      `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>${body}</a:t></a:r></a:p></p:txBody></p:sp>` +
      `</p:spTree></p:cSld></p:sld>`,
  );

export function buildPptx() {
  const rel = (id, type, target) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
  return zip({
    "[Content_Types].xml": xml(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>',
    ),
    "_rels/.rels": xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel("rId1", "officeDocument", "ppt/presentation.xml")}</Relationships>`),
    "ppt/presentation.xml": xml(`<p:presentation ${P}><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst></p:presentation>`),
    "ppt/_rels/presentation.xml.rels": xml(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel("rId2", "slide", "slides/slide1.xml")}${rel("rId3", "slide", "slides/slide2.xml")}</Relationships>`,
    ),
    "ppt/slides/slide1.xml": slide("Quarterly results", "Revenue grew 12 percent."),
    "ppt/slides/slide2.xml": slide("Next steps", "Hire two engineers."),
  });
}

export async function buildXlsx() {
  const wb = new ExcelJS.Workbook();
  const prices = wb.addWorksheet("Prices");
  prices.addRow(["Product", "Price", "Updated"]);
  prices.addRow(["Widget", 9.5, new Date(Date.UTC(2026, 0, 2))]);
  prices.addRow(["Gadget | Pro", { formula: "B2*2", result: 19 }, null]);
  const notes = wb.addWorksheet("Notes");
  notes.addRow(["Note"]);
  notes.addRow([{ richText: [{ text: "Rich " }, { text: "text" }] }]);
  wb.addWorksheet("Empty");
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// Two pages: a long text layer and a short one (to exercise the 200-character rule).
export function buildPdf(pageTexts = [`${"This page has a proper text layer with plenty of words. ".repeat(6)}`, "Short"]) {
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pagesId = objects.length + 1 + pageTexts.length * 2;
  const pageIds = [];
  for (const text of pageTexts) {
    const lines = text.match(/.{1,80}(\s|$)/g) || [text];
    const ops = lines.map((line, i) => `BT /F1 10 Tf 40 ${780 - i * 14} Td (${line.trim().replace(/[()\\]/g, "\\$&")}) Tj ET`).join("\n");
    const content = add(`<< /Length ${Buffer.byteLength(ops)} >>\nstream\n${ops}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  add(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

export const HTML_FIXTURE = `<!doctype html><html><head><title>Release notes</title></head><body>
<nav><a href="/">Home</a> <a href="/docs">Docs</a></nav>
<article><h1>Release notes</h1>
<p>Version 2.0 brings a redesigned editor, faster search and a new sharing model for teams of every size.</p>
<h2>Search</h2><p>Search is now three times faster thanks to a new index that is rebuilt incrementally as you type.</p>
<table><tr><th>Plan</th><th>Seats</th></tr><tr><td>Team</td><td>10</td></tr></table>
<p><img src="data:image/png;base64,AAAA" alt="Diagram of the index"></p>
<script>alert(1)</script></article>
<footer>Copyright</footer></body></html>`;
