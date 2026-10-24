"use client";

import React, { useMemo, useState } from "react";
import { FlaskConical, Loader2, Play } from "lucide-react";

import { Badge } from "@geiger/ui/badge";
import { Button } from "@geiger/ui/button";
import { Checkbox } from "@geiger/ui/checkbox";
import { DataTable, SectionCard, StatGrid } from "@/components/internal/shared/screen_kit";
import { useOpenSource } from "@/components/internal/screens/playground/chat_kit";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/grey/format";
import { normalizeToolSpec } from "@/lib/grey/tool_spec";
import { runToolTestsRequest } from "@/lib/supabase/tools";
import { formatPercent, runErrorMessage, testSkippedMessage } from "./constants";
import { Notice } from "./tool_result";

const UNCERTAIN = "uncertain";

function ItemLink({ sample, onOpen }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen({ sourceId: sample.sourceId });
      }}
      className="max-w-[16rem] truncate text-left text-sm font-medium text-foreground underline-offset-2 hover:underline"
    >
      {sample.sourceName || "Untitled item"}
    </button>
  );
}

function Labels({ labels }) {
  if (!labels?.length) return <span className="text-xs text-text-tertiary">—</span>;
  return (
    <div className="flex max-w-xs flex-wrap gap-1">
      {labels.map((label) => (
        <Badge key={label} variant="neutral">
          {label}
        </Badge>
      ))}
    </div>
  );
}

// Rows: the label an item really has; columns: what the tool said ("Uncertain" last).
function ConfusionTable({ report, labels }) {
  const confusion = report.confusion || {};
  const rows = [...new Set([...labels, ...Object.keys(confusion)])].filter((label) => confusion[label]);
  const predicted = [
    ...new Set([...labels, ...Object.values(confusion).flatMap((row) => Object.keys(row))].filter((l) => l !== UNCERTAIN)),
  ];
  const columns = [
    {
      key: "expected",
      header: "Labelled as",
      render: (label) => <span className="font-medium text-foreground">{label}</span>,
    },
    ...[...predicted, UNCERTAIN].map((column) => ({
      key: `p-${column}`,
      header: column === UNCERTAIN ? "Uncertain" : column,
      align: "right",
      render: (label) => {
        const n = confusion[label]?.[column] || 0;
        return (
          <span
            className={cn(
              "text-xs tabular-nums",
              !n ? "text-text-tertiary" : column === label ? "font-semibold text-emerald-400" : "text-foreground",
            )}
          >
            {n}
          </span>
        );
      },
    })),
  ];
  return (
    <SectionCard title="Confusion" description="How the items with each label were classified. Correct answers are highlighted.">
      <DataTable columns={columns} data={rows} getRowKey={(label) => label} />
    </SectionCard>
  );
}

function PerLabelTable({ report }) {
  const columns = [
    { key: "label", header: "Label", render: (row) => <span className="font-medium text-foreground">{row.label}</span> },
    { key: "support", header: "Items", align: "right", render: (row) => <span className="text-xs tabular-nums">{row.support}</span> },
    { key: "precision", header: "Precision", align: "right", render: (row) => <span className="text-xs tabular-nums">{formatPercent(row.precision)}</span> },
    { key: "recall", header: "Recall", align: "right", render: (row) => <span className="text-xs tabular-nums">{formatPercent(row.recall)}</span> },
  ];
  return (
    <SectionCard title="Per label" description="Precision: how often the label was right when chosen. Recall: how many items with it were found.">
      <DataTable columns={columns} data={report.perLabel || []} getRowKey={(row) => row.label} />
    </SectionCard>
  );
}

function SamplesTable({ kind, samples, onOpen }) {
  const columns =
    kind === "classification"
      ? [
          { key: "item", header: "Item", render: (s) => <ItemLink sample={s} onOpen={onOpen} /> },
          { key: "expected", header: "Labelled as", render: (s) => <Labels labels={s.expected} /> },
          {
            key: "predicted",
            header: "Tool said",
            render: (s) =>
              s.predicted ? (
                <Badge variant={s.expected?.some((l) => l.toLowerCase() === s.predicted.toLowerCase()) ? "success" : "danger"}>
                  {s.predicted}
                </Badge>
              ) : (
                <span className="text-xs text-text-tertiary">Uncertain</span>
              ),
          },
          {
            key: "confidence",
            header: "Confidence",
            align: "right",
            render: (s) => <span className="text-xs tabular-nums">{formatPercent(s.confidence)}</span>,
          },
          {
            key: "decidedBy",
            header: "Decided by",
            render: (s) => (
              <span className="text-xs text-text-secondary">
                {s.decidedBy === "knn" ? "Nearest examples" : s.decidedBy === "llm" ? "Model" : "—"}
              </span>
            ),
          },
        ]
      : [
          { key: "item", header: "Item", render: (s) => <ItemLink sample={s} onOpen={onOpen} /> },
          { key: "expected", header: "Its labels", render: (s) => <Labels labels={s.expected} /> },
          {
            key: "rank",
            header: "First match",
            render: (s) =>
              s.hitRank ? (
                <span className="text-xs text-foreground">
                  #{s.hitRank} · {s.predicted}
                </span>
              ) : (
                <Badge variant="danger">Miss</Badge>
              ),
          },
          {
            key: "score",
            header: "Similarity",
            align: "right",
            render: (s) => <span className="text-xs tabular-nums">{formatPercent(s.confidence)}</span>,
          },
        ];
  return (
    <SectionCard title="Items tested" description="Each item was held out and run against the others.">
      <DataTable columns={columns} data={samples} getRowKey={(s) => s.sourceId} />
    </SectionCard>
  );
}

