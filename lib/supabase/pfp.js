import { createClient } from "./client";
import { getUserCached } from "./user";

export function buildPfpUrl(userId, opts = {}) {
  if (!userId) return null;
  const supabase = createClient();
  const url = supabase.storage.from("pfp").getPublicUrl(`${userId}/`);
  const base = url.data?.publicUrl ?? url.data?.url ?? null;
  if (!base) return null;
  const SEP = base.endsWith("/") ? "" : "/";
  const transform = [];
  if (opts.width) transform.push(`width=${opts.width}`);
  if (opts.height) transform.push(`height=${opts.height}`);
  const qs = transform.length ? `?${transform.join("&")}` : "";
  return `${base}${qs}`;
}

export async function getPfp(options = {}) {
  const supabase = createClient();

  let userId = options.userId;
  if (!userId) {
    const cached = getUserCached();
    if (!cached) return null;
    userId = cached.id;
  }

  const folder = `${userId}/`;
  const bucketId = "pfp";

  const { data, error } = await supabase.storage
    .from(bucketId)
    .list(userId, {
      sortBy: { column: "name", order: "desc" },
      limit: 1,
    });

  if (error || !data || data.length === 0) return null;

  const latestFile = data[0];
  const filePath = `${folder}${latestFile.name}`;

  const transform = {};
  if (options.width) transform.width = options.width;
  if (options.height) transform.height = options.height;

  const { data: urlData } = supabase.storage
    .from(bucketId)
    .getPublicUrl(filePath, options.width ? { transform } : undefined);

  return urlData?.publicUrl ?? urlData?.url ?? null;
}

export async function uploadPfp(file, options = {}) {
  const supabase = createClient();

  let userId = options.userId;
  if (!userId) {
    const cached = getUserCached();
    if (!cached) return null;
    userId = cached.id;
  }

  const ext = options.contentType?.split("/")[1] || "png";
  const timestamp = new Date().toISOString().replace(/[.:]/g, "-");
  const fileName = `${timestamp}.${ext}`;
  const filePath = `${userId}/${fileName}`;

  const { data, error } = await supabase.storage
    .from("pfp")
    .upload(filePath, file, {
      cacheControl: "0",
      upsert: false,
      contentType: options.contentType,
    });

  if (error) return null;
  return data;
}

export async function deletePfps(paths) {
  const supabase = createClient();
  const { error } = await supabase.storage.from("pfp").remove(paths);
  return !error;
}
