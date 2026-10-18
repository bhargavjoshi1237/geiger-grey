"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import {
  ArrowUpRight,
  Check,
  CircleHelp,
  Copy,
  MessagesSquare,
  PanelLeft,
  Pencil,
  RotateCcw,
  SlidersHorizontal,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";

import { MainScreenWrapper } from "@/components/internal/shared/screen_wrappers";
import { ScreenHeader } from "@/components/internal/shared/screen_kit";
import { LoadingArea } from "@geiger/ui";
import { Button } from "@geiger/ui/button";
import { Checkbox } from "@geiger/ui/checkbox";
import { Textarea } from "@geiger/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@geiger/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@geiger/ui/select";
import { Sheet, SheetContent, SheetTitle } from "@geiger/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@geiger/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@geiger/ui/tooltip";
import { cn } from "@/lib/utils";
import { useProject } from "@/context/project-context";
import { useWorkspaceUrl } from "@/lib/hooks/use-workspace-url";
import { useCopy } from "@/lib/hooks/use-copy";
import { getUser } from "@/lib/supabase/user";
import {
  deleteConversation,
  getConversation,
  listConversations,
  listMessages,
  setMessageFeedback,
  streamChat,
  updateConversation,
} from "@/lib/supabase/conversations";
import { listPipelines } from "@/lib/supabase/pipelines";
import { listKnowledgeBases } from "@/lib/supabase/knowledge_bases";
import { Composer, IconAction, MessageList, useOpenSource } from "./chat_kit";
import { ConversationRail } from "./conversation_rail";
import { RunSettingsPanel } from "./run_settings";
import { EXAMPLE_QUESTIONS } from "./constants";

// Per-viewer conveniences, remembered in localStorage when it's available and in memory
// otherwise; the server render always uses the fallback.
const KNOWLEDGE_ONLY_KEY = "grey.playground.knowledgeOnly";
const SETTINGS_OPEN_KEY = "grey.playground.settingsOpen";
const FLAG_EVENT = "grey:playground-flag";
const memoryFlags = new Map();

function readFlag(key, fallback) {
  try {
    const stored = window.localStorage.getItem(key);
    if (stored !== null) return stored === "1";
  } catch {
    // Storage blocked — fall through to the in-memory value.
  }
  return memoryFlags.has(key) ? memoryFlags.get(key) : fallback;
}

function subscribeFlags(notify) {
  window.addEventListener("storage", notify);
  window.addEventListener(FLAG_EVENT, notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener(FLAG_EVENT, notify);
  };
}

function usePersistentFlag(key, fallback) {
  const value = useSyncExternalStore(subscribeFlags, () => readFlag(key, fallback), () => fallback);
  const update = useCallback(
    (next) => {
      memoryFlags.set(key, next);
      try {
        window.localStorage.setItem(key, next ? "1" : "0");
      } catch {
        // Not persisted — the in-memory value still holds for this visit.
      }
      window.dispatchEvent(new Event(FLAG_EVENT));
    },
    [key],
  );
  return [value, update];
}

// The "Knowledge base only" tick in the composer. On (the default): the model may only use the
// retrieved passages. Off: it may add general knowledge, flagged in the answer.
function KnowledgeOnlyToggle({ checked, onChange }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <label
          className={cn(
            "inline-flex h-8 cursor-pointer select-none items-center gap-2 rounded-full border px-3 text-xs font-medium transition-colors",
            checked
              ? "border-border-strong bg-surface-hover text-foreground"
              : "border-border text-text-secondary hover:bg-surface-hover hover:text-foreground",
          )}
        >
          <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} className="size-3.5" />
          Knowledge base only
        </label>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64 text-left">
        {checked
          ? "Answers use only passages from your knowledge bases — never the model's own training data."
          : "The model may add general knowledge where your knowledge bases fall short, and says when it does."}
      </TooltipContent>
    </Tooltip>
  );
}

function CopyAction({ text }) {
  const { copied, copy } = useCopy();
  return (
    <IconAction label={copied ? "Copied" : "Copy"} onClick={() => copy(text)}>
      {copied ? <Check /> : <Copy />}
    </IconAction>
  );
}

