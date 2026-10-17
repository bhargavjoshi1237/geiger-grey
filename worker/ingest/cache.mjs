// Parse and transcript caches in the grey-sources bucket (spec §5.5, §9.2):
//   {project}/{kb}/{source}/.parsed/{parseKey}.json.gz   parsed pages (existence is the cache check)
//   {project}/{kb}/{source}/transcript.json              raw + normalised transcript
// Cache reads/writes never fail a job: a miss or an error just means "parse again".
import { gunzipSync, gzipSync } from "node:zlib";
import { BUCKET } from "./fetch.mjs";

export async function readCache(admin, objectPath, { gzip = false } = {}) {
  try {
    const { data, error } = await admin.storage.from(BUCKET).download(objectPath);
    if (error || !data) return null;
    const bytes = Buffer.from(await data.arrayBuffer());
    return JSON.parse((gzip ? gunzipSync(bytes) : bytes).toString("utf8"));
  } catch {
    return null;
  }
}

export async function writeCache(admin, objectPath, value, { gzip = false } = {}) {
  try {
    const json = Buffer.from(JSON.stringify(value), "utf8");
    const body = gzip ? gzipSync(json) : json;
    const { error } = await admin.storage
      .from(BUCKET)
      .upload(objectPath, body, { upsert: true, contentType: gzip ? "application/gzip" : "application/json" });
    return !error;
  } catch {
    return false;
  }
}
