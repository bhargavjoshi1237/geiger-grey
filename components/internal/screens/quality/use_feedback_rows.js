"use client";

import { useEffect, useState } from "react";

import { listFeedbackMessages, listMessages } from "@/lib/supabase/conversations";
import { listPipelines } from "@/lib/supabase/pipelines";

import { findPreviousUserMessage } from "./constants";

// Pure fetch + enrichment, no state. Shared by the effect (cancellable) and
// `reload` (fire-and-forget) below.
async function fetchFeedbackRows(projectId) {
  if (!projectId) return { rows: [], pipelines: [] };
  const [messages, pipelineRows] = await Promise.all([
    listFeedbackMessages(projectId),
    listPipelines(projectId),
  ]);
  const base = messages ?? [];
  const conversationIds = [...new Set(base.map((m) => m.conversationId).filter(Boolean))];
  // N+1: one listMessages call per distinct conversation with feedback, to recover the prior
  // user turn (the "question") — listFeedbackMessages only joins the conversation's
  // title/pipeline, not the question text. Acceptable at this phase's data volumes.
  const threads = await Promise.all(
    conversationIds.map((id) => listMessages(id).then((list) => [id, list ?? []])),
  );
  const threadMap = new Map(threads);
  const rows = base.map((m) => {
    const thread = threadMap.get(m.conversationId) || [];
    const prevUser = findPreviousUserMessage(thread, m.id);
    return { ...m, question: prevUser?.content || "" };
  });
  return { rows, pipelines: pipelineRows ?? [] };
}

// Loads feedback (assistant messages with feedback or marked unanswered) and
// enriches each with `question` — the prior user turn in its conversation —
// plus the project's pipelines, for name lookups. Shared by feedback.jsx and
// eval_set_sheet.jsx's "Add from feedback" picker.
export function useFeedbackRows(projectId) {
  const [rows, setRows] = useState([]);
  const [pipelines, setPipelines] = useState([]);
  const [loadedKey, setLoadedKey] = useState(null);
  const loading = loadedKey !== projectId;

  useEffect(() => {
    let alive = true;
    fetchFeedbackRows(projectId).then((result) => {
      if (!alive) return;
      setRows(result.rows);
      setPipelines(result.pipelines);
      setLoadedKey(projectId);
    });
    return () => {
      alive = false;
    };
  }, [projectId]);

  const reload = () => {
    fetchFeedbackRows(projectId).then((result) => {
      setRows(result.rows);
      setPipelines(result.pipelines);
      setLoadedKey(projectId);
    });
  };

  return { rows, setRows, pipelines, loading, reload };
}

export function pipelineName(pipelines, pipelineId) {
  return pipelines?.find((p) => p.id === pipelineId)?.name || "—";
}
