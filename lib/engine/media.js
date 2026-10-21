// Signed URLs for media stored in grey-sources (spec §5.5): source files and image thumbnails.
// Shared server runtime (Next routes + worker): the caller passes the service-role `admin` client
// and has already authorised `projectId`. The service role could sign any object, so only paths
// inside the project's own folder are ever signed.

const BUCKET = "grey-sources";
const DEFAULT_SECONDS = 60 * 60;

// Objects live at <project_id>/<kb_id>/<source_id>/<file>. Rejects anything outside the project
// folder and any "." / ".." segment.
export function inProjectFolder(path, projectId) {
  return typeof path === "string" && typeof projectId === "string" && Boolean(projectId)
    && path.startsWith(`${projectId}/`) && !/(^|\/)\.\.?(\/|$)/.test(path);
}

/**
 * Signs many storage paths in one request. Paths outside `${projectId}/` are skipped, duplicates
 * are signed once, and a path the bucket can't sign (e.g. a missing object) is left out. Never
 * throws: a failure is logged and whatever was signed is returned.
 *
 * @returns {Promise<Map<string, string>>} path -> signed URL
 */
export async function signStoragePaths({ admin, projectId, paths, seconds = DEFAULT_SECONDS } = {}) {
  const signed = new Map();
  const wanted = [...new Set((Array.isArray(paths) ? paths : []).filter((p) => inProjectFolder(p, projectId)))];
  if (!wanted.length || !admin) return signed;
  const expiresIn = Math.max(1, Math.round(Number(seconds) || DEFAULT_SECONDS));
  try {
    const { data, error } = await admin.storage.from(BUCKET).createSignedUrls(wanted, expiresIn);
    if (error) throw error;
    const allowed = new Set(wanted);
    (data || []).forEach((item, index) => {
      const path = item?.path ?? wanted[index];
      const url = item?.signedUrl;
      if (!item?.error && url && allowed.has(path)) signed.set(path, url);
    });
  } catch (error) {
    console.error("[engine.media.sign]", error?.message || error);
  }
  return signed;
}

// items: [{ image: { thumbPath } | null, … }] -> the same items with `thumbnailUrl` (null when the
// item has no thumbnail or it couldn't be signed). One signing request for the whole list.
export async function withThumbnails({ admin, projectId, items, seconds } = {}) {
  const list = Array.isArray(items) ? items : [];
  const urls = await signStoragePaths({
    admin,
    projectId,
    paths: list.map((item) => item?.image?.thumbPath),
    seconds,
  });
  return list.map((item) => ({ ...item, thumbnailUrl: urls.get(item?.image?.thumbPath) ?? null }));
}
