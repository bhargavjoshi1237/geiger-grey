"use client";

import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CircleHelp,
  History,
  MessageCircle,
  Plus,
  SlidersHorizontal,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";

import { MainScreenWrapper } from "@/components/internal/shared/screen_wrappers";
import { ScreenHeader } from "@/components/internal/shared/screen_kit";
import { LoadingArea, LogoLoading } from "@geiger/ui";
import { Button } from "@geiger/ui/button";
import { Textarea } from "@geiger/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@geiger/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@geiger/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@geiger/ui/sheet";
import { cn } from "@/lib/utils";
import { useProject } from "@/context/project-context";
import { useWorkspaceUrl } from "@/lib/hooks/use-workspace-url";
import { getUser } from "@/lib/supabase/user";
import {
  getConversation,
  listConversations,
  listMessages,
  sendChat,
  setMessageFeedback,
} from "@/lib/supabase/conversations";
import { listPipelines } from "@/lib/supabase/pipelines";
import { listKnowledgeBases } from "@/lib/supabase/knowledge_bases";
import { formatRelative } from "@/lib/grey/format";
import { Composer, MessageList } from "./chat_kit";
import { RunSettingsPanel } from "./run_settings";
import { EXAMPLE_QUESTIONS } from "./constants";

// Per-message feedback row shown under assistant replies in the live thread:
// thumbs up/down (down opens a small note capture) and "mark unanswered".
function MessageFeedback({ message, onFeedback, onUnanswered }) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const feedback = message.feedback;

  return (
    <div className="flex items-center gap-0.5">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Good answer"
        onClick={() => onFeedback(message, { feedback: feedback === "up" ? null : "up" })}
        className={cn(
          "h-6 w-6",
          feedback === "up"
            ? "text-emerald-400"
            : "text-text-tertiary hover:bg-surface-hover hover:text-foreground",
        )}
      >
        <ThumbsUp className="h-3.5 w-3.5" />
      </Button>

      <Popover open={noteOpen} onOpenChange={setNoteOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Poor answer"
            onClick={() => {
              if (feedback === "down") {
                onFeedback(message, { feedback: null, feedbackNote: null });
                return;
              }
              setNoteOpen(true);
            }}
            className={cn(
              "h-6 w-6",
              feedback === "down"
                ? "text-red-400"
                : "text-text-tertiary hover:bg-surface-hover hover:text-foreground",
            )}
          >
            <ThumbsDown className="h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 space-y-2">
          <p className="text-xs text-text-secondary">What went wrong? (optional)</p>
          <Textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a note…"
          />
          <Button
            size="sm"
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={() => {
              onFeedback(message, { feedback: "down", feedbackNote: note.trim() || null });
              setNoteOpen(false);
              setNote("");
            }}
          >
            Submit feedback
          </Button>
        </PopoverContent>
      </Popover>

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={message.unanswered ? "Marked as unanswered" : "Mark unanswered"}
        onClick={() => onUnanswered(message)}
        className={cn(
          "h-6 w-6",
          message.unanswered
            ? "text-amber-400"
            : "text-text-tertiary hover:bg-surface-hover hover:text-foreground",
        )}
      >
        <CircleHelp className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function ConversationRail({ conversations, activeId, onSelect, onNew, loading }) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface-subtle">
      <div className="border-b border-border p-3">
        <Button
          type="button"
          variant="outline"
          onClick={onNew}
          className="w-full justify-start border-border bg-transparent text-muted-foreground hover:bg-surface-active hover:text-foreground"
        >
          <Plus className="h-4 w-4" /> New chat
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <LogoLoading size={32} aria-label="Loading conversations" />
          </div>
        ) : conversations.length ? (
          <div className="space-y-1">
            {conversations.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelect(c)}
                className={cn(
                  "flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition-colors",
                  activeId === c.id ? "bg-surface-active" : "hover:bg-surface-hover",
                )}
              >
                <span className="truncate text-sm font-medium text-foreground">
                  {c.title || "Untitled conversation"}
                </span>
                <span className="truncate text-[11px] text-text-tertiary">
                  {formatRelative(c.updatedAt || c.createdAt)}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="px-3 py-6 text-center text-xs text-text-tertiary">
            No conversations yet — start one below.
          </p>
        )}
      </div>
    </div>
  );
}