// Under an answer: copy, ask again (latest only), rating with an optional note, and mark
// unanswered. Timings live in the reply's header.
function AssistantActions({ message, isLast, busy, onRetry, onFeedback, onUnanswered }) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const saved = !message.local && !String(message.id).startsWith("reply-");

  return (
    <>
      {message.content ? <CopyAction text={message.content} /> : null}
      {isLast && onRetry ? (
        <IconAction label="Ask again" onClick={onRetry} disabled={busy}>
          <RotateCcw />
        </IconAction>
      ) : null}
      {saved ? (
        <>
          <IconAction
            label={message.feedback === "up" ? "Marked helpful" : "Helpful"}
            active={message.feedback === "up"}
            onClick={() => onFeedback(message, { feedback: message.feedback === "up" ? null : "up", feedbackNote: null })}
          >
            <ThumbsUp className={cn(message.feedback === "up" && "fill-current")} />
          </IconAction>
          <Popover open={noteOpen} onOpenChange={setNoteOpen}>
            <PopoverTrigger asChild>
              <IconAction
                label={message.feedback === "down" ? "Marked not helpful" : "Not helpful"}
                active={message.feedback === "down"}
                onClick={(e) => {
                  if (message.feedback !== "down") return;
                  e.preventDefault();
                  onFeedback(message, { feedback: null, feedbackNote: null });
                }}
              >
                <ThumbsDown className={cn(message.feedback === "down" && "fill-current")} />
              </IconAction>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 space-y-2.5">
              <p className="text-sm font-medium text-foreground">What was wrong?</p>
              <Textarea
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional — wrong source, missing detail, made something up…"
                className="resize-none text-sm"
              />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setNoteOpen(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    onFeedback(message, { feedback: "down", feedbackNote: note.trim() || null });
                    setNoteOpen(false);
                    setNote("");
                  }}
                >
                  Send feedback
                </Button>
              </div>
            </PopoverContent>
          </Popover>
          <IconAction
            label={message.unanswered ? "Marked unanswered" : "Mark unanswered"}
            active={message.unanswered}
            className={cn(message.unanswered && "text-amber-400")}
            onClick={() => onUnanswered(message)}
          >
            <CircleHelp />
          </IconAction>
        </>
      ) : null}
    </>
  );
}

function UserActions({ message, onEdit }) {
  return (
    <>
      <CopyAction text={message.content} />
      <IconAction label="Edit in composer" onClick={() => onEdit(message)}>
        <Pencil />
      </IconAction>
    </>
  );
}

