// STUB (wave 1, task C replaces): image input validation — spec §5.1.
export const IMAGE_LIMITS = { maxBytes: 4 * 1024 * 1024, maxSide: 2048, maxPixels: 4_200_000, mimeTypes: ["image/jpeg", "image/png", "image/webp"], clientMaxSide: 1280 };
export const NEAR_DUPLICATE_BITS = 6;
export function sniffImageType() {
  return null;
}
export function imageDimensions() {
  return null;
}
export function parseImageInput() {
  return { ok: false, code: "invalid_image", message: "Image input isn't available yet." };
}
export function toDataUri({ data, mimeType }) {
  return `data:${mimeType};base64,${data}`;
}
export function hammingHex() {
  return null;
}
export function thumbnailPath({ projectId, kbId, sourceId }) {
  return `${projectId}/${kbId}/${sourceId}/.thumb.jpg`;
}
