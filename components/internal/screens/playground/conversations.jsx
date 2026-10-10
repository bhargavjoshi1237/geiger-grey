"use client";

import React, { useEffect, useMemo, useState } from "react";
import { CircleHelp, MessageCircle, MessagesSquare, ThumbsDown, ThumbsUp } from "lucide-react";

import { MainScreenWrapper } from "@/components/internal/shared/screen_wrappers";
import {
  DataTable,
  EmptyState,
  ScreenHeader,
  SearchInput,
  Toolbar,
} from "@/components/internal/shared/screen_kit";
import { ListPagination, usePagination } from "@/components/internal/shared/pagination";
import { LoadingArea } from "@geiger/ui";
import { Badge } from "@geiger/ui/badge";
import FilterDropdown from "@/components/internal/shared/filter_dropdown";
import { useProject } from "@/context/project-context";
import { useWorkspaceUrl } from "@/lib/hooks/use-workspace-url";
import { getUser } from "@/lib/supabase/user";
import { listConversations, listMessages } from "@/lib/supabase/conversations";
import { listPipelines } from "@/lib/supabase/pipelines";
import { formatRelative } from "@/lib/grey/format";
import { CHANNEL_FILTER_OPTIONS, CHANNEL_MAP, pipelineOptions } from "./constants";
import { TranscriptSheet } from "./transcript_sheet";

function summarizeFeedback(rows) {
  let up = 0;
  let down = 0;
  let unanswered = 0;
  for (const m of rows) {
    if (m.role !== "assistant") continue;
    if (m.feedback === "up") up += 1;
    else if (m.feedback === "down") down += 1;
    if (m.unanswered) unanswered += 1;
  }
  return { up, down, unanswered, count: rows.length };
}

function FeedbackCell({ summary }) {
  if (!summary) return <span className="text-text-tertiary">—</span>;
  if (!summary.up && !summary.down && !summary.unanswered) {
    return <span className="text-text-tertiary">—</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {summary.up ? (
        <Badge variant="success" className="gap-1">
          <ThumbsUp className="h-3 w-3" /> {summary.up}
        </Badge>
      ) : null}
      {summary.down ? (
        <Badge variant="danger" className="gap-1">
          <ThumbsDown className="h-3 w-3" /> {summary.down}
        </Badge>
      ) : null}
      {summary.unanswered ? (
        <Badge variant="warning" className="gap-1">
          <CircleHelp className="h-3 w-3" /> {summary.unanswered}
        </Badge>
      ) : null}
    </div>
  );
}

