import { handle, json, ApiError } from "@/lib/server/errors";
import { authenticate, authorize, isUuid } from "@/lib/server/auth";
import { adminClient } from "@/lib/supabase/admin";
import { inProjectFolder, signStoragePaths } from "@/lib/engine/media";
import { thumbnailPath } from "@/lib/grey/image_input";

export const runtime = "nodejs";

const BUCKET = "grey-sources";
const SIGNED_URL_SECONDS = 60 * 60;
const ASSETS_TIMEOUT_MS = 10_000;
const MEDIA_KINDS = new Set(["audio", "video"]);
const NOT_FOUND = "Source not found.";
const FILE_MISSING = "This source's media file isn't available.";
const ASSET_MISSING = "This asset's file isn't available in Assets.";

// 1 h signed URL for an uploaded source's file in grey-sources. storage_path is member-writable,
// so a path outside the source's own project folder is never signed (the service role could sign
// any object).
async function uploadMediaUrl(admin, source) {
  if (!source.storage_path) throw new ApiError("not_found", 404, FILE_MISSING);
  if (!inProjectFolder(source.storage_path, source.project_id)) {
    console.error("[api.sources.media-url.scope]", source.id);
    throw new ApiError("not_found", 404, FILE_MISSING);
  }
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(source.storage_path, SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl) {
    console.error("[api.sources.media-url.sign]", error);
    throw new ApiError("not_found", 404, FILE_MISSING);
  }
  return { url: data.signedUrl, mimeType: source.mime || null };
}

// Imported assets are signed by geiger-assets' internal read-url route (suite bearer token).
async function assetMediaUrl(source) {
  const base = process.env.ASSETS_INTERNAL_URL;
  const token = process.env.GEIGER_INTERNAL_TOKEN;
  if (!base || !token) throw new ApiError("service_unavailable", 503, "Assets playback isn't configured.");
  if (!isUuid(source.origin_ref)) throw new ApiError("not_found", 404, ASSET_MISSING);

  const endpoint = `${base.replace(/\/+$/, "")}/api/internal/assets/${source.origin_ref}/read-url`
    + `?projectId=${encodeURIComponent(source.project_id)}`;
  let response;
  try {
    response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(ASSETS_TIMEOUT_MS),
    });
  } catch (error) {
    console.error("[api.sources.media-url.assets]", error?.name || error);
    throw new ApiError("service_unavailable", 503, "Assets is unavailable.");
  }
  if (response.status === 404) throw new ApiError("not_found", 404, ASSET_MISSING);
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.url) {
    console.error("[api.sources.media-url.assets]", response.status);
    throw new ApiError("service_unavailable", 503, "Assets is unavailable.");
  }
  return { url: body.url, mimeType: body.mimeType || source.mime || null };
}

const originalUrl = (admin, source) =>
  source.origin === "assets" ? assetMediaUrl(source) : uploadMediaUrl(admin, source);

// Image sources: the original plus the worker's thumbnail. The thumbnail path is derived from the
// row's own ids (never from member-written fields). Either may be missing (URL-origin images have
// no stored original; a failed upload has no thumbnail) — only both missing is a 404.
async function imageUrls(admin, source) {
  const thumbPath = thumbnailPath({ projectId: source.project_id, kbId: source.kb_id, sourceId: source.id });
  const [original, thumbnails] = await Promise.all([
    originalUrl(admin, source).catch((error) => {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }),
    signStoragePaths({ admin, projectId: source.project_id, paths: [thumbPath], seconds: SIGNED_URL_SECONDS }),
  ]);
  const thumbnailUrl = thumbnails.get(thumbPath) ?? null;
  if (!original && !thumbnailUrl) throw new ApiError("not_found", 404, FILE_MISSING);
  return {
    url: original?.url ?? null,
    thumbnailUrl,
    mimeType: original?.mimeType ?? source.mime ?? null,
    kind: "image",
  };
}

export const GET = handle(async (request, { params }) => {
  const { id } = await params;
  const user = await authenticate(request); // auth before any DB read, to avoid an existence leak

  if (!isUuid(id)) throw new ApiError("not_found", 404, NOT_FOUND);

  const admin = adminClient();
  if (!admin) throw new ApiError("service_unavailable", 503, "The service is unavailable.");

  const { data: source, error } = await admin.from("sources")
    .select("id,project_id,kb_id,kind,origin,origin_ref,mime,storage_path")
    .eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) {
    console.error("[api.sources.media-url.load]", error);
    throw new ApiError("service_unavailable", 503, "The service is unavailable.");
  }
  if (!source) throw new ApiError("not_found", 404, NOT_FOUND);

  // "Not a member" and "no permission" collapse into the same 404 as "no such source".
  await authorize({
    admin, user, projectId: source.project_id, key: "grey.knowledge_bases.view",
    notFoundOnDenied: true, notFoundMessage: NOT_FOUND,
  });

  if (source.kind === "image") return json(await imageUrls(admin, source));
  if (!MEDIA_KINDS.has(source.kind)) {
    throw new ApiError("not_media", 422, "This source has no image, audio or video to show.");
  }

  return json(await originalUrl(admin, source));
});
