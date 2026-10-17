// Data access for grey.conversations and grey.messages — playground/widget/api chat threads.
import { createClient } from "./client";
import { isSupabaseConfigured } from "./config";
import { apiFetch, apiStream } from "@/lib/api";
import { toCamel, toSnakeRow, makeRepo } from "./repository";

const CONVERSATIONS = "conversations";
const MESSAGES = "messages";
const conversationColumns = ["pipelineId", "userId", "title", "channel", "metadata"];
const messageColumns = [
  "conversationId",
  "role",
  "content",
  "citations",
  "feedback",
  "feedbackNote",
  "unanswered",
  "latencyMs",
  "tokensIn",
  "tokensOut",
  "metadata",
];

const repo = makeRepo({ table: CONVERSATIONS, columns: conversationColumns });

export const listConversations = (projectId, filters = {}) => repo.list(projectId, filters);
export const getConversation = (id) => repo.get(id);
export const createConversation = (projectId, input) => repo.create(projectId, input);
export const updateConversation = (id, patch) => repo.update(id, patch);
export const deleteConversation = (id) => repo.remove(id);

// A conversation's full transcript, oldest first. No projectId param on this exact signature
// (brief-mandated); conversationId already pins one conversation, and RLS is the project boundary.
export async function listMessages(conversationId) {
  if (!isSupabaseConfigured() || !conversationId) return [];
  try {
    const { data, error } = await createClient()
      .from(MESSAGES)
      .select("*")
      .eq("conversation_id", conversationId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data || []).map(toCamel);
  } catch (error) {
    console.error("[conversations.listMessages]", error);
    return [];
  }
}

// Assistant messages needing attention (rated or unanswered), with the parent conversation's title/pipeline.
export async function listFeedbackMessages(projectId) {
  if (!isSupabaseConfigured() || !projectId) return [];
  try {
    const { data, error } = await createClient()
      .from(MESSAGES)
      .select("*, conversation:conversations!inner(id, title, pipeline_id, project_id)")
      .eq("role", "assistant")
      .eq("conversation.project_id", projectId)
      .is("deleted_at", null)
      .or("feedback.not.is.null,unanswered.eq.true")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map((row) => {
      const { conversation, ...rest } = row;
      return {
        ...toCamel(rest),
        conversationTitle: conversation?.title ?? null,
        pipelineId: conversation?.pipeline_id ?? null,
      };
    });
  } catch (error) {
    console.error("[conversations.listFeedbackMessages]", error);
    return [];
  }
}

// No projectId param on this exact signature (brief-mandated); the id already pins one message, and
// RLS (grey.can_access_project on the parent conversation) is the project boundary here.
export async function setMessageFeedback(id, patch = {}) {
  if (!isSupabaseConfigured() || !id) return null;
  try {
    const { data, error } = await createClient()
      .from(MESSAGES)
      .update(toSnakeRow(patch, messageColumns))
      .eq("id", id)
      .is("deleted_at", null)
      .select("*")
      .single();
    if (error) throw error;
    return toCamel(data);
  } catch (error) {
    console.error("[conversations.setMessageFeedback]", error);
    return null;
  }
}

// Sends a chat turn through the server route (handles retrieval + the assistant reply).
export const sendChat = ({ projectId, conversationId, pipelineId, content, overrides } = {}) =>
  apiFetch("/chat", { method: "POST", body: { projectId, conversationId, pipelineId, content, overrides } });

// Streams a chat turn: onEvent receives { type: "start", conversationId, userMessage },
// { type: "delta", text }…, then { type: "done", assistantMessage } or { type: "error", code, message }.
export const streamChat = ({ projectId, conversationId, pipelineId, content, overrides, onEvent, signal } = {}) =>
  apiStream("/chat", {
    body: { projectId, conversationId, pipelineId, content, overrides, stream: true },
    onEvent,
    signal,
  });
