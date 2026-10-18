"use client";

import React, { useEffect, useState } from "react";
import { CircleHelp, ThumbsDown, ThumbsUp } from "lucide-react";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@geiger/ui/sheet";
import { Badge } from "@geiger/ui/badge";
import { LoadingArea } from "@geiger/ui";
import { cn } from "@/lib/utils";
import { listMessages } from "@/lib/supabase/conversations";
import { CHANNEL_MAP } from "./constants";
import { MessageList, useOpenSource } from "./chat_kit";

// Read-only summary of a message's feedback/unanswered state — the live
// Chat thread uses interactive controls (chat.jsx's MessageFeedback); the
// Conversations transcript only reports what was already recorded.
function FeedbackSummary({ message }) {
  if (message.role !== "assistant") return null;
  if (!message.feedback && !message.unanswered) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {message.feedback === "up" ? (
        <Badge variant="success" className="gap-1">
          <ThumbsUp className="h-3 w-3" /> Helpful
        </Badge>
      ) : null}
      {message.feedback === "down" ? (
        <Badge variant="danger" className="gap-1">
          <ThumbsDown className="h-3 w-3" /> Not helpful
        </Badge>
      ) : null}
      {message.unanswered ? (
        <Badge variant="warning" className="gap-1">
          <CircleHelp className="h-3 w-3" /> Unanswered
        </Badge>
      ) : null}
      {message.feedbackNote ? (
        <span className="truncate text-[11px] italic text-text-tertiary">“{message.feedbackNote}”</span>
      ) : null}
    </div>
  );
}

// Read-only thread + citations for one conversation, opened from the
// Conversations table. `conversation` carries the row the table already
// resolved (pipeline/user labels included) so this only has to fetch messages.
export function TranscriptSheet({ conversation, pipelineName, userLabel, onClose }) {
  const openSource = useOpenSource();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);

  // Reset synchronously during render when the sheet switches to a different
  // conversation (React's recommended fix — keeps the fetch effect below free
  // of any setState call outside its .then()).
  const [lastLoadedId, setLastLoadedId] = useState(conversation?.id ?? null);
  const conversationId = conversation?.id ?? null;
  if (conversationId !== lastLoadedId) {
    setLastLoadedId(conversationId);
    setMessages([]);
    setLoading(Boolean(conversationId));
  }

  useEffect(() => {
    if (!conversationId) return;
    let alive = true;
    listMessages(conversationId).then((rows) => {
      if (!alive) return;
      setMessages(rows ?? []);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [conversationId]);

  const channel = CHANNEL_MAP[conversation?.channel] || CHANNEL_MAP.playground;

  return (
    <Sheet open={!!conversation} onOpenChange={(o) => !o && onClose?.()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        {conversation ? (
          <>
            <SheetHeader className="border-b border-border">
              <div className="flex items-center gap-2 pr-8">
                <SheetTitle className="truncate">
                  {conversation.title || "Untitled conversation"}
                </SheetTitle>
                <Badge variant={channel.variant} className={cn("shrink-0")}>
                  {channel.label}
                </Badge>
              </div>
              <SheetDescription className="truncate">
                {pipelineName || "No pipeline"} · {userLabel || "Unknown user"}
              </SheetDescription>
            </SheetHeader>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {loading ? (
                <LoadingArea label="Loading transcript" />
              ) : (
                <MessageList
                  messages={messages}
                  onOpenSource={openSource}
                  assistantLabel={pipelineName}
                  renderActions={(m) => (m.role === "assistant" ? <FeedbackSummary message={m} /> : null)}
                  emptyState={<p className="text-sm text-text-secondary">No messages in this conversation.</p>}
                />
              )}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

export default TranscriptSheet;
