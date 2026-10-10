"use client";

import React, { useEffect, useRef, useState } from "react";
import { FileText, Loader2, Send } from "lucide-react";

import { Button } from "@geiger/ui/button";
import { Textarea } from "@geiger/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@geiger/ui/popover";
import { LogoLoading } from "@geiger/ui";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/grey/format";

// Bespoke chat surface for the Playground — same bubble/composer styling as
// geiger-events' components/chat/chat_kit.jsx (semantic tokens, same radii and
// spacing), rebuilt around a single-user assistant thread instead of a
// multi-participant channel: one bubble per turn, no reactions/polls, and an
// extra citations row under assistant replies.

function clockTime(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

function citationLabel(citation) {
  const parts = [citation.title || "Source"];
  if (citation.page) parts.push(`p. ${citation.page}`);
  else if (citation.startMs !== undefined && citation.startMs !== null) {
    parts.push(formatDuration(citation.startMs));
  }
  return parts.join(" · ");
}

// A single citation pill — opens a Popover with the retrieved snippet and an
// "Open source" link that hands off to the Sources tab (via the caller's
// onOpenSource, which owns the useWorkspaceUrl() navigation).
export function CitationChip({ citation, onOpenSource }) {
  if (!citation) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-card px-2 py-0.5 text-[11px] text-text-secondary transition-colors hover:border-border-strong hover:bg-surface-hover hover:text-foreground"
        >
          <FileText className="h-3 w-3 text-text-tertiary" />
          <span className="max-w-[12rem] truncate">{citationLabel(citation)}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-2.5 text-sm">
        <p className="truncate font-medium text-foreground">{citation.title || "Untitled source"}</p>
        {citation.snippet ? (
          <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-text-secondary">
            {citation.snippet}
          </p>
        ) : (
          <p className="text-xs text-text-tertiary">No preview available for this chunk.</p>
        )}
        {onOpenSource ? (
          <Button
            size="sm"
            variant="outline"
            className="w-full border-border bg-transparent text-muted-foreground hover:bg-surface-active hover:text-foreground"
            onClick={() => onOpenSource(citation)}
          >
            Open source
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

// user right/primary, assistant left/surface; citations row under assistant
// replies; `actions` is whatever the caller wants under the bubble (feedback
// controls on the live thread, a read-only summary on a transcript).
export function MessageBubble({ message, actions, onOpenSource }) {
  const mine = message.role === "user";
  const placeholder = Boolean(message.metadata?.placeholder);
  const pending = Boolean(message.pending);

  return (
    <div className={cn("flex gap-2.5", mine ? "flex-row-reverse" : "flex-row")}>
      <div className={cn("flex min-w-0 max-w-[80%] flex-col", mine ? "items-end" : "items-start")}>
        <div
          className={cn(
            "rounded-2xl px-3.5 py-2 text-sm",
            mine ? "bg-primary text-primary-foreground" : "bg-surface-card text-foreground",
            pending && "opacity-70",
          )}
        >
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>

        <div className={cn("mt-1 flex items-center gap-2 text-[10px] text-text-tertiary", mine && "flex-row-reverse")}>
          {placeholder ? (
            <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
              Placeholder
            </span>
          ) : null}
          {message.createdAt ? <span>{clockTime(message.createdAt)}</span> : null}
        </div>

        {!mine && message.citations?.length ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {message.citations.map((c, i) => (
              <CitationChip key={c.chunkId || c.sourceId || i} citation={c} onOpenSource={onOpenSource} />
            ))}
          </div>
        ) : null}

        {actions ? <div className="mt-1.5">{actions}</div> : null}
      </div>
    </div>
  );
}

// Scrollable thread. `renderActions(message)` returns the actions node for
// each message (only called for assistant turns in practice); `emptyState`
// replaces the list entirely while there is nothing to show yet.
export function MessageList({ messages = [], renderActions, emptyState, onOpenSource, loading }) {
  const endRef = useRef(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-16">
        <LogoLoading size={40} aria-label="Loading conversation" />
      </div>
    );
  }

  if (!messages.length) {
    return (
      <div className="flex flex-1 items-center justify-center overflow-y-auto">
        {emptyState || (
          <p className="text-sm text-text-secondary">No messages yet — ask a question below.</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
      {messages.map((m) => (
        <MessageBubble
          key={m.id}
          message={m}
          onOpenSource={onOpenSource}
          actions={renderActions ? renderActions(m) : null}
        />
      ))}
      <div ref={endRef} />
    </div>
  );
}

// Controlled composer: Enter sends, Shift+Enter inserts a newline, disabled
// shows a spinner in place of the send icon while a reply is pending.
export function Composer({ value, onChange, onSubmit, disabled, placeholder }) {
  const [focused, setFocused] = useState(false);

  const submit = () => {
    if (disabled || !value?.trim()) return;
    onSubmit?.();
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className={cn(
        "flex items-end gap-2 border-t border-border p-3 transition-colors",
        focused && "bg-surface-hover/40",
      )}
    >
      <Textarea
        rows={1}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        disabled={disabled}
        placeholder={placeholder || "Ask a question…"}
        className="max-h-40 min-h-[2.5rem] flex-1 resize-none"
      />
      <Button
        type="submit"
        disabled={disabled || !value?.trim()}
        className="bg-primary text-primary-foreground hover:bg-primary/90"
      >
        {disabled ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
      </Button>
    </form>
  );
}
