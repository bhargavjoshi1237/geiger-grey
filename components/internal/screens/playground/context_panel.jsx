"use client";

import React, { useEffect, useState } from "react";
import { ArrowUpRight, Check, ChevronDown, Copy, Layers } from "lucide-react";

import { cn } from "@/lib/utils";
import { useProject } from "@/context/project-context";
import { useCopy } from "@/lib/hooks/use-copy";
import { getChunkContents } from "@/lib/supabase/chunks";
import { formatNumber, formatScore } from "@/lib/grey/format";
import { citationLocation, contextSummary, contextText, passageText } from "@/lib/grey/playground";

// What a reply sent the model: the numbered knowledge-base passages saved on the message
// (metadata.context), each with its retrieval score and size. The toggle sits in the reply's
// header after the time; the panel opens beneath it and is laid out like a code block.

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function ContextToggle({ context, open, onToggle, controls }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      className={cn(
        "-mx-1.5 inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-[11px] tabular-nums transition-colors",
        open ? "bg-surface-hover text-foreground" : "text-text-tertiary hover:bg-surface-hover hover:text-foreground",
      )}
    >
      <Layers className="h-3.5 w-3.5" />
      <span className="sr-only">Context sent to the model:</span>
      {plural(context.passages.length, "passage")} · ~{formatNumber(context.tokens)} tokens
      <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
    </button>
  );
}

// One passage: source and size on a toggle line, the text clamped to two lines until expanded.
// `contents` is undefined while loading, null when the load failed, else Map(chunkId -> text).
function PassageRow({ passage, contents, cited, onOpenSource }) {
  const [expanded, setExpanded] = useState(false);
  const { text, full } = passageText(passage, contents);
  const location = citationLocation(passage);
  const gone = contents instanceof Map && !full;

  return (
    <li className="flex gap-3 px-3 py-2.5">
      <span className="mt-px flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-[5px] border border-border px-1 text-[10px] font-semibold tabular-nums text-text-secondary">
        {passage.index}
      </span>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="group/row flex w-full items-center gap-2 text-left"
        >
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
            {passage.title || "Untitled source"}
            {location ? <span className="font-normal text-text-tertiary"> · {location}</span> : null}
          </span>
          {cited ? (
            <span className="shrink-0 rounded-full border border-border px-2 py-px text-[10px] font-medium text-text-secondary">
              Cited
            </span>
          ) : null}
          <span className="shrink-0 text-[11px] tabular-nums text-text-tertiary">
            {passage.score !== null && passage.score !== undefined ? (
              <span className="hidden sm:inline" title="Retrieval score">
                {formatScore(passage.score)} ·{" "}
              </span>
            ) : null}
            {formatNumber(passage.tokens)} tokens
          </span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-text-tertiary transition-transform group-hover/row:text-foreground",
              expanded && "rotate-180",
            )}
          />
        </button>
        <p className={cn("mt-1 break-words text-xs leading-5 text-text-secondary", expanded ? "whitespace-pre-line" : "line-clamp-2")}>
          {text}
        </p>
        {expanded ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-tertiary">
            {onOpenSource && passage.sourceId ? (
              <button
                type="button"
                onClick={() => onOpenSource(passage)}
                className="inline-flex items-center gap-1 font-medium text-text-secondary transition-colors hover:text-foreground"
              >
                Open source <ArrowUpRight className="h-3 w-3" />
              </button>
            ) : null}
            {contents === undefined ? <span>Loading the full passage…</span> : null}
            {gone ? <span>This chunk has been re-ingested since — showing the saved preview.</span> : null}
            {full && passage.truncated ? <span>Trimmed to fit the context budget.</span> : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

// The expanded view. Full passage text is read from grey.chunks when it opens; the stored
// snippets fill in until then.
export function ContextPanel({ id, context, citedIndexes, onOpenSource }) {
  const { projectId } = useProject();
  const { copied, copy } = useCopy({ successMessage: null });
  const [contents, setContents] = useState(undefined);
  const passages = context.passages;
  const idsKey = passages
    .map((p) => p.chunkId)
    .filter(Boolean)
    .join(",");

  useEffect(() => {
    let alive = true;
    getChunkContents(projectId, idsKey ? idsKey.split(",") : []).then((map) => {
      if (alive) setContents(map);
    });
    return () => {
      alive = false;
    };
  }, [projectId, idsKey]);

  return (
    <div id={id} className="overflow-hidden rounded-lg border border-border bg-surface-card">
      <div className="flex h-8 items-center gap-2 border-b border-border pl-3 pr-1">
        <p className="min-w-0 flex-1 truncate text-[11px] text-text-tertiary">
          <span className="font-medium text-text-secondary">Sent to the model</span> · {contextSummary(context)}
        </p>
        <button
          type="button"
          onClick={() => copy(contextText(passages, contents))}
          disabled={!(contents instanceof Map)}
          className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] text-text-secondary transition-colors hover:bg-surface-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <ol className="divide-y divide-border">
        {passages.map((p) => (
          <PassageRow
            key={p.chunkId || p.index}
            passage={p}
            contents={contents}
            cited={citedIndexes?.has(p.index)}
            onOpenSource={onOpenSource}
          />
        ))}
      </ol>
      {contents === null ? (
        <p className="border-t border-border px-3 py-2 text-[11px] text-amber-400">
          Couldn&apos;t load the full passages — showing the saved previews.
        </p>
      ) : null}
    </div>
  );
}