function PipelinePicker({ pipelines, value, onChange, locked }) {
  const picker = (
    <Select value={value || undefined} onValueChange={onChange} disabled={locked}>
      <SelectTrigger size="sm" className="h-8 w-auto max-w-[220px] gap-1.5 border-border bg-surface-card text-xs">
        <SelectValue placeholder="Choose a pipeline" />
      </SelectTrigger>
      <SelectContent align="end" className="min-w-[200px]">
        {pipelines.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  if (!locked) return picker;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>{picker}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom">Fixed for this chat — start a new chat to switch</TooltipContent>
    </Tooltip>
  );
}

function ChatEmptyState({ pipeline, pipelinesLoaded, hasPipelines, knowledgeBaseNames, onPick, onOpenPipeline, onCreatePipeline }) {
  if (pipelinesLoaded && !hasPipelines) {
    return (
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-surface-card text-muted-foreground">
          <MessagesSquare className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <p className="text-sm font-medium text-foreground">No pipelines yet</p>
        <p className="text-xs text-text-secondary">
          A pipeline connects a chat model to your knowledge bases. Create one to start asking questions.
        </p>
        <Button size="sm" variant="outline" onClick={onCreatePipeline} className="mt-1 border-border bg-transparent">
          Go to pipelines <ArrowUpRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  const noKnowledge = pipeline && !knowledgeBaseNames.length;
  return (
    <div className="flex w-full max-w-lg flex-col items-center gap-5 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-surface-card text-muted-foreground">
        <MessagesSquare className="h-5 w-5" strokeWidth={1.8} />
      </div>
      <div className="space-y-1.5">
        <p className="text-base font-semibold text-foreground">{pipeline ? `Ask ${pipeline.name}` : "Ask your knowledge base"}</p>
        <p className="text-sm text-text-secondary">
          {noKnowledge ? (
            "This pipeline has no knowledge bases attached, so it has nothing to answer from yet."
          ) : knowledgeBaseNames.length ? (
            <>
              Answers come from <span className="text-foreground">{knowledgeBaseNames.join(", ")}</span>, with every claim linked to
              its source.
            </>
          ) : (
            "Answers come from your knowledge bases, with every claim linked to its source."
          )}
        </p>
      </div>
      {noKnowledge ? (
        <Button size="sm" variant="outline" onClick={() => onOpenPipeline("retrieval")} className="border-border bg-transparent">
          Attach a knowledge base <ArrowUpRight className="h-3.5 w-3.5" />
        </Button>
      ) : pipeline ? (
        <div className="grid w-full gap-2 sm:grid-cols-2">
          {EXAMPLE_QUESTIONS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => onPick(q)}
              className="rounded-xl border border-border bg-surface-card px-3.5 py-3 text-left text-sm text-text-secondary transition-colors last:sm:col-span-2 hover:border-border-strong hover:bg-surface-hover hover:text-foreground"
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
  const openSource = useOpenSource();
  const composerRef = useRef(null);

  const [userId, setUserId] = useState(null);
  const [pipelines, setPipelines] = useState([]);
  const [pipelinesLoaded, setPipelinesLoaded] = useState(false);
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
  const [knowledgeOnly, setKnowledgeOnly] = usePersistentFlag(KNOWLEDGE_ONLY_KEY, true);
  const [settingsOpen, setSettingsOpen] = usePersistentFlag(SETTINGS_OPEN_KEY, false);
  const [historySheetOpen, setHistorySheetOpen] = useState(false);
  const [settingsSheetOpen, setSettingsSheetOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  // The in-flight streamed reply; aborted when the thread changes, the screen unmounts, or the
  // user presses Stop (the server keeps whatever partial reply it had).
  const streamRef = useRef(null);
  const stopRequestedRef = useRef(false);
  useEffect(() => () => streamRef.current?.abort(), []);

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
      setPipelinesLoaded(true);
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
      setConversations(rows ?? []);
      setLoadingConversations(false);
    });
    return () => {
      alive = false;
    };
  }, [projectId, userId]);

  // Default the (unlocked, "new chat") pipeline picker to the first live pipeline — derived
  // during render rather than synced via an effect.
  const defaultPipelineId = useMemo(() => {
    if (!pipelines.length) return null;
    const live = pipelines.find((p) => p.status === "live");
    return (live || pipelines[0]).id;
  }, [pipelines]);
  const effectiveSelectedPipelineId = selectedPipelineId ?? defaultPipelineId;

  // Prefill the composer from a graph "Ask about this" link. Consuming the param is adjusted
  // during render; clearing it from the URL is the actual effect.
  const [consumedQ, setConsumedQ] = useState(null);
  if (qParam && qParam !== consumedQ) {
    setConsumedQ(qParam);
    setComposerValue(qParam);
  }
  useEffect(() => {
    if (qParam) url.setParam("q", null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qParam]);

  // Reset the thread when ?conversation= changes — including to null (new chat) —
  // synchronously during render so the fetch effect never sets state outside its .then().
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

  const knowledgeBaseNames = useMemo(
    () => (pipeline?.kbIds || []).map((id) => knowledgeBases.find((kb) => kb.id === id)?.name).filter(Boolean),
    [pipeline, knowledgeBases],
  );

  const focusComposer = () => requestAnimationFrame(() => composerRef.current?.focus());

  const openPipeline = (section = "model") => {
    if (pipeline) url.setTab("All Pipelines", { pipeline: pipeline.id, section });
  };

  const selectConversation = (conv) => {
    streamRef.current?.abort();
    setMessages([]);
    setActiveConversation(conv);
    url.openRecord("conversation", conv.id);
    setHistorySheetOpen(false);
  };

  const startNewChat = () => {
    streamRef.current?.abort();
    setMessages([]);
    setActiveConversation(null);
    url.closeRecord("conversation");
    setHistorySheetOpen(false);
    focusComposer();
  };

  // A first turn creates the conversation server-side; mirror it into the rail and the URL.
  const registerTurn = (started, content, pipelineId) => {
    const now = new Date().toISOString();
    if (!activeConversation) {
      const conv = {
        id: started.conversationId,
        projectId,
        pipelineId,
        userId,
        title: content.slice(0, 60),
        channel: "playground",
        createdAt: now,
        updatedAt: now,
      };
      setActiveConversation(conv);
      setConversations((prev) => [conv, ...prev.filter((c) => c.id !== conv.id)]);
      url.openRecord("conversation", started.conversationId);
    } else {
      setConversations((prev) => prev.map((c) => (c.id === activeConversation.id ? { ...c, updatedAt: now } : c)));
    }
  };

  const send = async (text) => {
    const fromComposer = text === undefined;
    const content = (fromComposer ? composerValue : text).trim();
    if (!content || sending) return;
    const pipelineId = activeConversation ? activeConversation.pipelineId : effectiveSelectedPipelineId;
    if (!pipelineId) {
      toast.error("Choose a pipeline before sending a message.");
      return;
    }

    const tempId = `temp-${crypto.randomUUID()}`;
    const replyId = `reply-${crypto.randomUUID()}`;
    setMessages((prev) => [
      ...prev,
      { id: tempId, role: "user", content, createdAt: new Date().toISOString(), pending: true },
    ]);
    if (fromComposer) setComposerValue("");
    setSending(true);

    const controller = new AbortController();
    streamRef.current = controller;
    stopRequestedRef.current = false;
    let started = null;
    let finished = false;
    let failure = null;
    let partial = "";
    // The saved row replaces the streamed placeholder under the same React key, so the reply
    // keeps its state (an open context panel) when it lands.
    const landReply = (row) =>
      setMessages((prev) => prev.map((m) => (m.id === replyId ? { ...row, clientKey: replyId } : m)));

    // streamChat() never throws — it resolves once the stream ends; events carry the reply.
    const { error, aborted } = await streamChat({
      projectId,
      conversationId: activeConversation?.id,
      pipelineId,
      content,
      overrides: { ...overrides, knowledgeOnly },
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === "start") {
          started = event;
          setMessages((prev) => [
            ...prev.map((m) => (m.id === tempId ? event.userMessage : m)),
            { id: replyId, role: "assistant", content: "", createdAt: new Date().toISOString(), pending: true },
          ]);
        } else if (event.type === "retrieval") {
          const { context, stats } = event;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === replyId
                ? { ...m, metadata: { ...m.metadata, ...(context ? { context } : {}), ...(stats ? { stats } : {}) } }
                : m,
            ),
          );
        } else if (event.type === "delta") {
          partial += event.text;
          setMessages((prev) => prev.map((m) => (m.id === replyId ? { ...m, content: m.content + event.text } : m)));
        } else if (event.type === "done") {
          finished = true;
          landReply(event.assistantMessage);
        } else if (event.type === "error") {
          failure = event;
          if (event.assistantMessage) landReply(event.assistantMessage);
        }
      },
    });

    if (streamRef.current === controller) streamRef.current = null;
    setSending(false);

    if (aborted) {
      // Switching threads or leaving the screen: the thread was already reset.
      if (!stopRequestedRef.current) return;
      if (!started) {
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        if (fromComposer) setComposerValue((current) => current || content);
        return;
      }
      // Stopped by the user: keep what streamed so far (the server saved it too).
      setMessages((prev) =>
        prev.flatMap((m) => {
          if (m.id !== replyId) return [m];
          return partial ? [{ ...m, pending: false, local: true, metadata: { ...m.metadata, aborted: true } }] : [];
        }),
      );
      registerTurn(started, content, pipelineId);
      return;
    }

    // Nothing came back: the server undid the turn, so put the question back in the composer.
    if (!started || (!finished && !failure?.assistantMessage && !partial)) {
      toast.error(failure?.message || error || "Couldn't get a reply. Try again.");
      const userMessageId = started?.userMessage?.id;
      setMessages((prev) => prev.filter((m) => m.id !== tempId && m.id !== replyId && m.id !== userMessageId));
      if (fromComposer) setComposerValue((current) => current || content);
      return;
    }

    // A reply that failed part-way keeps its partial text in the thread.
    if (failure) toast.error(failure.message || "The reply stopped before it finished.");
    else if (!finished) {
      toast.error("The connection dropped before the reply finished.");
      setMessages((prev) => prev.map((m) => (m.id === replyId ? { ...m, pending: false, local: true } : m)));
    }
    registerTurn(started, content, pipelineId);
  };

  const stop = () => {
    if (!streamRef.current) return;
    stopRequestedRef.current = true;
    streamRef.current.abort();
  };

  const retry = (assistantMessage) => {
    const index = messages.findIndex((m) => m.id === assistantMessage.id);
    const question = messages.slice(0, index).reverse().find((m) => m.role === "user");
    if (question) send(question.content);
  };

  const editMessage = (message) => {
    setComposerValue(message.content);
    focusComposer();
  };

  // setMessageFeedback returns the updated row on success, null on failure — falsy rolls back.
  const handleFeedback = async (message, patch) => {
    setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, ...patch } : m)));
    const saved = await setMessageFeedback(message.id, patch);
    if (!saved) {
      toast.error("Couldn't save feedback.");
      setMessages((prev) => prev.map((m) => (m.id === message.id ? message : m)));
    }
  };

  const handleUnanswered = async (message) => {
    const next = !message.unanswered;
    setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, unanswered: next } : m)));
    const saved = await setMessageFeedback(message.id, { unanswered: next });
    if (!saved) {
      toast.error("Couldn't update this message.");
      setMessages((prev) => prev.map((m) => (m.id === message.id ? message : m)));
    } else {
      toast.success(next ? "Marked unanswered — it's now in Feedback." : "Unmarked.");
    }
  };

  const renameConversation = async (conv, title) => {
    setConversations((prev) => prev.map((c) => (c.id === conv.id ? { ...c, title } : c)));
    if (activeConversation?.id === conv.id) setActiveConversation((a) => ({ ...a, title }));
    const saved = await updateConversation(conv.id, { title });
    if (!saved) {
      toast.error("Couldn't rename the chat.");
      setConversations((prev) => prev.map((c) => (c.id === conv.id ? conv : c)));
      if (activeConversation?.id === conv.id) setActiveConversation((a) => ({ ...a, title: conv.title }));
    }
  };

  const confirmDelete = async () => {
    const conv = deleteTarget;
    setDeleteTarget(null);
    if (!conv) return;
    const removed = await deleteConversation(conv.id);
    if (!removed) {
      toast.error("Couldn't delete the chat.");
      return;
    }
    setConversations((prev) => prev.filter((c) => c.id !== conv.id));
    if (activeConversation?.id === conv.id) startNewChat();
    toast.success("Chat deleted.");
  };

  const toggleSettings = () => {
    if (window.matchMedia("(min-width: 1280px)").matches) setSettingsOpen(!settingsOpen);
    else setSettingsSheetOpen(true);
  };

  const renderActions = (message, { isLast }) => {
    if (message.pending) return null;
    if (message.role === "user") return <UserActions message={message} onEdit={editMessage} />;
    return (
      <AssistantActions
        message={message}
        isLast={isLast}
        busy={sending}
        onRetry={() => retry(message)}
        onFeedback={handleFeedback}
        onUnanswered={handleUnanswered}
      />
    );
  };

  const railProps = {
    conversations,
    activeId: activeConversation?.id || null,
    loading: loadingConversations,
    onSelect: selectConversation,
    onNew: startNewChat,
    onRename: renameConversation,
    onDelete: setDeleteTarget,
  };

  const settingsProps = {
    pipeline,
    knowledgeBaseNames,
    overrides,
    onOverridesChange: setOverrides,
    onOpenPipeline: pipeline ? () => openPipeline("model") : undefined,
  };

  const title = activeConversation?.title || (activeConversation ? "Untitled chat" : "New chat");
  const subtitle = pipeline
    ? [pipeline.model, knowledgeBaseNames.length ? knowledgeBaseNames.join(", ") : "No knowledge base"].filter(Boolean).join(" · ")
    : null;

  return (
    <TooltipProvider delayDuration={300}>
      <MainScreenWrapper className="lg:flex lg:h-full lg:flex-col lg:gap-4 lg:space-y-0 lg:overflow-hidden">
        <ScreenHeader
          title="Playground"
          description="Chat against your pipelines and check every answer against its sources before it ships."
        />

        <div className="flex h-[78vh] min-h-[520px] overflow-hidden rounded-xl border border-border bg-surface-subtle lg:h-auto lg:min-h-0 lg:flex-1">
          <aside className="hidden w-[272px] shrink-0 border-r border-border lg:flex">
            <ConversationRail {...railProps} />
          </aside>

          <section className="flex min-w-0 flex-1 flex-col">
            <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3 md:px-4">
              <IconAction label="Chats" onClick={() => setHistorySheetOpen(true)} className="h-8 w-8 lg:hidden [&_svg]:h-4 [&_svg]:w-4">
                <PanelLeft />
              </IconAction>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{title}</p>
                {subtitle ? <p className="truncate text-[11px] text-text-tertiary">{subtitle}</p> : null}
              </div>
              {pipelines.length ? (
                <PipelinePicker
                  pipelines={pipelines}
                  value={pipeline?.id || null}
                  onChange={setSelectedPipelineId}
                  locked={Boolean(activeConversation)}
                />
              ) : null}
              <IconAction
                label={settingsOpen ? "Hide run settings" : "Run settings"}
                active={settingsOpen}
                onClick={toggleSettings}
                className="h-8 w-8 [&_svg]:h-4 [&_svg]:w-4"
              >
                <SlidersHorizontal />
              </IconAction>
            </header>

            {loadingMessages && !messages.length ? (
              <LoadingArea label="Loading conversation" />
            ) : (
              <MessageList
                messages={messages}
                renderActions={renderActions}
                onOpenSource={openSource}
                onFixInPipeline={pipeline ? () => openPipeline("model") : undefined}
                assistantLabel={pipeline?.name}
                emptyState={
                  <ChatEmptyState
                    pipeline={pipeline}
                    pipelinesLoaded={pipelinesLoaded}
                    hasPipelines={pipelines.length > 0}
                    knowledgeBaseNames={knowledgeBaseNames}
                    onPick={(q) => send(q)}
                    onOpenPipeline={openPipeline}
                    onCreatePipeline={() => url.setTab("All Pipelines")}
                  />
                }
              />
            )}

            <Composer
              ref={composerRef}
              value={composerValue}
              onChange={setComposerValue}
              onSubmit={() => send()}
              onStop={stop}
              streaming={sending}
              disabled={!pipeline}
              placeholder={pipeline ? `Ask ${pipeline.name} a question…` : "Choose a pipeline to start"}
              toolbar={<KnowledgeOnlyToggle checked={knowledgeOnly} onChange={setKnowledgeOnly} />}
            />
          </section>

          {settingsOpen ? (
            <aside className="hidden w-[300px] shrink-0 border-l border-border xl:flex">
              <RunSettingsPanel {...settingsProps} onClose={() => setSettingsOpen(false)} />
            </aside>
          ) : null}
        </div>

        <Sheet open={historySheetOpen} onOpenChange={setHistorySheetOpen}>
          <SheetContent side="left" showCloseButton={false} className="w-[300px] gap-0 bg-surface-subtle p-0">
            <SheetTitle className="sr-only">Chats</SheetTitle>
            <ConversationRail {...railProps} />
          </SheetContent>
        </Sheet>

        <Sheet open={settingsSheetOpen} onOpenChange={setSettingsSheetOpen}>
          <SheetContent side="right" showCloseButton={false} className="w-[320px] gap-0 bg-surface-subtle p-0">
            <SheetTitle className="sr-only">Run settings</SheetTitle>
            <RunSettingsPanel {...settingsProps} onClose={() => setSettingsSheetOpen(false)} />
          </SheetContent>
        </Sheet>

        <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Delete chat?</DialogTitle>
              <DialogDescription>
                <span className="font-medium text-foreground">{deleteTarget?.title || "This chat"}</span> and its messages
                will be removed from your history. Request logs and usage stay.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={confirmDelete}>
                Delete chat
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </MainScreenWrapper>
    </TooltipProvider>
  );
}

export default ChatScreen;