function PipelinePicker({ pipelines, value, onChange }) {
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger className="w-full max-w-xs">
        <SelectValue placeholder="Choose a pipeline" />
      </SelectTrigger>
      <SelectContent>
        {pipelines.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ChatEmptyState({ pipelines, pipelineId, onPipelineChange, onPickQuestion }) {
  return (
    <div className="flex max-w-md flex-col items-center gap-4 px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-surface-card text-text-secondary">
        <MessageCircle className="h-6 w-6" />
      </div>
      <div>
        <p className="text-sm font-semibold text-foreground">Ask your knowledge base anything</p>
        <p className="mt-1 text-sm text-text-secondary">
          Pick a pipeline and send your first message to start a conversation.
        </p>
      </div>
      {pipelines.length ? (
        <PipelinePicker pipelines={pipelines} value={pipelineId} onChange={onPipelineChange} />
      ) : (
        <p className="text-xs text-text-tertiary">
          No pipelines yet — create one under Pipelines before chatting.
        </p>
      )}
      {pipelines.length ? (
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          {EXAMPLE_QUESTIONS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => onPickQuestion(q)}
              className="rounded-full border border-border bg-surface-card px-3 py-1 text-xs text-text-secondary transition-colors hover:border-border-strong hover:bg-surface-hover hover:text-foreground"
            >
              {q}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ChatScreen() {
  const { projectId } = useProject();
  const url = useWorkspaceUrl();

  const [userId, setUserId] = useState(null);
  const [pipelines, setPipelines] = useState([]);
  const [knowledgeBases, setKnowledgeBases] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [activeConversation, setActiveConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [selectedPipelineId, setSelectedPipelineId] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [composerValue, setComposerValue] = useState("");
  const [sending, setSending] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [historySheetOpen, setHistorySheetOpen] = useState(false);
  const [settingsSheetOpen, setSettingsSheetOpen] = useState(false);

  const conversationIdParam = url.params?.conversation || null;
  const qParam = url.params?.q || null;

  useEffect(() => {
    getUser().then((u) => setUserId(u?.id || null));
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all([listPipelines(projectId), listKnowledgeBases(projectId)]).then(([p, kb]) => {
      if (!alive) return;
      setPipelines(p ?? []);
      setKnowledgeBases(kb ?? []);
    });
    return () => {
      alive = false;
    };
  }, [projectId]);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    listConversations(projectId, { channel: "playground", userId }).then((rows) => {
      if (!alive) return;
      setConversations((rows ?? []).slice().sort((a, b) => {
        const bt = new Date(b.updatedAt || b.createdAt || 0).getTime();
        const at = new Date(a.updatedAt || a.createdAt || 0).getTime();
        return bt - at;
      }));
      setLoadingConversations(false);
    });
    return () => {
      alive = false;
    };
  }, [projectId, userId]);

  // Default the (unlocked, "new chat") pipeline picker to the first live
  // pipeline — derived during render rather than synced via an effect.
  const defaultPipelineId = useMemo(() => {
    if (!pipelines.length) return null;
    const live = pipelines.find((p) => p.status === "live");
    return (live || pipelines[0]).id;
  }, [pipelines]);
  const effectiveSelectedPipelineId = selectedPipelineId ?? defaultPipelineId;

  // Prefill the composer from a graph "Ask about this" link. Consuming the
  // param is adjusted during render (React's recommended fix for "respond to
  // a changed prop/param"); clearing it from the URL is the actual effect.
  const [consumedQ, setConsumedQ] = useState(null);
  if (qParam && qParam !== consumedQ) {
    setConsumedQ(qParam);
    setComposerValue(qParam);
  }
  useEffect(() => {
    if (qParam) url.setParam("q", null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qParam]);

  // Reset the thread when the ?conversation= param changes — including to
  // null (new chat / direct navigation) — synchronously during render so the
  // fetch effect below never has to call setState outside its .then().
  const [syncedConversationId, setSyncedConversationId] = useState(conversationIdParam);
  if (conversationIdParam !== syncedConversationId) {
    setSyncedConversationId(conversationIdParam);
    setMessages([]);
    setLoadingMessages(Boolean(conversationIdParam));
    setOverrides({});
    if (!conversationIdParam) setActiveConversation(null);
  }

  useEffect(() => {
    if (!conversationIdParam) return;
    let alive = true;
    listMessages(conversationIdParam).then((rows) => {
      if (!alive) return;
      setMessages(rows ?? []);
      setLoadingMessages(false);
    });
    return () => {
      alive = false;
    };
  }, [conversationIdParam]);

  useEffect(() => {
    if (!conversationIdParam || activeConversation?.id === conversationIdParam) return;
    let alive = true;
    getConversation(conversationIdParam).then((conv) => {
      if (alive) setActiveConversation(conv);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationIdParam]);

  const pipeline = useMemo(() => {
    const id = activeConversation ? activeConversation.pipelineId : effectiveSelectedPipelineId;
    return pipelines.find((p) => p.id === id) || null;
  }, [activeConversation, effectiveSelectedPipelineId, pipelines]);

  const knowledgeBaseNames = useMemo(() => {
    const ids = pipeline?.kbIds || [];
    return ids
      .map((id) => knowledgeBases.find((kb) => kb.id === id)?.name)
      .filter(Boolean);
  }, [pipeline, knowledgeBases]);

  const selectConversation = (conv) => {
    setMessages([]);
    setActiveConversation(conv);
    url.openRecord("conversation", conv.id);
    setHistorySheetOpen(false);
  };

  const startNewChat = () => {
    setMessages([]);
    setActiveConversation(null);
    url.closeRecord("conversation");
    setHistorySheetOpen(false);
  };

  const openSource = (citation) => {
    if (!citation?.sourceId) return;
    url.openRecordInTab("Sources", "source", citation.sourceId);
  };

  const handleSend = async () => {
    const content = composerValue.trim();
    if (!content || sending) return;
    const pipelineId = activeConversation ? activeConversation.pipelineId : effectiveSelectedPipelineId;
    if (!pipelineId) {
      toast.error("Choose a pipeline before sending a message.");
      return;
    }

    const tempId = `temp-${crypto.randomUUID()}`;
    const optimisticUser = {
      id: tempId,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
      pending: true,
    };
    setMessages((prev) => [...prev, optimisticUser]);
    setComposerValue("");
    setSending(true);

    const result = await sendChat({
      projectId,
      conversationId: activeConversation?.id,
      pipelineId,
      content,
      overrides,
    });

    setSending(false);

    if (!result) {
      toast.error("Couldn't reach the chat backend. Try again.");
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setComposerValue(content);
      return;
    }

    setMessages((prev) => {
      const next = prev.map((m) => (m.id === tempId ? result.userMessage : m));
      return result.assistantMessage ? [...next, result.assistantMessage] : next;
    });

    if (!activeConversation) {
      const conv = {
        id: result.conversationId,
        projectId,
        pipelineId,
        userId,
        title: content.slice(0, 60),
        channel: "playground",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setActiveConversation(conv);
      setConversations((prev) => [conv, ...prev.filter((c) => c.id !== conv.id)]);
      url.openRecord("conversation", result.conversationId);
    } else {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeConversation.id ? { ...c, updatedAt: new Date().toISOString() } : c,
        ),
      );
    }
  };

  const handleFeedback = async (message, patch) => {
    setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, ...patch } : m)));
    const saved = await setMessageFeedback(message.id, patch);
    if (saved === false) {
      toast.error("Couldn't save feedback.");
      setMessages((prev) =>
        prev.map((m) => (m.id === message.id ? { ...m, feedback: message.feedback } : m)),
      );
    }
  };

  const handleUnanswered = async (message) => {
    const next = !message.unanswered;
    setMessages((prev) =>
      prev.map((m) => (m.id === message.id ? { ...m, unanswered: next } : m)),
    );
    const saved = await setMessageFeedback(message.id, { unanswered: next });
    if (saved === false) {
      toast.error("Couldn't update this message.");
      setMessages((prev) =>
        prev.map((m) => (m.id === message.id ? { ...m, unanswered: !next } : m)),
      );
    } else {
      toast.success(next ? "Marked unanswered." : "Unmarked.");
    }
  };

  const renderActions = (message) => {
    if (message.role !== "assistant" || message.pending) return null;
    return (
      <MessageFeedback
        message={message}
        onFeedback={handleFeedback}
        onUnanswered={handleUnanswered}
      />
    );
  };

  const runSettingsProps = {
    pipelines,
    pipelineId: pipeline?.id || null,
    onPipelineChange: setSelectedPipelineId,
    pipeline,
    knowledgeBaseNames,
    locked: Boolean(activeConversation),
    overrides,
    onOverridesChange: setOverrides,
  };

  return (
    <MainScreenWrapper className="lg:flex lg:h-full lg:flex-col lg:gap-4 lg:space-y-0 lg:overflow-hidden lg:py-0">
      <ScreenHeader
        title="Playground"
        description="Chat against your pipelines and inspect retrieved citations before they ship anywhere else."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setHistorySheetOpen(true)}
              className="border-border bg-transparent text-muted-foreground hover:bg-surface-active hover:text-foreground lg:hidden"
            >
              <History className="h-4 w-4" /> History
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSettingsSheetOpen(true)}
              className="border-border bg-transparent text-muted-foreground hover:bg-surface-active hover:text-foreground lg:hidden"
            >
              <SlidersHorizontal className="h-4 w-4" /> Settings
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSettingsOpen((v) => !v)}
              className="hidden border-border bg-transparent text-muted-foreground hover:bg-surface-active hover:text-foreground lg:inline-flex"
            >
              <SlidersHorizontal className="h-4 w-4" /> {settingsOpen ? "Hide" : "Show"} run settings
            </Button>
          </div>
        }
      />

      <div
        className={cn(
          "grid flex-1 gap-4 lg:min-h-0",
          settingsOpen ? "lg:grid-cols-[240px_1fr_300px]" : "lg:grid-cols-[240px_1fr]",
        )}
      >
        <div className="hidden min-h-0 lg:flex">
          <ConversationRail
            conversations={conversations}
            activeId={activeConversation?.id || null}
            onSelect={selectConversation}
            onNew={startNewChat}
            loading={loadingConversations}
          />
        </div>

        <div className="flex h-[70vh] min-h-[420px] flex-col overflow-hidden rounded-xl border border-border bg-surface-subtle lg:h-auto lg:min-h-0">
          {loadingMessages && !messages.length ? (
            <LoadingArea label="Loading conversation" />
          ) : (
            <MessageList
              messages={messages}
              renderActions={renderActions}
              onOpenSource={openSource}
              emptyState={
                <ChatEmptyState
                  pipelines={pipelines}
                  pipelineId={effectiveSelectedPipelineId}
                  onPipelineChange={setSelectedPipelineId}
                  onPickQuestion={setComposerValue}
                />
              }
            />
          )}
          <Composer
            value={composerValue}
            onChange={setComposerValue}
            onSubmit={handleSend}
            disabled={sending || (!activeConversation && !effectiveSelectedPipelineId)}
            placeholder="Ask a question…"
          />
        </div>

        {settingsOpen ? (
          <div className="hidden min-h-0 lg:flex">
            <RunSettingsPanel {...runSettingsProps} onClose={() => setSettingsOpen(false)} />
          </div>
        ) : null}
      </div>

      <Sheet open={historySheetOpen} onOpenChange={setHistorySheetOpen}>
        <SheetContent side="left" className="w-80 p-3">
          <SheetHeader className="px-1">
            <SheetTitle>Conversations</SheetTitle>
          </SheetHeader>
          <div className="mt-2 h-[calc(100%-3rem)]">
            <ConversationRail
              conversations={conversations}
              activeId={activeConversation?.id || null}
              onSelect={selectConversation}
              onNew={startNewChat}
              loading={loadingConversations}
            />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={settingsSheetOpen} onOpenChange={setSettingsSheetOpen}>
        <SheetContent side="right" className="w-80 p-3">
          <SheetHeader className="px-1">
            <SheetTitle>Run settings</SheetTitle>
          </SheetHeader>
          <div className="mt-2 h-[calc(100%-3rem)]">
            <RunSettingsPanel {...runSettingsProps} onClose={() => setSettingsSheetOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </MainScreenWrapper>
  );
}

export default ChatScreen;
