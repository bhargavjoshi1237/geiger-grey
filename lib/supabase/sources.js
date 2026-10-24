// Data access for grey.sources — ingestable files/links and their labels, plus private storage upload and signed download URLs.
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
  "labels",
  "metadata",
];

const repo = makeRepo({ table: TABLE, columns });

export const listSources = (projectId, filters = {}) => repo.list(projectId, filters);
export const getSource = (id) => repo.get(id);
export const createSource = (projectId, input) => repo.create(projectId, input);
export const updateSource = (id, patch) => repo.update(id, patch);
export const deleteSource = (id) => repo.remove(id);

// Human-applied labels that classify tools vote with. Same rule as the DB check
// (grey.labels_valid): at most 50, each 1–60 characters after trimming.
export const SOURCE_LABEL_LIMITS = { max: 50, chars: 60 };

// Trimmed, de-duplicated case-insensitively (first spelling wins), empty and over-long entries
// dropped, capped at 50.
export function normalizeSourceLabels(labels) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(labels) ? labels : []) {
    const label = typeof raw === "string" ? raw.trim() : "";
    if (!label || label.length > SOURCE_LABEL_LIMITS.chars || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    out.push(label);
    if (out.length >= SOURCE_LABEL_LIMITS.max) break;
  }
  return out;
}

// -> the updated source, or null on failure.
export const updateSourceLabels = (id, labels) => repo.update(id, { labels: normalizeSourceLabels(labels) });

// Normalizes an arbitrary filename into a safe storage object name: basename only (no path segments),
// characters outside [A-Za-z0-9._-] become "_", repeated "_" collapse to one, leading dots are stripped
// (no hidden files), and the result is capped at 120 chars while keeping the extension. "file" if nothing
// usable survives.
export function safeStorageName(name) {
  const base = String(name || "").split(/[/\\]+/).pop() || "";
  const cleaned = base
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^\.+/, "");
  if (!cleaned) return "file";
  if (cleaned.length <= 120) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  const ext = dot > 0 ? cleaned.slice(dot) : "";
  const stem = dot > 0 ? cleaned.slice(0, dot) : cleaned;
  return `${stem.slice(0, Math.max(1, 120 - ext.length))}${ext}`;
}

// Uploads a source's file to private storage; returns the stored path (never a URL).
// supabase-js's upload() has no progress events, so onProgress is best effort only.
export async function uploadSourceFile({ projectId, kbId, sourceId, file, onProgress } = {}) {
  if (!isSupabaseConfigured() || !projectId || !kbId || !sourceId || !file) return null;
  try {
    onProgress?.(0);
    const safeName = safeStorageName(file.name);
    const path = `${projectId}/${kbId}/${sourceId}/${safeName}`;
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
