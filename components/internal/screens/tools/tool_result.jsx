"use client";

import React, { useMemo } from "react";
import { AlertTriangle, CircleCheck, Info, SearchX } from "lucide-react";

import { Badge } from "@geiger/ui/badge";
import { Button } from "@geiger/ui/button";
import { Progress } from "@geiger/ui/progress";
import { Popover, PopoverContent, PopoverTrigger } from "@geiger/ui/popover";
import { cn } from "@/lib/utils";
import { formatLatency } from "@/lib/grey/format";
import { citationLocation } from "@/lib/grey/playground";
import { CitationChip, useOpenSource } from "@/components/internal/screens/playground/chat_kit";
import { Markdown } from "@/components/internal/screens/playground/markdown";
import { SOURCE_KIND_ICONS } from "@/components/internal/screens/sources/constants";
import { DECIDED_BY_LABELS, UNCERTAIN_REASONS, formatPercent, warningMessage } from "./constants";

const NOTICE_TONES = {
  warning: "border-amber-500/20 bg-amber-500/10 text-amber-400",
  danger: "border-red-500/20 bg-red-500/10 text-red-400",
  neutral: "border-border bg-surface-card text-text-secondary",
};

// Inline notice, styled like the Playground's reply notices. Shared by the Tools screens.
export function Notice({ tone = "warning", children, action, className }) {
  const Icon = tone === "neutral" ? Info : AlertTriangle;
  return (
    <div
      className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-5", NOTICE_TONES[tone], className)}
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function SectionLabel({ children, className }) {
  return (
    <p className={cn("text-[11px] font-medium uppercase tracking-wider text-text-secondary", className)}>{children}</p>
  );
}

// A stored item's preview: the signed thumbnail, or its kind icon over a few lines of its text.
export function ItemThumb({ item, className }) {
  const Icon = SOURCE_KIND_ICONS[item.sourceKind] || SOURCE_KIND_ICONS.document;
  if (item.thumbnailUrl) {
    return (
      <img
        src={item.thumbnailUrl}
        alt={item.sourceName || "Stored item"}
        loading="lazy"
        className={cn("h-full w-full object-cover", className)}
      />
    );
  }
  return (
    <div className={cn("flex h-full w-full flex-col gap-2 p-3 text-left", className)}>
      <Icon className="h-4 w-4 shrink-0 text-text-tertiary" />
      {item.snippet ? (
        <p className="line-clamp-4 text-[11px] leading-4 text-text-secondary">{item.snippet}</p>
      ) : null}
    </div>
  );
}

function LabelBadges({ labels, max = 3 }) {
  if (!labels?.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {labels.slice(0, max).map((label) => (
        <Badge key={label} variant="neutral" className="max-w-full truncate">
          {label}
        </Badge>
      ))}
      {labels.length > max ? <span className="text-[11px] text-text-tertiary">+{labels.length - max}</span> : null}
    </div>
  );
}

function SimilarCard({ item, onOpen }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      aria-label={`Open ${item.sourceName || "this item"} in Sources`}
      className="group flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-surface-subtle text-left transition-colors hover:border-border-strong hover:bg-surface-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden border-b border-border bg-surface-card">
        <ItemThumb item={item} />
        <span className="absolute left-2 top-2 flex h-5 min-w-5 items-center justify-center rounded bg-surface-dialog/90 px-1 text-[10px] font-semibold tabular-nums text-foreground shadow-sm">
          {item.index}
        </span>
        {item.nearDuplicate ? (
          <Badge variant="warning" className="absolute right-2 top-2 bg-surface-dialog/90">
            Near duplicate
          </Badge>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-3">
        <div className="flex min-w-0 items-baseline justify-between gap-2">
          <p className="truncate text-sm font-medium text-foreground">{item.sourceName || "Untitled item"}</p>
          <span className="shrink-0 text-xs tabular-nums text-text-secondary">{formatPercent(item.score)}</span>
        </div>
        <LabelBadges labels={item.labels} />
      </div>
    </button>
  );
}

function SimilarGrid({ items, compact, onOpen }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <SectionLabel>Similar items</SectionLabel>
        {items.length ? (
          <span className="text-xs text-text-tertiary">
            {items.length} {items.length === 1 ? "item" : "items"} · score is similarity
          </span>
        ) : null}
      </div>
      {items.length ? (
        <div className={cn("grid gap-3", compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3 xl:grid-cols-4")}>
          {items.map((item) => (
            <SimilarCard key={item.chunkId || `${item.sourceId}-${item.index}`} item={item} onOpen={onOpen} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-surface-subtle px-6 py-8 text-center">
          <SearchX className="h-5 w-5 text-text-tertiary" />
          <p className="text-sm text-text-secondary">No stored items are similar enough.</p>
          <p className="text-xs text-text-tertiary">Lower the minimum similarity in Configure, or add more items.</p>
        </div>
      )}
    </section>
  );
}

function ClassificationCard({ classification }) {
  const { label, confidence, decidedBy, uncertain, reason, votes = [], evidenceIndexes = [] } = classification;
  const total = votes.reduce((sum, v) => sum + (Number(v.weight) || 0), 0);
  const decided = !uncertain && label;

  return (
    <section className="space-y-4 rounded-xl border border-border bg-surface-subtle p-5">
      <div className="space-y-1">
        <SectionLabel>Label</SectionLabel>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span
            className={cn(
              "break-words text-2xl font-semibold tracking-tight",
              decided ? "text-foreground" : "text-text-secondary",
            )}
          >
            {decided ? label : "Uncertain"}
          </span>
          {decided && DECIDED_BY_LABELS[decidedBy] ? (
            <Badge variant={decidedBy === "llm" ? "purple" : "info"}>
              <CircleCheck />
              {DECIDED_BY_LABELS[decidedBy]}
            </Badge>
          ) : null}
        </div>
        {!decided ? (
          <p className="text-xs text-text-secondary">
            {UNCERTAIN_REASONS[reason] || "Neither the vote nor the model could settle on a label."}
          </p>
        ) : evidenceIndexes.length ? (
          <p className="text-xs text-text-tertiary">
            Backed by item{evidenceIndexes.length === 1 ? "" : "s"} {evidenceIndexes.join(", ")}.
          </p>
        ) : null}
      </div>

      {decided ? (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-text-secondary">Confidence</span>
            <span className="font-medium tabular-nums text-foreground">{formatPercent(confidence)}</span>
          </div>
          <Progress value={Math.round((Number(confidence) || 0) * 100)} aria-label="Confidence" className="h-1.5" />
        </div>
      ) : null}

      {votes.length ? (
        <div className="space-y-2">
          <SectionLabel>Votes</SectionLabel>
          <ul className="space-y-2">
            {votes.map((vote) => {
              const share = total > 0 ? vote.weight / total : 0;
              return (
                <li key={vote.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
                  <span className="truncate text-sm text-foreground">{vote.label}</span>
                  <span className="text-xs tabular-nums text-text-secondary">
                    {formatPercent(share)} · {vote.count} {vote.count === 1 ? "item" : "items"}
                  </span>
                  <Progress
                    value={Math.round(share * 100)}
                    aria-label={`${vote.label} vote share`}
                    className="col-span-2 h-1 bg-surface-hover [&>[data-slot=progress-indicator]]:bg-text-secondary"
                  />
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

// Popover body for an inline [n] marker: the similar item it points at.
function ItemPreview({ item, onOpen }) {
  const location = citationLocation(item);
  return (
    <div className="space-y-2.5">
      <div className="flex items-start gap-3">
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md border border-border bg-surface-card">
          <ItemThumb item={{ ...item, snippet: null }} />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{item.sourceName || "Untitled item"}</p>
          <p className="text-[11px] text-text-tertiary">
            {formatPercent(item.score)} similar{location ? ` · ${location}` : ""}
          </p>
        </div>
      </div>
      {item.snippet ? (
        <p className="scrollbar-subtle max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-surface-subtle px-2.5 py-2 text-xs leading-5 text-text-secondary">
          {item.snippet}
        </p>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        className="w-full border-border bg-transparent text-muted-foreground hover:bg-surface-active hover:text-foreground"
        onClick={() => onOpen(item)}
      >
        Open source
      </Button>
    </div>
  );
}

function CiteMarker({ n, item, onOpen }) {
  if (!item) return <span className="text-text-tertiary">[{n}]</span>;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Item ${n}: ${item.sourceName || "Untitled item"}`}
          className="mx-0.5 inline-flex h-[18px] min-w-[18px] -translate-y-px items-center justify-center rounded-[5px] border border-border bg-surface-card px-1 align-middle text-[10px] font-semibold tabular-nums text-text-secondary transition-colors hover:border-border-strong hover:text-foreground"
        >
          {n}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <ItemPreview item={item} onOpen={onOpen} />
      </PopoverContent>
    </Popover>
  );
}

function AnswerCard({ answer, similarByIndex, onOpen }) {
  const citations = (answer.citations || [])
    .map((c) => {
      const item = similarByIndex.get(c.index);
      return {
        index: c.index,
        sourceId: c.sourceId,
        title: c.sourceName || item?.sourceName,
        snippet: item?.snippet,
        page: item?.page,
        startMs: item?.startMs,
      };
    })
    .sort((a, b) => a.index - b.index);

  return (
    <section className="space-y-3 rounded-xl border border-border bg-surface-subtle p-5">
      <SectionLabel>Answer</SectionLabel>
      {answer.abstained ? (
        <p className="text-sm text-text-secondary">{answer.text || "No answer was generated."}</p>
      ) : (
        <Markdown
          text={answer.text}
          renderCite={(n, key) => <CiteMarker key={key} n={n} item={similarByIndex.get(n)} onOpen={onOpen} />}
        />
      )}
      {citations.length ? (
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="mr-0.5 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Sources</span>
          {citations.map((c) => (
            <CitationChip key={c.index} citation={c} onOpenSource={onOpen} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function RunMeta({ result }) {
  const usage = result.usage || {};
  const parts = [];
  if (result.timings?.totalMs !== undefined) parts.push(formatLatency(result.timings.totalMs));
  if (usage.llmCalls) parts.push(`${usage.llmCalls} model call${usage.llmCalls === 1 ? "" : "s"}${usage.model ? ` · ${usage.model}` : ""}`);
  else if (result.template !== "find_similar") parts.push("No model call");
  if (!parts.length) return null;
  return <p className="text-[11px] tabular-nums text-text-tertiary">{parts.join(" · ")}</p>;
}

/**
 * A tool run's result: warnings, the classification or answer, then the similar items.
 * `onOpenSource(item)` opens an item in Sources (defaults to the Playground's citation hand-off).
 */
export function ToolResultView({ result, onOpenSource, compact = false }) {
  const openSource = useOpenSource();
  const onOpen = onOpenSource || openSource;
  const similar = useMemo(() => result?.similar || [], [result]);
  const similarByIndex = useMemo(() => new Map(similar.map((item) => [item.index, item])), [similar]);

  if (!result) return null;
  const warnings = result.warnings || [];

  return (
    <div className={cn("space-y-4", compact && "space-y-3")}>
      <RunMeta result={result} />
      {warnings.length ? (
        <div className="space-y-2">
          {warnings.map((w, i) => (
            <Notice key={`${w.code}-${i}`}>{warningMessage(w)}</Notice>
          ))}
        </div>
      ) : null}
      {result.classification ? <ClassificationCard classification={result.classification} /> : null}
      {result.answer ? <AnswerCard answer={result.answer} similarByIndex={similarByIndex} onOpen={onOpen} /> : null}
      <SimilarGrid items={similar} compact={compact} onOpen={onOpen} />
    </div>
  );
}

export default ToolResultView;
