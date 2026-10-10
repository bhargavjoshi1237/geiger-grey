"use client";

import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  ClipboardPlus,
  HelpCircle,
  MessageSquareWarning,
  RotateCcw,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";

import { MainScreenWrapper } from "@/components/internal/shared/screen_wrappers";
import {
  DataTable,
  EmptyState,
  Field,
  ScreenHeader,
  SearchInput,
  SegmentedTabs,
  StatsBar,
  Toolbar,
} from "@/components/internal/shared/screen_kit";
import { ListPagination, usePagination } from "@/components/internal/shared/pagination";
import { TagInput } from "@/components/internal/shared/tag_input";
import FilterDropdown from "@/components/internal/shared/filter_dropdown";
import { LoadingArea } from "@geiger/ui";
import { Button } from "@geiger/ui/button";
import { ActionMenu } from "@geiger/ui/action-menu";
import { Badge } from "@geiger/ui/badge";
import { Textarea } from "@geiger/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@geiger/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@geiger/ui/dialog";

import { useProject } from "@/context/project-context";
import { useCan } from "@/context/rbac-context";
import { useWorkspaceUrl } from "@/lib/hooks/use-workspace-url";
import { setMessageFeedback } from "@/lib/supabase/conversations";
import { listEvalSets, createEvalSet, createEvalCase } from "@/lib/supabase/evals";

import {
  FEEDBACK_TABS,
  citationSourceIds,
  formatDateTime,
  isResolved,
  matchesFeedbackTab,
  truncate,
} from "./constants";
import { pipelineName, useFeedbackRows } from "./use_feedback_rows";

const NEW_SET_VALUE = "__new__";

