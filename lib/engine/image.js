// Image normalisation (spec §5.2) for ingestion and image queries: one canonical JPEG that is
// embedded/captioned, a small preview, and a 64-bit difference hash for near-duplicate checks.
// Shared server runtime (Next routes + worker). sharp is a native module, so it is loaded lazily
// on first use instead of whenever this file is imported.
import { EngineError } from "./errors.js";

const THUMB_QUALITY = 80;
const WHITE = "#ffffff";

let sharpPromise = null;
function loadSharp() {
  sharpPromise ??= import("sharp").then((m) => m.default ?? m);
  return sharpPromise;
}

const invalidImage = () => new EngineError("invalid_image", "This image couldn't be read.", { status: 422 });

const toBuffer = (bytes) => (Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));

// 9×8 grayscale; each bit says whether a pixel is brighter than its right-hand neighbour.
async function hashPixels(sharp, input) {
  const pixels = await sharp(input)
    .rotate()
    .flatten({ background: WHITE })
    .grayscale()
    .resize({ width: 9, height: 8, fit: "fill" })
    .raw()
    .toBuffer();
  let hex = "";
  for (let y = 0; y < 8; y += 1) {
    let byte = 0;
    for (let x = 0; x < 8; x += 1) byte = (byte << 1) | (pixels[y * 9 + x] > pixels[y * 9 + x + 1] ? 1 : 0);
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Auto-orients (EXIF), strips metadata, fits inside `maxSide` (never enlarging), flattens alpha
 * onto white and re-encodes as JPEG; also makes a `thumbSide` preview and the dHash.
 * @param {Buffer|Uint8Array} bytes
 * @returns {Promise<{ image: { bytes: Buffer, data: string, mimeType: "image/jpeg", width, height },
 *   thumbnail: { bytes: Buffer, mimeType: "image/jpeg", width, height }, dhash: string,
 *   source: { width, height, format } }>}
 * @throws EngineError invalid_image (422) when the bytes can't be decoded.
 */
export async function normalizeImage(bytes, { maxSide = 1280, thumbSide = 384, quality = 85 } = {}) {
  if (!bytes?.length) throw invalidImage();
  const sharp = await loadSharp();
  const input = toBuffer(bytes);
  try {
    const meta = await sharp(input).metadata();
    const image = await sharp(input)
      .rotate()
      .flatten({ background: WHITE })
      .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality })
      .toBuffer({ resolveWithObject: true });
    const thumbnail = await sharp(image.data)
      .resize({ width: thumbSide, height: thumbSide, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: THUMB_QUALITY })
      .toBuffer({ resolveWithObject: true });
    return {
      image: { bytes: image.data, data: image.data.toString("base64"), mimeType: "image/jpeg", width: image.info.width, height: image.info.height },
      thumbnail: { bytes: thumbnail.data, mimeType: "image/jpeg", width: thumbnail.info.width, height: thumbnail.info.height },
      dhash: await hashPixels(sharp, input),
      source: {
        width: meta.autoOrient?.width ?? meta.width ?? null,
        height: meta.autoOrient?.height ?? meta.height ?? null,
        format: meta.format || null,
      },
    };
  } catch {
    throw invalidImage();
  }
}

// -> 16 hex chars (64-bit difference hash of the auto-oriented image)
export async function dhash(bytes) {
  if (!bytes?.length) throw invalidImage();
  const sharp = await loadSharp();
  try {
    return await hashPixels(sharp, toBuffer(bytes));
  } catch {
    throw invalidImage();
  }
}
