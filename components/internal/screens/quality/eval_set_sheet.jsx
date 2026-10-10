"use client";

import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { ClipboardList, MessageSquareQuote, Pencil, Plus, Trash2 } from "lucide-react";

import {
  DataTable,
  EmptyState,
  Field,
} from "@/components/internal/shared/screen_kit";
import { TagInput } from "@/components/internal/shared/tag_input";
import { LoadingArea } from "@geiger/ui";
import { Button } from "@geiger/ui/button";
import { ActionMenu } from "@geiger/ui/action-menu";
import { Textarea } from "@geiger/ui/textarea";
import { Badge } from "@geiger/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@geiger/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@geiger/ui/dialog";

import {
  listEvalCases,
  createEvalCase,
  updateEvalCase,
  deleteEvalCase,
} from "@/lib/supabase/evals";

import { truncate, citationSourceIds, formatDate } from "./constants";
import { useFeedbackRows, pipelineName } from "./use_feedback_rows";

const emptyCaseDraft = () => ({ question: "", expectedAnswer: "", expectedSourceIds: [] });

// Detail sheet for one eval set: its cases, add/edit/delete, and pulling a
// case straight out of negative/unanswered feedback.
export function EvalSetSheet({ evalSet, open, onOpenChange, projectId, canManage }) {
  const [cases, setCases] = useState([]);
  const [loadedSetId, setLoadedSetId] = useState(null);
  const loading = !evalSet?.id || loadedSetId !== evalSet.id;
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingCase, setEditingCase] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [fromFeedbackOpen, setFromFeedbackOpen] = useState(false);

  useEffect(() => {
    if (!open || !evalSet?.id) return;
    let alive = true;
    listEvalCases(projectId, evalSet.id).then((rows) => {
      if (!alive) return;
      setCases(rows ?? []);
      setLoadedSetId(evalSet.id);
    });
    return () => {
      alive = false;
    };
  }, [open, evalSet?.id, projectId]);

  const openCreate = () => {
    setEditingCase(emptyCaseDraft());
    setEditorOpen(true);
  };
  const openEdit = (c) => {
    setEditingCase({ ...c });
    setEditorOpen(true);
  };
  const openFromFeedback = (draft) => {
    setEditingCase(draft);
    setEditorOpen(true);
    setFromFeedbackOpen(false);
  };

  const handleSaveCase = (draft) => {
    const clean = {
      question: draft.question.trim(),
      expectedAnswer: draft.expectedAnswer?.trim() || "",
      expectedSourceIds: draft.expectedSourceIds || [],
    };
    if (draft.id) {
      const previous = cases.find((c) => c.id === draft.id);
      setCases((prev) => prev.map((c) => (c.id === draft.id ? { ...c, ...clean } : c)));
      toast.success("Case updated.");
      // updateEvalCase resolves to the row or null — there is no separate "false" failure case.
      updateEvalCase(draft.id, clean).then((saved) => {
        if (!saved) {
          if (previous) setCases((prev) => prev.map((c) => (c.id === draft.id ? previous : c)));
          toast.error("Couldn't save the case — reverted.");
        }
      });
    } else {
      const optimistic = {
        id: crypto.randomUUID(),
        evalSetId: evalSet.id,
        createdAt: new Date().toISOString(),
        ...clean,
      };
      setCases((prev) => [optimistic, ...prev]);
      toast.success("Case added.");
      createEvalCase(projectId, { evalSetId: evalSet.id, ...clean }).then((saved) => {
        if (!saved) {
          setCases((prev) => prev.filter((c) => c.id !== optimistic.id));
          toast.error("Couldn't add the case — removed.");
          return;
        }
        setCases((prev) => prev.map((c) => (c.id === optimistic.id ? saved : c)));
      });
    }
    setEditorOpen(false);
    setEditingCase(null);
  };

  const handleDelete = (c) => {
    const index = cases.findIndex((row) => row.id === c.id);
    setCases((prev) => prev.filter((row) => row.id !== c.id));
    toast.success("Case removed.");
    deleteEvalCase(c.id).then((ok) => {
      if (!ok) {
        setCases((prev) => {
          const next = [...prev];
          next.splice(index, 0, c);
          return next;
        });
        toast.error("Couldn't delete on the server — restored.");
      }
    });
  };

  const columns = [
    {
      key: "question",
      header: "Question",
      render: (c) => <span className="text-sm text-foreground">{truncate(c.question, 90)}</span>,
    },
    {
      key: "answer",
      header: "Expected answer",
      render: (c) => (
        <span className="text-sm text-text-secondary">{truncate(c.expectedAnswer, 90)}</span>
      ),
    },
    {
      key: "sources",
      header: "Sources",
      render: (c) =>
        c.expectedSourceIds?.length ? (
          <Badge variant="neutral">{c.expectedSourceIds.length}</Badge>
        ) : (
          <span className="text-xs text-text-tertiary">—</span>
        ),
    },
    {
      key: "created",
      header: "Created",
      align: "right",
      className: "text-right text-text-tertiary",
      render: (c) => <span className="text-xs">{formatDate(c.createdAt)}</span>,
    },
    canManage && {
      key: "actions",
      header: "",
      align: "right",
      className: "text-right",
      render: (c) => (
        <ActionMenu
          label="Case actions"
          items={[
            { icon: Pencil, label: "Edit case", onSelect: () => openEdit(c) },
            { separator: true },
            {
              icon: Trash2,
              label: "Delete",
              variant: "destructive",
              onSelect: () => setDeleteTarget(c),
            },
          ]}
        />
      ),
    },
  ].filter(Boolean);

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-2xl">
          <SheetHeader className="border-b border-border">
            <SheetTitle>{evalSet?.name}</SheetTitle>
            <SheetDescription>
              {evalSet?.description || "No description."} · {cases.length}{" "}
              {cases.length === 1 ? "case" : "cases"}
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-4 p-4">
            {canManage ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={openCreate}
                >
                  <Plus className="h-4 w-4" /> Add case
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-border bg-transparent text-muted-foreground hover:bg-surface-active hover:text-foreground"
                  onClick={() => setFromFeedbackOpen(true)}
                >
                  <MessageSquareQuote className="h-4 w-4" /> Add from feedback
                </Button>
              </div>
            ) : null}

            {loading ? (
              <LoadingArea label="Loading cases" />
            ) : (
              <DataTable
                columns={columns}
                data={cases}
                getRowKey={(c) => c.id}
                empty={
                  <EmptyState
                    icon={ClipboardList}
                    title="No cases yet"
                    description="Add a question-and-answer pair, or pull one from negative feedback."
                  />
                }
              />
            )}
          </div>
        </SheetContent>
      </Sheet>

      <CaseEditorDialog
        open={editorOpen}
        editing={editingCase}
        onOpenChange={(o) => {
          setEditorOpen(o);
          if (!o) setEditingCase(null);
        }}
        onSave={handleSaveCase}
      />

      <FromFeedbackDialog
        open={fromFeedbackOpen}
        onOpenChange={setFromFeedbackOpen}
        projectId={projectId}
        onPick={openFromFeedback}
      />

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete case</DialogTitle>
            <DialogDescription>
              Remove this case from &ldquo;{evalSet?.name}&rdquo;? This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                handleDelete(deleteTarget);
                setDeleteTarget(null);
              }}
            >
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CaseEditorDialog({ open, onOpenChange, editing, onSave }) {
  const [draft, setDraft] = useState(null);
  const [seed, setSeed] = useState(null);

  const editingKey = editing ? editing.id || "new" : null;
  if (open && editingKey !== seed) {
    setSeed(editingKey);
    setDraft(editing || emptyCaseDraft());
  }

  if (!draft) return null;

  const set = (key) => (value) => setDraft((d) => ({ ...d, [key]: value }));

  const submit = () => {
    if (!draft.question?.trim()) {
      toast.error("Enter the question.");
      return;
    }
    onSave(draft);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-background">
        <DialogHeader>
          <DialogTitle>{draft.id ? "Edit case" : "Add case"}</DialogTitle>
          <DialogDescription>
            A question-and-answer pair this set is scored against.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Question" htmlFor="case-question">
            <Textarea
              id="case-question"
              rows={2}
              value={draft.question}
              onChange={(e) => set("question")(e.target.value)}
              placeholder="What the eval asks the pipeline"
            />
          </Field>
          <Field label="Expected answer" hint="Optional — a reference answer to compare against.">
            <Textarea
              rows={4}
              value={draft.expectedAnswer || ""}
              onChange={(e) => set("expectedAnswer")(e.target.value)}
              placeholder="Reference answer…"
            />
          </Field>
          <Field
            label="Expected source IDs"
            hint="Optional — source ids the answer should cite. Enter or comma to add."
          >
            <TagInput
              value={draft.expectedSourceIds || []}
              onChange={set("expectedSourceIds")}
              placeholder="Source id…"
            />
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
          >
            {draft.id ? "Save case" : "Add case"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FromFeedbackDialog({ open, onOpenChange, projectId, onPick }) {
  const { rows, pipelines, loading } = useFeedbackRows(open ? projectId : null);

  const candidates = rows.filter(
    (m) => !m.metadata?.resolved && (m.feedback === "down" || m.unanswered),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] max-w-2xl overflow-y-auto bg-background">
        <DialogHeader>
          <DialogTitle>Add from feedback</DialogTitle>
          <DialogDescription>
            Pull a case from negative or unanswered feedback — the question and answer prefill,
            and you can edit before saving.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <LoadingArea label="Loading feedback" />
        ) : candidates.length ? (
          <div className="space-y-2">
            {candidates.map((m) => (
              <div
                key={m.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface-card p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {truncate(m.question, 80)}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-text-secondary">
                    {truncate(m.content, 100)}
                  </p>
                  <p className="mt-1 text-[11px] text-text-tertiary">
                    {pipelineName(pipelines, m.pipelineId)}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 border-border bg-transparent text-muted-foreground hover:bg-surface-active hover:text-foreground"
                  onClick={() =>
                    onPick({
                      question: m.question,
                      expectedAnswer: m.content,
                      expectedSourceIds: citationSourceIds(m.citations),
                    })
                  }
                >
                  Use
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={MessageSquareQuote}
            title="No open feedback"
            description="Negative or unanswered feedback that isn't resolved yet will show up here."
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

export default EvalSetSheet;