export function FeedbackScreen() {
  const { projectId } = useProject();
  const canManage = useCan("grey.eval.manage");
  const { openRecordInTab } = useWorkspaceUrl();
  const { rows, setRows, pipelines, loading } = useFeedbackRows(projectId);

  const [evalSets, setEvalSets] = useState([]);
  const [tab, setTab] = useState("negative");
  const [search, setSearch] = useState("");
  const [pipelineFilter, setPipelineFilter] = useState("all");
  const [addTarget, setAddTarget] = useState(null);

  useEffect(() => {
    let alive = true;
    listEvalSets(projectId).then((sets) => {
      if (alive) setEvalSets(sets ?? []);
    });
    return () => {
      alive = false;
    };
  }, [projectId]);

  const pipelineOptions = useMemo(
    () => [
      { value: "all", label: "All pipelines" },
      ...pipelines.map((p) => ({ value: p.id, label: p.name })),
    ],
    [pipelines],
  );

  const sorted = useMemo(
    () => [...rows].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sorted.filter((m) => {
      if (!matchesFeedbackTab(m, tab)) return false;
      if (pipelineFilter !== "all" && m.pipelineId !== pipelineFilter) return false;
      if (q && !`${m.question} ${m.content}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [sorted, tab, pipelineFilter, search]);

  const pager = usePagination(filtered, { resetKey: `${tab}|${pipelineFilter}|${search}` });

  const stats = useMemo(() => {
    const up = rows.filter((m) => m.feedback === "up").length;
    const down = rows.filter((m) => m.feedback === "down").length;
    const unanswered = rows.filter((m) => m.unanswered).length;
    const total = up + down;
    const satisfaction = total ? Math.round((up / total) * 100) : null;
    return [
      { label: "Thumbs up", value: String(up) },
      { label: "Thumbs down", value: String(down) },
      { label: "Unanswered", value: String(unanswered) },
      { label: "Satisfaction", value: satisfaction === null ? "—" : `${satisfaction}%` },
    ];
  }, [rows]);

  const handleResolve = (m, resolved) => {
    const previousMetadata = m.metadata;
    const nextMetadata = { ...(m.metadata || {}), resolved };
    setRows((prev) => prev.map((r) => (r.id === m.id ? { ...r, metadata: nextMetadata } : r)));
    toast.success(resolved ? "Marked resolved." : "Reopened.");
    // setMessageFeedback resolves to the row or null — there is no separate "false" failure case.
    setMessageFeedback(m.id, { metadata: nextMetadata }).then((saved) => {
      if (!saved) {
        setRows((prev) =>
          prev.map((r) => (r.id === m.id ? { ...r, metadata: previousMetadata } : r)),
        );
        toast.error("Couldn't update on the server — reverted.");
      }
    });
  };

  const handleAdded = (savedSet) => {
    if (savedSet) setEvalSets((prev) => [savedSet, ...prev]);
  };

  const columns = [
    {
      key: "question",
      header: "Question",
      render: (m) => (
        <div className="flex min-w-0 items-start gap-2">
          <FeedbackBadge message={m} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">
              {truncate(m.question, 80)}
            </p>
            {isResolved(m) ? <Badge variant="success">Resolved</Badge> : null}
          </div>
        </div>
      ),
    },
    {
      key: "answer",
      header: "Answer",
      render: (m) => <span className="text-sm text-text-secondary">{truncate(m.content, 110)}</span>,
    },
    {
      key: "pipeline",
      header: "Pipeline",
      render: (m) => <span className="text-sm text-text-secondary">{pipelineName(pipelines, m.pipelineId)}</span>,
    },
    {
      key: "note",
      header: "Note",
      render: (m) => <span className="text-sm text-text-tertiary">{m.feedbackNote || "—"}</span>,
    },
    {
      key: "date",
      header: "Date",
      align: "right",
      className: "text-right text-text-tertiary",
      render: (m) => <span className="text-xs">{formatDateTime(m.createdAt)}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      className: "text-right",
      render: (m) => (
        <ActionMenu
          label="Feedback actions"
          items={[
            {
              label: "Open conversation",
              onSelect: () => openRecordInTab("Conversations", "conversation", m.conversationId),
            },
            canManage && {
              icon: ClipboardPlus,
              label: "Add to eval set",
              onSelect: () => setAddTarget(m),
            },
            canManage && { separator: true },
            canManage &&
              (isResolved(m)
                ? { icon: RotateCcw, label: "Reopen", onSelect: () => handleResolve(m, false) }
                : { icon: CheckCircle2, label: "Resolve", onSelect: () => handleResolve(m, true) }),
          ]}
        />
      ),
    },
  ];

  return (
    <MainScreenWrapper>
      <ScreenHeader
        title="Feedback"
        description="Thumbs up/down and unanswered questions from the Playground and your pipelines — triage, resolve, or promote to an eval set."
      />

      <StatsBar stats={stats} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SegmentedTabs tabs={FEEDBACK_TABS} value={tab} onChange={setTab} />
        <SearchInput value={search} onChange={setSearch} placeholder="Search question or answer…" />
      </div>

      <Toolbar>
        <FilterDropdown value={pipelineFilter} onValueChange={setPipelineFilter} options={pipelineOptions} />
      </Toolbar>

      {loading ? (
        <LoadingArea label="Loading feedback" />
      ) : (
        <div className="space-y-5">
          <DataTable
            columns={columns}
            data={pager.pageItems}
            getRowKey={(m) => m.id}
            empty={
              <EmptyState
                icon={MessageSquareWarning}
                title={rows.length ? "No feedback matches" : "No feedback yet"}
                description={
                  rows.length
                    ? "Try a different tab, pipeline, or search."
                    : "Thumbs up/down and unanswered questions from the Playground will show up here."
                }
              />
            }
          />
          <ListPagination {...pager} itemLabel="feedback items" />
        </div>
      )}

      <AddToEvalSetDialog
        open={!!addTarget}
        message={addTarget}
        onOpenChange={(o) => !o && setAddTarget(null)}
        projectId={projectId}
        sets={evalSets}
        onSetCreated={handleAdded}
      />
    </MainScreenWrapper>
  );
}

function FeedbackBadge({ message }) {
  if (message.feedback === "down") {
    return (
      <Badge variant="danger" className="mt-0.5">
        <ThumbsDown className="h-3 w-3" />
      </Badge>
    );
  }
  if (message.feedback === "up") {
    return (
      <Badge variant="success" className="mt-0.5">
        <ThumbsUp className="h-3 w-3" />
      </Badge>
    );
  }
  if (message.unanswered) {
    return (
      <Badge variant="warning" className="mt-0.5">
        <HelpCircle className="h-3 w-3" />
      </Badge>
    );
  }
  return null;
}

function AddToEvalSetDialog({ open, message, onOpenChange, projectId, sets, onSetCreated }) {
  const [evalSetId, setEvalSetId] = useState("");
  const [newSetName, setNewSetName] = useState("");
  const [question, setQuestion] = useState("");
  const [expectedAnswer, setExpectedAnswer] = useState("");
  const [expectedSourceIds, setExpectedSourceIds] = useState([]);
  const [busy, setBusy] = useState(false);
  const [seed, setSeed] = useState(null);

  const key = message?.id || null;
  if (open && key !== seed) {
    setSeed(key);
    setEvalSetId(sets.length ? sets[0].id : NEW_SET_VALUE);
    setNewSetName("");
    setQuestion(message?.question || "");
    setExpectedAnswer(message?.content || "");
    setExpectedSourceIds(citationSourceIds(message?.citations));
  }

  const submit = async () => {
    if (!question.trim()) {
      toast.error("Enter the question.");
      return;
    }
    if (evalSetId === NEW_SET_VALUE && !newSetName.trim()) {
      toast.error("Name the new eval set.");
      return;
    }
    setBusy(true);
    let targetSetId = evalSetId;
    if (evalSetId === NEW_SET_VALUE) {
      const savedSet = await createEvalSet(projectId, { name: newSetName.trim(), description: "" });
      if (!savedSet) {
        setBusy(false);
        toast.error("Couldn't create the eval set.");
        return;
      }
      targetSetId = savedSet.id;
      onSetCreated?.(savedSet);
    }
    const saved = await createEvalCase(projectId, {
      evalSetId: targetSetId,
      question: question.trim(),
      expectedAnswer: expectedAnswer.trim(),
      expectedSourceIds,
    });
    setBusy(false);
    if (!saved) {
      toast.error("Couldn't add the case.");
      return;
    }
    toast.success("Added to eval set.");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] max-w-lg overflow-y-auto bg-background">
        <DialogHeader>
          <DialogTitle>Add to eval set</DialogTitle>
          <DialogDescription>
            Turn this feedback into a test case. The answer prefills as a draft — edit it before
            saving.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Eval set">
            <Select value={evalSetId} onValueChange={setEvalSetId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a set" />
              </SelectTrigger>
              <SelectContent>
                {sets.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
                <SelectItem value={NEW_SET_VALUE}>+ New set…</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {evalSetId === NEW_SET_VALUE ? (
            <Field label="New set name">
              <Textarea
                rows={1}
                value={newSetName}
                onChange={(e) => setNewSetName(e.target.value)}
                placeholder="e.g. Support triage"
              />
            </Field>
          ) : null}
          <Field label="Question" htmlFor="feedback-case-question">
            <Textarea
              id="feedback-case-question"
              rows={2}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </Field>
          <Field label="Expected answer" hint="Draft from the actual answer — edit as needed.">
            <Textarea rows={4} value={expectedAnswer} onChange={(e) => setExpectedAnswer(e.target.value)} />
          </Field>
          <Field label="Expected source IDs" hint="Optional — prefilled from this answer's citations.">
            <TagInput value={expectedSourceIds} onChange={setExpectedSourceIds} placeholder="Source id…" />
          </Field>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            className="border-border bg-transparent text-muted-foreground hover:bg-surface-active hover:text-foreground"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            className="bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={submit}
            disabled={busy}
          >
            <ClipboardPlus className="h-4 w-4" /> Add case
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default FeedbackScreen;
