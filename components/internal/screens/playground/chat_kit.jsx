"use client";

import React, { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, FileText, Info, Square } from "lucide-react";

import { Button } from "@geiger/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@geiger/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@geiger/ui/tooltip";
import { LogoLoading } from "@geiger/ui";
import { cn } from "@/lib/utils";
import { useWorkspaceUrl } from "@/lib/hooks/use-workspace-url";
import { citationLocation, replyMetrics, replyNotice, replySource } from "@/lib/grey/playground";
import { ContextPanel, ContextToggle } from "./context_panel";
import { Markdown } from "./markdown";

// Chat surface shared by the live Playground thread and the read-only Conversations
// transcript. Layout follows geiger-flow's chat (grouped column, hover action pill, rounded
// composer box); assistant turns render as markdown prose rather than bubbles, since answers
// run long and carry lists, tables and code.

// Shared "open this citation's source" handler — the live thread and the transcript both hand
// off to the Sources tab in one atomic setTab (setTab + openRecord in two calls would lose the
// param). Timestamped citations (audio/video) also pass `t` in whole seconds.
export function useOpenSource() {
  const url = useWorkspaceUrl();
  return (citation) => {
    if (!citation?.sourceId) return;
    const startMs = Number(citation.startMs);
    const hasTime = citation.startMs !== null && citation.startMs !== undefined && Number.isFinite(startMs);
    url.setTab("Sources", {
      source: citation.sourceId,
      t: hasTime ? Math.floor(startMs / 1000) : undefined,
    });
  };
}

