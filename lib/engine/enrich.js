// Contextual chunk enrichment (spec §6.5): one call per chunk on the project's processing model,
// asking for a short context that situates the chunk in its document. The document part of the
// prompt is identical across a document's chunks (and marked for prompt caching on Anthropic),
// so providers with prefix caching only pay for it once per window.
// Shared server runtime: relative imports only; the caller passes the service-role `admin`.
// Never throws for model problems — they come back as warnings and the job carries on.
import { generateText } from "ai";
import { getProcessingModel } from "./llm.js";
import { mapLlmError } from "../grey/llm_errors.js";

export const MAX_DOCUMENT_CHARS = 100_000; // ~25K tokens of document per call
const MAX_CONTEXT_TOKENS = 160;
const CONCURRENCY = 4;
const CALL_TIMEOUT_MS = 60_000;

const SYSTEM =
  "You write short retrieval context for document chunks. Reply with one or two sentences that situate the chunk within the document (what it is about and where it sits). Reply with the context only.";

const warning = (code, message) => ({ stage: "chunk", code, message });

// The slice of the document shown with a chunk. Short documents are sent whole; long ones in
// fixed, half-overlapping windows so neighbouring chunks share an identical (cacheable) prefix.
export function documentWindow(documentText, chunkText, maxChars = MAX_DOCUMENT_CHARS) {
  const doc = String(documentText || "");
  if (doc.length <= maxChars) return doc;
  const needle = String(chunkText || "").trim().slice(0, 200);
  const at = Math.max(0, needle ? doc.indexOf(needle) : 0);
  const step = Math.floor(maxChars / 2);
  const start = Math.min(Math.max(0, Math.floor(at / step) * step - Math.floor(step / 2)), doc.length - maxChars);
  return doc.slice(start, start + maxChars);
}

export function buildContextMessages({ title, window, chunk }) {
  return [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `<document${title ? ` title="${String(title).replace(/"/g, "'")}"` : ""}>\n${window}\n</document>`,
          providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
        },
        {
          type: "text",
          text: `Here is the chunk to situate within the document:\n<chunk>\n${chunk}\n</chunk>\nGive a short, succinct context to situate this chunk within the overall document for the purposes of improving search retrieval of the chunk. Answer only with the succinct context and nothing else.`,
        },
      ],
    },
  ];
}

function usageTokens(usage) {
  if (!usage) return 0;
  const total = Number(usage.totalTokens);
  if (Number.isFinite(total) && total > 0) return total;
  return (Number(usage.inputTokens) || 0) + (Number(usage.outputTokens) || 0);
}

/**
 * @param {object} args
 * @param {object} args.admin           service-role Supabase client (schema grey)
 * @param {string} args.projectId
 * @param {string} args.documentText    the whole document as Markdown/plain text
 * @param {string} [args.title]
 * @param {Array<{ ordinal: number, content: string }>} args.chunks
 * @param {AbortSignal} [args.signal]
 * @returns {Promise<{ contexts: Map<number, string> | null, tokens: number, model: string | null, warnings: Array }>}
 *   contexts is null when enrichment was skipped altogether.
 */
export async function enrichChunks({
  admin,
  projectId,
  documentText,
  title = null,
  chunks,
  signal,
  concurrency = CONCURRENCY,
  resolveModel = getProcessingModel,
  generate = generateText,
}) {
  const warnings = [];
  let resolved;
  try {
    resolved = await resolveModel({ admin, projectId });
  } catch (err) {
    warnings.push(warning("enrichment_unavailable", `Contextual enrichment skipped: ${err?.message || "the processing model can't be used."}`));
    return { contexts: null, tokens: 0, model: null, warnings };
  }
  if (!resolved?.model) {
    warnings.push(warning("enrichment_unavailable", "Contextual enrichment skipped: set a processing model in Settings → General."));
    return { contexts: null, tokens: 0, model: null, warnings };
  }

  const contexts = new Map();
  const list = (chunks || []).filter((c) => String(c?.content || "").trim());
  let tokens = 0;
  let failed = 0;
  let firstError = null;
  let fatal = null;
  let next = 0;

  const lane = async () => {
    while (!fatal && !signal?.aborted && next < list.length) {
      const chunk = list[next++];
      try {
        const result = await generate({
          model: resolved.model,
          system: SYSTEM,
          messages: buildContextMessages({ title, window: documentWindow(documentText, chunk.content), chunk: chunk.content }),
          maxOutputTokens: MAX_CONTEXT_TOKENS,
          maxRetries: 2,
          abortSignal: signal,
          timeout: CALL_TIMEOUT_MS,
        });
        tokens += usageTokens(result?.usage);
        const text = String(result?.text || "").replace(/\s+/g, " ").trim();
        if (text) contexts.set(chunk.ordinal, text);
      } catch (err) {
        if (signal?.aborted) return;
        failed += 1;
        const mapped = mapLlmError(err);
        firstError ??= mapped.message;
        // A rejected key or unknown model fails every call the same way: stop early.
        if (mapped.code === "provider_auth" || mapped.code === "model_not_found") fatal = mapped.message;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, list.length)) }, lane));

  if (fatal) {
    warnings.push(warning("enrichment_failed", `Contextual enrichment stopped: ${fatal}`));
  } else if (failed) {
    warnings.push(warning("enrichment_partial", `${failed} of ${list.length} chunks were indexed without context: ${firstError}`));
  }
  return { contexts, tokens, model: resolved.modelId || null, warnings };
}
