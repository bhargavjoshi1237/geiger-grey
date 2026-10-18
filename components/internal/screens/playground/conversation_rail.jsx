"use client";

import React, { useMemo, useState } from "react";
import { MessagesSquare, Pencil, Search, SquarePen, Trash2 } from "lucide-react";

import { ActionMenu } from "@geiger/ui/action-menu";
import { Skeleton } from "@geiger/ui/skeleton";
import { cn } from "@/lib/utils";
import { groupConversations } from "@/lib/grey/playground";
import { IconAction } from "./chat_kit";

function RenameInput({ initial, onSave, onCancel }) {
  const [value, setValue] = useState(initial);
  const commit = () => {
    const next = value.trim();
    if (next && next !== initial) onSave(next);
    else onCancel();
  };
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        else if (e.key === "Escape") onCancel();
      }}
      onFocus={(e) => e.target.select()}
      aria-label="Chat title"
      className="h-9 w-full rounded-lg border border-border-strong bg-surface-card px-2.5 text-sm text-foreground focus:outline-none"
    />
  );
}

// History rail: new chat, search, chats grouped by recency (Today / Yesterday / …), and a
// per-chat menu to rename or delete.
export function ConversationRail({ conversations, activeId, loading, onSelect, onNew, onRename, onDelete, className }) {
  const [query, setQuery] = useState("");
  const [renamingId, setRenamingId] = useState(null);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q ? conversations.filter((c) => (c.title || "").toLowerCase().includes(q)) : conversations;
    return groupConversations(matches);
  }, [conversations, query]);

  return (
    <div className={cn("flex h-full min-h-0 w-full flex-col", className)}>
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 px-4">
        <p className="text-sm font-semibold text-foreground">Chats</p>
        <IconAction label="New chat" onClick={onNew} className="h-8 w-8 [&_svg]:h-4 [&_svg]:w-4">
          <SquarePen />
        </IconAction>
      </div>

      <div className="shrink-0 px-3 pb-2">
        <label className="flex h-9 items-center gap-2 rounded-lg border border-border bg-surface-card px-2.5 transition-colors focus-within:border-border-strong">
          <Search className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats"
            aria-label="Search chats"
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-text-tertiary focus:outline-none"
          />
        </label>
      </div>

      <div className="scrollbar-subtle min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {loading ? (
          <div className="space-y-1.5 px-1 pt-3">
            {[72, 56, 64, 48].map((w) => (
              <Skeleton key={w} className="h-8 rounded-lg" style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : groups.length ? (
          groups.map((group) => (
            <div key={group.label}>
              <p className="px-2 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
                {group.label}
              </p>
              <div className="space-y-px">
                {group.items.map((c) =>
                  renamingId === c.id ? (
                    <RenameInput
                      key={c.id}
                      initial={c.title || ""}
                      onCancel={() => setRenamingId(null)}
                      onSave={(title) => {
                        setRenamingId(null);
                        onRename(c, title);
                      }}
                    />
                  ) : (
                    <div
                      key={c.id}
                      className={cn(
                        "group/item flex h-9 items-center rounded-lg pr-1 transition-colors",
                        activeId === c.id
                          ? "bg-surface-active text-foreground"
                          : "text-text-secondary hover:bg-surface-hover hover:text-foreground",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => onSelect(c)}
                        className="h-full min-w-0 flex-1 truncate pl-2.5 text-left text-sm"
                      >
                        {c.title || "Untitled chat"}
                      </button>
                      <ActionMenu
                        label={`Actions for ${c.title || "chat"}`}
                        triggerClassName="h-7 w-7 opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                        items={[
                          { icon: Pencil, label: "Rename", onSelect: () => setRenamingId(c.id) },
                          { separator: true },
                          { icon: Trash2, label: "Delete", destructive: true, onSelect: () => onDelete(c) },
                        ]}
                      />
                    </div>
                  ),
                )}
              </div>
            </div>
          ))
        ) : (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <MessagesSquare className="h-5 w-5 text-text-tertiary" strokeWidth={1.8} />
            <p className="text-xs text-text-tertiary">
              {query.trim() ? "No chats match your search." : "Your chats will show up here."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default ConversationRail;