export function ConversationsScreen() {
  const { projectId } = useProject();
  const url = useWorkspaceUrl();

  const [conversations, setConversations] = useState([]);
  const [pipelines, setPipelines] = useState([]);
  const [messagesByConversation, setMessagesByConversation] = useState({});
  const [userId, setUserId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState("all");
  const [pipelineFilter, setPipelineFilter] = useState("all");

  useEffect(() => {
    getUser().then((u) => setUserId(u?.id || null));
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all([listConversations(projectId), listPipelines(projectId)]).then(
      async ([convs, pls]) => {
        if (!alive) return;
        const rows = convs ?? [];
        setConversations(rows);
        setPipelines(pls ?? []);
        // Per-conversation fan-out: listMessages has no bulk/aggregate variant
        // yet, so message counts and feedback summaries are computed client
        // side. Fine at today's volume — swap for a server aggregate (RPC or
        // view) if this screen's conversation count grows meaningfully.
        const pairs = await Promise.all(
          rows.map(async (c) => [c.id, (await listMessages(c.id)) ?? []]),
        );
        if (!alive) return;
        setMessagesByConversation(Object.fromEntries(pairs));
        setLoading(false);
      },
    );
    return () => {
      alive = false;
    };
  }, [projectId]);

  const pipelineById = useMemo(
    () => Object.fromEntries(pipelines.map((p) => [p.id, p])),
    [pipelines],
  );

  const rows = useMemo(
    () =>
      conversations.map((c) => {
        const msgs = messagesByConversation[c.id] || [];
        return {
          ...c,
          pipelineName: pipelineById[c.pipelineId]?.name || null,
          feedbackSummary: summarizeFeedback(msgs),
          lastActivity: msgs.length ? msgs[msgs.length - 1].createdAt : c.updatedAt || c.createdAt,
          userLabel: c.userId === userId ? "You" : c.userId ? c.userId.slice(0, 8) : "—",
        };
      }),
    [conversations, messagesByConversation, pipelineById, userId],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((c) => {
      if (q && !(c.title || "").toLowerCase().includes(q)) return false;
      if (channelFilter !== "all" && c.channel !== channelFilter) return false;
      if (pipelineFilter !== "all" && c.pipelineId !== pipelineFilter) return false;
      return true;
    });
  }, [rows, search, channelFilter, pipelineFilter]);

  const pager = usePagination(filtered, {
    resetKey: `${search}|${channelFilter}|${pipelineFilter}`,
  });

  const openId = url.params?.conversation || null;
  const openConversation = rows.find((c) => c.id === openId) || null;

  const filtersActive = search || channelFilter !== "all" || pipelineFilter !== "all";

  const columns = [
    {
      key: "title",
      header: "Title",
      render: (c) => (
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4 shrink-0 text-text-tertiary" />
          <span className="truncate font-medium text-foreground">
            {c.title || "Untitled conversation"}
          </span>
        </div>
      ),
    },
    {
      key: "pipeline",
      header: "Pipeline",
      render: (c) => <span className="text-sm text-text-secondary">{c.pipelineName || "—"}</span>,
    },
    {
      key: "channel",
      header: "Channel",
      render: (c) => {
        const ch = CHANNEL_MAP[c.channel] || CHANNEL_MAP.playground;
        return <Badge variant={ch.variant}>{ch.label}</Badge>;
      },
    },
    {
      key: "messages",
      header: "Messages",
      align: "right",
      render: (c) => (
        <span className="tabular-nums text-sm text-text-secondary">
          {c.feedbackSummary.count}
        </span>
      ),
    },
    {
      key: "feedback",
      header: "Feedback",
      render: (c) => <FeedbackCell summary={c.feedbackSummary} />,
    },
    {
      key: "user",
      header: "User",
      render: (c) => <span className="text-sm text-text-secondary">{c.userLabel}</span>,
    },
    {
      key: "lastActivity",
      header: "Last activity",
      render: (c) => (
        <span className="text-sm text-text-secondary">{formatRelative(c.lastActivity)}</span>
      ),
    },
  ];

  return (
    <MainScreenWrapper>
      <ScreenHeader
        title="Conversations"
        description="Every chat across the playground, widget, and API — open one to read the transcript and citations."
      />

      <Toolbar>
        <div className="flex items-center gap-2">
          <FilterDropdown
            value={channelFilter}
            onValueChange={setChannelFilter}
            options={CHANNEL_FILTER_OPTIONS}
            height="h-9"
          />
          <FilterDropdown
            value={pipelineFilter}
            onValueChange={setPipelineFilter}
            options={pipelineOptions(pipelines)}
            height="h-9"
          />
        </div>
        <SearchInput value={search} onChange={setSearch} placeholder="Search conversations…" />
      </Toolbar>

      {loading ? (
        <LoadingArea panel label="Loading conversations" />
      ) : (
        <div className="space-y-5">
          <DataTable
            columns={columns}
            data={pager.pageItems}
            getRowKey={(c) => c.id}
            onRowClick={(c) => url.openRecord("conversation", c.id)}
            empty={
              <div className="rounded-xl border border-border bg-surface-subtle">
                <EmptyState
                  icon={MessagesSquare}
                  title={filtersActive ? "No matches" : "No conversations yet"}
                  description={
                    filtersActive
                      ? "Try a different search or filter."
                      : "Conversations show up here once someone chats in the Playground, a widget, or the API."
                  }
                />
              </div>
            }
          />
          <ListPagination {...pager} itemLabel="conversations" />
        </div>
      )}

      <TranscriptSheet
        conversation={openConversation}
        pipelineName={openConversation?.pipelineName}
        userLabel={openConversation?.userLabel}
        onClose={() => url.closeRecord("conversation")}
      />
    </MainScreenWrapper>
  );
}

export default ConversationsScreen;
