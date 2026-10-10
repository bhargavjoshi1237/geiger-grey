// Data access for grey.sources — ingestable files/links, plus private storage upload and signed download URLs.
import { createClient } from "./client";
import { isSupabaseConfigured } from "./config";
import { makeRepo } from "./repository";

const TABLE = "sources";
const BUCKET = "grey-sources";

const columns = [
  "kbId",
  "name",
  "kind",
  "origin",
  "originRef",
  "mime",
  "bytes",
  "pageCount",
  "durationMs",
  "storagePath",
  "contentHash",
  "status",
  "chunkCount",
  "tokenCount",
  "ownerId",
  "reviewDueAt",
  "verifiedAt",
  "metadata",
];

const repo = makeRepo({ table: TABLE, columns });

export const listSources = (projectId, filters = {}) => repo.list(projectId, filters);
export const getSource = (id) => repo.get(id);
export const createSource = (projectId, input) => repo.create(projectId, input);
export const updateSource = (id, patch) => repo.update(id, patch);
export const deleteSource = (id) => repo.remove(id);

// Uploads a source's file to private storage; returns the stored path (never a URL).
// supabase-js's upload() has no progress events, so onProgress is best effort only.
export async function uploadSourceFile({ projectId, kbId, sourceId, file, onProgress } = {}) {
  if (!isSupabaseConfigured() || !projectId || !kbId || !sourceId || !file) return null;
  try {
    onProgress?.(0);
    const path = `${projectId}/${kbId}/${sourceId}/${file.name}`;
    const { error } = await createClient()
      .storage.from(BUCKET)
      .upload(path, file, { upsert: true, contentType: file.type || undefined });
    if (error) throw error;
    onProgress?.(100);
    return path;
  } catch (error) {
    console.error("[sources.uploadSourceFile]", error);
    return null;
  }
}

// 60s signed URL for downloading a private source file.
export async function getSourceDownloadUrl(storagePath) {
  if (!isSupabaseConfigured() || !storagePath) return null;
  try {
    const { data, error } = await createClient().storage.from(BUCKET).createSignedUrl(storagePath, 60);
    if (error) throw error;
    return data?.signedUrl || null;
  } catch (error) {
    console.error("[sources.getSourceDownloadUrl]", error);
    return null;
  }
}
