// STUB (wave 1, task D replaces): signed URLs for stored media — spec §5.5.
export async function signStoragePaths() {
  return new Map();
}
export async function withThumbnails({ items }) {
  return (items || []).map((item) => ({ ...item, thumbnailUrl: null }));
}