function ReportView({ testReport, labels, onOpen }) {
  const { kind, report, samples = [], skippedReason, ranAt, llmCalls, cases } = testReport;
  const meta = [
    ranAt ? `Last run ${formatRelative(ranAt)}` : null,
    cases ? `${cases} item${cases === 1 ? "" : "s"}` : null,
    llmCalls ? `${llmCalls} model call${llmCalls === 1 ? "" : "s"}` : null,
  ].filter(Boolean);

  return (
    <div className="space-y-5">
      {meta.length ? <p className="text-xs text-text-tertiary">{meta.join(" · ")}</p> : null}
      {skippedReason ? <Notice tone="neutral">{testSkippedMessage(skippedReason)}</Notice> : null}
      {!skippedReason && report && kind === "classification" ? (
        <>
          <StatGrid
            columns={3}
            stats={[
              { label: "Accuracy", value: formatPercent(report.accuracy), hint: "Correct, out of every item tested" },
              { label: "Coverage", value: formatPercent(report.coverage), hint: "Items it settled on a label for" },
              { label: "Correct", value: `${report.correct ?? 0} / ${report.total ?? 0}`, hint: "Items labelled right" },
            ]}
          />
          <ConfusionTable report={report} labels={labels} />
          <PerLabelTable report={report} />
        </>
      ) : null}
      {!skippedReason && report && kind === "retrieval" ? (
        <StatGrid
          columns={3}
          stats={[
            { label: "Hit rate", value: formatPercent(report.hitAtK), hint: "Items with a same-label match in the results" },
            { label: "MRR", value: report.mrr === null || report.mrr === undefined ? "—" : Number(report.mrr).toFixed(2), hint: "1.00 means the first result always matched" },
            { label: "Items tested", value: String(report.total ?? cases ?? 0) },
          ]}
        />
      ) : null}
      {!skippedReason && samples.length > 0 && (kind === "classification" || kind === "retrieval") ? (
        <SamplesTable kind={kind} samples={samples} onOpen={onOpen} />
      ) : null}
    </div>
  );
}

/**
 * Leave-one-out tests over the labelled items in the tool's scope. Shows the saved report
 * (tool.testReport) and runs new ones; `onReport(report)` hands a fresh one back.
 */
export function ToolTests({ tool, projectId, canManage, dirty = false, onReport }) {
  const openSource = useOpenSource();
  const spec = useMemo(() => normalizeToolSpec(tool.spec), [tool.spec]);
  const [running, setRunning] = useState(false);
  const [includeLlm, setIncludeLlm] = useState(false);
  const [error, setError] = useState(null);

  const noTests = spec.template === "answer_similar";
  const llmPossible = spec.template === "classify" && spec.classify?.mode !== "knn";
  const labels = spec.classify?.labels.map((l) => l.value) || [];
  const testReport = tool.testReport;

  const run = async () => {
    setRunning(true);
    setError(null);
    const { data, error: code, message } = await runToolTestsRequest({
      projectId,
      toolId: tool.id,
      includeLlm: llmPossible && includeLlm,
    });
    setRunning(false);
    if (code || !data?.report) {
      setError(runErrorMessage(code, message));
      return;
    }
    onReport?.(data.report);
  };

  return (
    <div className="space-y-5">
      <SectionCard
        title="Leave-one-out test"
        description={
          spec.template === "classify"
            ? "Each labelled item is held out in turn and classified from the others. Uses stored vectors, so no embedding calls."
            : "Each labelled item is held out in turn; a hit is a result that shares one of its labels. Uses stored vectors, so no embedding calls."
        }
        action={
          canManage && !noTests ? (
            <Button
              size="sm"
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={run}
              disabled={running}
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {running ? "Running…" : "Run tests"}
            </Button>
          ) : null
        }
      >
        <div className="space-y-3">
          {noTests ? (
            <Notice tone="neutral">{testSkippedMessage("no_automatic_tests")}</Notice>
          ) : (
            <p className="text-sm text-text-secondary">
              Tests use the labels you give items in Sources. Up to 25 items are tested, spread across the labels.
            </p>
          )}
          {llmPossible && canManage ? (
            <label className="flex items-center gap-2 text-sm text-foreground">
              <Checkbox checked={includeLlm} disabled={running} onCheckedChange={(v) => setIncludeLlm(v === true)} />
              Include model fallback (uses your model)
            </label>
          ) : null}
          {llmPossible && includeLlm ? (
            <p className="text-xs text-text-tertiary">At most 10 items are sent to the model; the rest use the vote alone.</p>
          ) : null}
          {dirty && !noTests ? <Notice>Tests run on the saved draft — save your changes first to include them.</Notice> : null}
          {error ? <Notice tone="danger">{error}</Notice> : null}
        </div>
      </SectionCard>

      {testReport ? (
        <ReportView testReport={testReport} labels={labels} onOpen={openSource} />
      ) : !noTests ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-10 text-center">
          <FlaskConical className="h-5 w-5 text-text-tertiary" />
          <p className="text-sm text-text-secondary">No test run yet.</p>
          <p className="text-xs text-text-tertiary">
            {canManage ? "Run tests to see how often the tool gets your labelled items right." : "Someone who can build tools can run them."}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export default ToolTests;
