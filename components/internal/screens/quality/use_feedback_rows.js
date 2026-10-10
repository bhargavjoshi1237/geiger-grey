"use client";

import { useEffect, useRef, useState } from "react";

import { listFeedbackMessages, listMessages } from "@/lib/supabase/conversations";
import { listPipelines } from "@/lib/supabase/pipelines";

import { findPreviousUserMessage } from "./constants";

// Loads feedback (assistant messages with feedback or marked unanswered) and
// enriches each with `question` — the prior user turn in its conversation —
// plus the project's pipelines, for name lookups. Shared by feedback.jsx and
// eval_set_sheet.jsx's "Add from feedback" picker.
export function useFeedbackRows(projectId) {
  const [rows, setRows] = useState([]);
  const [pipelines, setPipelines] = useState([]);
  const [loading, setLoading] = useState(true);
  const aliveRef = useRef(true);

  const load = () => {
    if (!projectId) return;
    setLoading(true);
    Promise.all([listFeedbackMessages(projectId), listPipelines(projectId)]).then(
      async ([messages, pipelineRows]) => {
        const base = messages ?? [];
        const conversationIds = [
          ...new Set(base.map((m) => m.conversationId).filter(Boolean)),
        ];
        const threads = await Promise.all(
          conversationIds.map((id) => listMessages(id).then((list) => [id, list ?? []])),
        );
        if (!aliveRef.current) return;
        const threadMap = new Map(threads);
        const enriched = base.map((m) => {
          const thread = threadMap.get(m.conversationId) || [];
          const prevUser = findPreviousUserMessage(thread, m.id);
          return { ...m, question: prevUser?.content || "" };
        });
        setRows(enriched);
        setPipelines(pipelineRows ?? []);
        setLoading(false);
      },
    );
  };

  useEffect(() => {
    aliveRef.current = true;
    // Deferred so the initial fetch kicks off from a microtask, not
    // synchronously inside the effect body (which `load` would otherwise do
    // via its own `setLoading(true)`).
    Promise.resolve().then(() => {
      if (aliveRef.current) load();
    });
    return () => {
      aliveRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  return { rows, setRows, pipelines, loading, reload: load };
}

export function pipelineName(pipelines, pipelineId) {
  return pipelines?.find((p) => p.id === pipelineId)?.name || "—";
}
