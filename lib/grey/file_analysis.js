// Browser-only file analysis: inspects a File/Blob to produce estimateFileCost inputs
const OFFICE_MIME_PREFIXES = [
  "application/vnd.openxmlformats-officedocument",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
];

const TEXT_MIME_TYPES = new Set(["text/plain", "text/markdown", "text/csv", "application/json"]);

const isOfficeMime = (mime) => OFFICE_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix));

// Maps a mime type onto the "kind" categories estimateFileCost understands
function detectKind(mime) {
  if (mime === "application/pdf") return "document";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime === "text/html") return "web";
  if (mime === "text/markdown") return "note";
  if (TEXT_MIME_TYPES.has(mime) || isOfficeMime(mime)) return "document";
  return "document";
}

// Loads media metadata via a temporary <audio>/<video> element to read its duration
function readMediaDuration(file, tag) {
  return new Promise((resolve) => {
    const el = document.createElement(tag);
    el.preload = "metadata";
    const url = URL.createObjectURL(file);
    el.src = url;
    el.onloadedmetadata = () => {
      const durationMs = Number.isFinite(el.duration) ? Math.round(el.duration * 1000) : 0;
      URL.revokeObjectURL(url);
      resolve(durationMs);
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(0);
    };
  });
}

// Counts PDF pages by scanning the raw bytes for /Type /Page object markers
async function countPdfPages(file) {
  const buffer = await file.arrayBuffer();
  const text = new TextDecoder("latin1").decode(buffer);
  const matches = text.match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : 1;
}

// Analyzes a browser File to produce the { kind, mime, bytes, pageCount, durationMs, tokenCount }
// inputs estimateFileCost (lib/grey/cost.js) needs. Browser-only; returns null outside a browser.
export async function analyzeFile(file) {
  if (typeof window === "undefined") return null;

  const mime = file.type || "application/octet-stream";
  const bytes = file.size || 0;
  const kind = detectKind(mime);

  let pageCount = 0;
  let durationMs = 0;
  let tokenCount = 0;

  if (mime === "application/pdf") {
    pageCount = await countPdfPages(file);
    tokenCount = pageCount * 500;
  } else if (kind === "image") {
    pageCount = 1;
  } else if (kind === "audio") {
    durationMs = await readMediaDuration(file, "audio");
  } else if (kind === "video") {
    durationMs = await readMediaDuration(file, "video");
  } else if (TEXT_MIME_TYPES.has(mime) || mime === "text/html") {
    const text = await file.text();
    tokenCount = Math.ceil(text.length / 4);
    pageCount = Math.ceil(tokenCount / 500);
  } else if (isOfficeMime(mime)) {
    pageCount = Math.max(1, Math.round(bytes / 50_000));
    tokenCount = pageCount * 500;
  }

  return { kind, mime, bytes, pageCount, durationMs, tokenCount };
}