function clockTime(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function fullTime(iso) {
  if (!iso) return undefined;
  try {
    return new Date(iso).toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return undefined;
  }
}

// Popover body for a citation: source, location, retrieved snippet, and a jump to the source.
function CitationCard({ citation, onOpenSource }) {
  const location = citationLocation(citation);
  return (
    <div className="space-y-2.5">
      <div className="flex items-start gap-2">
        <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-tertiary" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{citation.title || "Untitled source"}</p>
          {location ? <p className="text-[11px] text-text-tertiary">{location}</p> : null}
        </div>
      </div>
      {citation.snippet ? (
        <p className="scrollbar-subtle max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-surface-subtle px-2.5 py-2 text-xs leading-5 text-text-secondary">
          {citation.snippet}
        </p>
      ) : (
        <p className="text-xs text-text-tertiary">No preview available for this passage.</p>
      )}
      {onOpenSource && citation.sourceId ? (
        <Button
          size="sm"
          variant="outline"
          className="w-full border-border bg-transparent text-muted-foreground hover:bg-surface-active hover:text-foreground"
          onClick={() => onOpenSource(citation)}
        >
          Open source
        </Button>
      ) : null}
    </div>
  );
}

// Inline [n] marker inside an answer.
function CitationMarker({ n, citation, onOpenSource }) {
  if (!citation) return <span className="text-text-tertiary">[{n}]</span>;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Source ${n}: ${citation.title || "Untitled source"}`}
          className="mx-0.5 inline-flex h-[18px] min-w-[18px] -translate-y-px items-center justify-center rounded-[5px] border border-border bg-surface-card px-1 align-middle text-[10px] font-semibold tabular-nums text-text-secondary transition-colors hover:border-border-strong hover:text-foreground"
        >
          {n}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <CitationCard citation={citation} onOpenSource={onOpenSource} />
      </PopoverContent>
    </Popover>
  );
}

// Numbered source chip for the "Sources" row under an answer.
export function CitationChip({ citation, onOpenSource }) {
  if (!citation) return null;
  const location = citationLocation(citation);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-7 max-w-[16rem] items-center gap-1.5 rounded-md border border-border bg-surface-card pl-1 pr-2.5 text-xs text-text-secondary transition-colors hover:border-border-strong hover:bg-surface-hover hover:text-foreground"
        >
          <span className="flex h-5 min-w-5 items-center justify-center rounded bg-surface-hover px-1 text-[10px] font-semibold tabular-nums text-foreground">
            {citation.index ?? "·"}
          </span>
          <span className="truncate">{citation.title || "Untitled source"}</span>
          {location ? <span className="shrink-0 text-text-tertiary">{location}</span> : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <CitationCard citation={citation} onOpenSource={onOpenSource} />
      </PopoverContent>
    </Popover>
  );
}

// Small ghost icon button with a tooltip — the unit every message action is built from.
export const IconAction = forwardRef(function IconAction(
  { label, active = false, className, children, ...props },
  ref,
) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          ref={ref}
          type="button"
          aria-label={label}
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-40 [&_svg]:h-3.5 [&_svg]:w-3.5",
            active ? "text-foreground" : "text-text-tertiary hover:bg-surface-hover hover:text-foreground",
            className,
          )}
          {...props}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
});

export function TypingIndicator() {
  return (
    <div className="flex h-6 items-center gap-1" role="status" aria-label="Generating a reply">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.2s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.1s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" />
    </div>
  );
}

const NOTICE_TONES = {
  warning: "border-amber-500/20 bg-amber-500/10 text-amber-400",
  danger: "border-red-500/20 bg-red-500/10 text-red-400",
  neutral: "border-border bg-surface-card text-text-secondary",
};

function ReplyNotice({ notice, onFix }) {
  const Icon = notice.tone === "neutral" ? Info : AlertTriangle;
  return (
    <div
      className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-5", NOTICE_TONES[notice.tone])}
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <p className="min-w-0 flex-1">{notice.text}</p>
      {notice.fixInPipeline && onFix ? (
        <button
          type="button"
          onClick={onFix}
          className="shrink-0 font-medium underline decoration-current/40 underline-offset-2 hover:decoration-current"
        >
          Open pipeline
        </button>
      ) : null}
    </div>
  );
}

// "Embedding 1.2s · 8 tok/s" in a reply's header; the model and token counts in a tooltip.
function ReplyMetric({ metric }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="inline-flex h-6 shrink-0 cursor-default items-center gap-1 rounded-sm text-[11px] tabular-nums text-text-tertiary outline-none focus-visible:ring-1 focus-visible:ring-border-strong"
        >
          {metric.label}
          <span className="font-medium text-text-secondary">{metric.time}</span>
          {metric.rate ? <span>· {metric.rate}</span> : null}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="space-y-0.5 text-left">
        {metric.detail.map((line, i) => (
          <p key={line} className={i === 0 ? "font-medium" : "opacity-80"}>
            {line}
          </p>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}

function UserMessage({ message, actions }) {
  return (
    <div className="group/msg flex items-start justify-end gap-1.5">
      {actions ? (
        <div className="mt-1 flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/msg:opacity-100">
          {actions}
        </div>
      ) : null}
      <div
        title={fullTime(message.createdAt)}
        className={cn(
          "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-tr-md bg-surface-hover px-4 py-2.5 text-sm leading-relaxed text-foreground",
          message.pending && "opacity-60",
        )}
      >
        {message.content}
      </div>
    </div>
  );
}

function AssistantMessage({ message, label, actions, persistentActions, onOpenSource, onFixInPipeline }) {
  const [contextOpen, setContextOpen] = useState(false);
  const thinking = message.pending && !message.content;
  const citationByIndex = useMemo(
    () => new Map((message.citations || []).map((c) => [c.index, c])),
    [message.citations],
  );
  const citedIndexes = useMemo(() => new Set(citationByIndex.keys()), [citationByIndex]);
  const notice = replyNotice(message);
  const source = replySource(message);
  const metrics = replyMetrics(message);
  const context = message.metadata?.context?.passages?.length ? message.metadata.context : null;
  const contextId = `context-${message.clientKey || message.id}`;
  const renderCite = (n, key) => (
    <CitationMarker key={key} n={n} citation={citationByIndex.get(n)} onOpenSource={onOpenSource} />
  );

  return (
    <div className="group/msg flex flex-col gap-2">
      <div className="flex min-h-6 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-semibold text-foreground">{label || "Assistant"}</span>
          {message.createdAt ? (
            <span className="shrink-0 text-[11px] text-text-tertiary" title={fullTime(message.createdAt)}>
              {clockTime(message.createdAt)}
            </span>
          ) : null}
        </span>
        {source ? (
          <span className="shrink-0 rounded-full border border-border px-2 py-px text-[10px] font-medium text-text-secondary">
            {source}
          </span>
        ) : null}
        {context ? (
          <ContextToggle
            context={context}
            open={contextOpen}
            onToggle={() => setContextOpen((v) => !v)}
            controls={contextId}
          />
        ) : null}
        {metrics.map((metric) => (
          <ReplyMetric key={metric.key} metric={metric} />
        ))}
      </div>

      {context && contextOpen ? (
        <ContextPanel id={contextId} context={context} citedIndexes={citedIndexes} onOpenSource={onOpenSource} />
      ) : null}

      {thinking ? (
        <TypingIndicator />
      ) : message.content ? (
        <Markdown text={message.content} renderCite={renderCite} />
      ) : null}

      {notice ? <ReplyNotice notice={notice} onFix={onFixInPipeline} /> : null}

      {message.citations?.length ? (
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="mr-0.5 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Sources</span>
          {[...message.citations]
            .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
            .map((c, i) => (
              <CitationChip key={c.chunkId || `${c.sourceId}-${i}`} citation={c} onOpenSource={onOpenSource} />
            ))}
        </div>
      ) : null}

      {actions ? (
        <div
          className={cn(
            "-ml-1.5 flex min-h-7 items-center gap-0.5 transition-opacity focus-within:opacity-100",
            persistentActions ? "opacity-100" : "opacity-0 group-hover/msg:opacity-100",
          )}
        >
          {actions}
        </div>
      ) : null}
    </div>
  );
}

// Within this distance of the bottom the thread keeps following new content.
const STICK_PX = 120;

// Scrollable thread. `renderActions(message, { isLast })` returns each message's action row;
// `assistantLabel` names the assistant (the pipeline); `emptyState` replaces the list when
// there's nothing yet. Follows streaming output while the reader is at the bottom and offers
// a jump back when they've scrolled up.
export function MessageList({
  messages = [],
  renderActions,
  emptyState,
  onOpenSource,
  onFixInPipeline,
  assistantLabel,
  loading,
}) {
  const scrollRef = useRef(null);
  const stickRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const last = messages.at(-1);
  const lastLength = last?.content?.length ?? 0;
  const lastAssistantId = useMemo(() => [...messages].reverse().find((m) => m.role === "assistant")?.id, [messages]);

  const lastRole = last?.role;
  const lastPending = Boolean(last?.pending);

  // A message I just sent always brings the thread back down.
  useLayoutEffect(() => {
    if (lastRole === "user" && lastPending) stickRef.current = true;
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, lastLength, lastRole, lastPending]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickRef.current = distance < STICK_PX;
    setShowJump(distance > STICK_PX * 2);
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-16">
        <LogoLoading size={40} aria-label="Loading conversation" />
      </div>
    );
  }

  if (!messages.length) {
    return (
      <div className="scrollbar-subtle flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
        {emptyState || <p className="text-sm text-text-secondary">No messages yet.</p>}
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={scrollRef} onScroll={onScroll} className="scrollbar-subtle min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-7 px-4 py-6 md:px-6">
            {messages.map((m) =>
              m.role === "user" ? (
                <UserMessage key={m.clientKey || m.id} message={m} actions={renderActions?.(m, { isLast: false })} />
              ) : (
                <AssistantMessage
                  key={m.clientKey || m.id}
                  message={m}
                  label={assistantLabel}
                  actions={renderActions?.(m, {
                    isLast: m.id === lastAssistantId,
                  })}
                  persistentActions={m.id === lastAssistantId || Boolean(m.feedback) || Boolean(m.unanswered)}
                  onOpenSource={onOpenSource}
                  onFixInPipeline={onFixInPipeline}
                />
              ),
            )}
          </div>
        </div>
        {showJump ? (
          <button
            type="button"
            onClick={() => {
              stickRef.current = true;
              scrollRef.current?.scrollTo({
                top: scrollRef.current.scrollHeight,
                behavior: "smooth",
              });
            }}
            className="absolute bottom-3 left-1/2 inline-flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-surface-dialog px-3 text-xs font-medium text-text-secondary shadow-sm transition-colors hover:text-foreground"
          >
            <ArrowDown className="h-3.5 w-3.5" /> Jump to latest
          </button>
        ) : null}
      </div>
    </TooltipProvider>
  );
}

const MAX_COMPOSER_PX = 208;

// Controlled composer. Enter sends, Shift+Enter adds a line, Esc stops a streaming reply.
// While `streaming`, typing stays open but the send button becomes Stop. `toolbar` sits at
// the bottom-left of the box (the knowledge-only toggle lives there).
export const Composer = forwardRef(function Composer(
  { value, onChange, onSubmit, onStop, streaming = false, disabled = false, placeholder, toolbar },
  ref,
) {
  const textareaRef = useRef(null);
  const canSend = !disabled && !streaming && Boolean(value?.trim());

  useImperativeHandle(ref, () => ({ focus: () => textareaRef.current?.focus() }), []);

  // Grow with the content up to MAX_COMPOSER_PX, then scroll.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_COMPOSER_PX)}px`;
  }, [value]);

  const submit = () => {
    if (canSend) onSubmit?.();
  };

  return (
    <div className="shrink-0 px-4 pb-4 pt-2 md:px-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className={cn(
          "mx-auto w-full max-w-3xl rounded-2xl border border-border bg-surface-card shadow-sm transition-colors focus-within:border-border-strong",
          disabled && "opacity-60",
        )}
      >
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape" && streaming) {
              e.preventDefault();
              onStop?.();
            }
          }}
          disabled={disabled}
          placeholder={placeholder || "Ask a question…"}
          aria-label="Message"
          className="scrollbar-subtle block w-full resize-none bg-transparent px-4 pb-1 pt-3.5 text-sm leading-6 text-foreground placeholder:text-text-tertiary focus:outline-none disabled:cursor-not-allowed"
        />
        <div className="flex items-center gap-2 px-2.5 pb-2.5 pt-1">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">{toolbar}</div>
          <span className="hidden text-[11px] text-text-tertiary sm:inline">
            {streaming ? "Esc to stop" : "Enter to send · Shift + Enter for a new line"}
          </span>
          {streaming ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop generating"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Square className="h-3 w-3 fill-current" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSend}
              aria-label="Send message"
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors",
                canSend
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-surface-hover text-text-tertiary",
              )}
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          )}
        </div>
      </form>
    </div>
  );
});
