// Image input validation (spec §5.1): sniff the real type from the bytes, read the dimensions
// from the file header, and enforce Grey's caps. Pure and browser-safe (Uint8Array and atob
// only, no Node APIs, no I/O) so the upload UI and the server apply the same rules.

export const IMAGE_LIMITS = {
  maxBytes: 4 * 1024 * 1024,
  maxSide: 2048,
  maxPixels: 4_200_000,
  mimeTypes: ["image/jpeg", "image/png", "image/webp"],
  clientMaxSide: 1280,
};

// dHash distance at or below this = near duplicate.
export const NEAR_DUPLICATE_BITS = 6;

const MESSAGES = {
  invalid_image: "This image couldn't be read.",
  unsupported_image_type: "Use a JPEG, PNG or WebP image.",
  image_too_large: `Images must be ${IMAGE_LIMITS.maxBytes / (1024 * 1024)} MB or smaller.`,
  image_dimensions_too_large: `Images must be at most ${IMAGE_LIMITS.maxSide} px on each side.`,
};

const fail = (code) => ({ ok: false, code, message: MESSAGES[code] });

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function hasBytes(bytes, signature, offset = 0) {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((b, i) => bytes[offset + i] === b);
}

function ascii(bytes, offset, length) {
  if (bytes.length < offset + length) return "";
  let out = "";
  for (let i = 0; i < length; i += 1) out += String.fromCharCode(bytes[offset + i]);
  return out;
}

const u16be = (b, i) => (b[i] << 8) | b[i + 1];
const u16le = (b, i) => b[i] | (b[i + 1] << 8);
const u24le = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32be = (b, i) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
}

// -> "image/jpeg" | "image/png" | "image/webp" | "image/gif" | null
export function sniffImageType(bytes) {
  const b = asBytes(bytes);
  if (!b) return null;
  if (hasBytes(b, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (hasBytes(b, PNG_SIGNATURE)) return "image/png";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "image/webp";
  if (ascii(b, 0, 4) === "GIF8") return "image/gif";
  return null;
}

function pngDimensions(b) {
  if (b.length < 24 || ascii(b, 12, 4) !== "IHDR") return null;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

// SOF0–SOF15 carry the frame size; C4 (DHT), C8 (JPG) and CC (DAC) share the range but don't.
const isStartOfFrame = (marker) => marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

function jpegDimensions(b) {
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2; // standalone markers carry no length
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // end of image / scan data before any frame header
    const length = u16be(b, i + 2);
    if (length < 2) return null;
    if (isStartOfFrame(marker)) {
      if (i + 9 > b.length) return null;
      return { width: u16be(b, i + 7), height: u16be(b, i + 5) };
    }
    i += 2 + length;
  }
  return null;
}

function webpDimensions(b) {
  const chunk = ascii(b, 12, 4);
  if (chunk === "VP8 ") {
    // Frame tag (3 bytes), then the key-frame start code 9D 01 2A and two 14-bit sizes.
    if (b.length < 30 || !hasBytes(b, [0x9d, 0x01, 0x2a], 23)) return null;
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  if (chunk === "VP8L") {
    // Signature 0x2F, then width-1 and height-1 as two 14-bit fields.
    if (b.length < 25 || b[20] !== 0x2f) return null;
    return {
      width: 1 + (((b[22] & 0x3f) << 8) | b[21]),
      height: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)),
    };
  }
  if (chunk === "VP8X") {
    // Flags (1) + reserved (3), then canvas width-1 and height-1 as 24-bit fields.
    if (b.length < 30) return null;
    return { width: 1 + u24le(b, 24), height: 1 + u24le(b, 27) };
  }
  return null;
}

function gifDimensions(b) {
  if (b.length < 10) return null;
  return { width: u16le(b, 6), height: u16le(b, 8) };
}

// -> { width, height } | null
export function imageDimensions(bytes, mimeType) {
  const b = asBytes(bytes);
  if (!b) return null;
  const type = mimeType || sniffImageType(b);
  let dims = null;
  if (type === "image/png") dims = pngDimensions(b);
  else if (type === "image/jpeg") dims = jpegDimensions(b);
  else if (type === "image/webp") dims = webpDimensions(b);
  else if (type === "image/gif") dims = gifDimensions(b);
  return dims && dims.width > 0 && dims.height > 0 ? dims : null;
}

// Bare base64 or a base64 data URI -> canonical base64 (no whitespace, padded), or null.
function base64Payload(raw) {
  let text = String(raw).trim();
  if (/^data:/i.test(text)) {
    const comma = text.indexOf(",");
    if (comma < 0 || !/;base64$/i.test(text.slice(0, comma))) return null;
    text = text.slice(comma + 1);
  }
  text = text.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!text || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return null;
  const unpadded = text.replace(/=+$/, "");
  if (unpadded.length % 4 === 1) return null;
  return unpadded + "=".repeat((4 - (unpadded.length % 4)) % 4);
}

function decodeBase64(data) {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Validates an image sent as base64. The declared mimeType is ignored: the type is sniffed
 * from the bytes. GIF is rejected.
 * @param {{ data: string, mimeType?: string } | string} value
 * @returns {{ ok: true, image: { data, mimeType, bytes, width, height, byteLength } }
 *   | { ok: false, code: "invalid_image"|"unsupported_image_type"|"image_too_large"|"image_dimensions_too_large", message }}
 */
export function parseImageInput(value) {
  const raw = typeof value === "string" ? value : value?.data;
  if (typeof raw !== "string" || !raw.trim()) return fail("invalid_image");
  const data = base64Payload(raw);
  if (!data) return fail("invalid_image");
  // Check the size before decoding so an oversized payload is never expanded.
  const byteLength = (data.length / 4) * 3 - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
  if (byteLength > IMAGE_LIMITS.maxBytes) return fail("image_too_large");

  let bytes;
  try {
    bytes = decodeBase64(data);
  } catch {
    return fail("invalid_image");
  }
  if (!bytes.length) return fail("invalid_image");

  const mimeType = sniffImageType(bytes);
  if (!mimeType || !IMAGE_LIMITS.mimeTypes.includes(mimeType)) return fail("unsupported_image_type");
  const dims = imageDimensions(bytes, mimeType);
  if (!dims) return fail("invalid_image");
  const { width, height } = dims;
  if (width > IMAGE_LIMITS.maxSide || height > IMAGE_LIMITS.maxSide || width * height > IMAGE_LIMITS.maxPixels) {
    return fail("image_dimensions_too_large");
  }
  return { ok: true, image: { data, mimeType, bytes, width, height, byteLength: bytes.length } };
}

export function toDataUri({ data, mimeType }) {
  return `data:${mimeType};base64,${data}`;
}

const POPCOUNT = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

// Differing bits between two equal-length hex strings (dHashes), or null.
export function hammingHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || a.length !== b.length) return null;
  if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return null;
  let bits = 0;
  for (let i = 0; i < a.length; i += 1) bits += POPCOUNT[parseInt(a[i], 16) ^ parseInt(b[i], 16)];
  return bits;
}

// The normalised preview beside the original upload, always under the project folder.
export function thumbnailPath({ projectId, kbId, sourceId }) {
  return `${projectId}/${kbId}/${sourceId}/.thumb.jpg`;
}
