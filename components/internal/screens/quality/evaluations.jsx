"use client";

import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FlaskConical, Info, Pencil, Play, Plus, Trash2 } from "lucide-react";

import { MainScreenWrapper } from "@/components/internal/shared/screen_wrappers";
import {
  DataTable,
  EmptyState,
  Field,
  ScreenHeader,
  SearchInput,
  SegmentedTabs,
  StatusPill,
  Toolbar,
} from "@/components/internal/shared/screen_kit";
import { ListPagination, usePagination } from "@/components/internal/shared/pagination";
import FilterDropdown from "@/components/internal/shared/filter_dropdown";
import { LoadingArea } from "@geiger/ui";
import { Button } from "@geiger/ui/button";
import { ActionMenu } from "@geiger/ui/action-menu";
import { Input } from "@geiger/ui/input";
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
import {
  listEvalSets,
  createEvalSet,
  updateEvalSet,
  deleteEvalSet,
  listEvalCases,
  listEvalRuns,
  createEvalRun,
} from "@/lib/supabase/evals";
import { listPipelines } from "@/lib/supabase/pipelines";

import {
  EVAL_RUN_STATUS_FILTER_OPTIONS,
  EVAL_RUN_STATUS_MAP,
  EVAL_TABS,
  formatDate,
  formatMetric,
} from "./constants";
import { EvalSetSheet } from "./eval_set_sheet";

export function EvaluationsScreen() {
  const { projectId } = useProject();
  const canManage = useCan("grey.eval.manage");

  const [tab, setTab] = useState("sets");
  const [sets, setSets] = useState([]);
  const [caseCounts, setCaseCounts] = useState({});
  const [runs, setRuns] = useState([]);
  const [pipelines, setPipelines] = useState([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingSet, setEditingSet] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [openSetId, setOpenSetId] = useState(null);
  const [runDialogOpen, setRunDialogOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([listEvalSets(projectId), listEvalRuns(projectId), listPipelines(projectId)]).then(
      async ([setRows, runRows, pipelineRows]) => {
        if (!alive) return;
        const resolvedSets = setRows ?? [];
        setSets(resolvedSets);
        setRuns(runRows ?? []);
        setPipelines(pipelineRows ?? []);
        const counts = await Promise.all(
          resolvedSets.map((s) => listEvalCases(projectId, s.id).then((rows) => [s.id, rows?.length ?? 0])),
        );
        if (!alive) return;
        setCaseCounts(Object.fromEntries(counts));
        setLoading(false);
      },
    );
    return () => {
      alive = false;
    };
  }, [projectId]);

  const pipelineNameById = useMemo(
    () => Object.fromEntries(pipelines.map((p) => [p.id, p.name])),
    [pipelines],
  );
  const setNameById = useMemo(() => Object.fromEntries(sets.map((s) => [s.id, s.name])), [sets]);
  const pipelineName = (id) => pipelineNameById[id] || "—";
  const setName = (id) => setNameById[id] || "—";

  const filteredSets = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sets;
    return sets.filter(
      (s) => (s.name || "").toLowerCase().includes(q) || (s.description || "").toLowerCase().includes(q),
    );
  }, [sets, search]);

  const filteredRuns = useMemo(() => {
    const q = search.trim().toLowerCase();
    return runs.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (
        q &&
        !`${setNameById[r.evalSetId] || ""} ${pipelineNameById[r.pipelineId] || ""}`
          .toLowerCase()
          .includes(q)
      )
        return false;
      return true;
    });
  }, [runs, search, statusFilter, setNameById, pipelineNameById]);

  const setsPager = usePagination(filteredSets, { resetKey: search });
  const runsPager = usePagination(filteredRuns, { resetKey: `${search}|${statusFilter}` });

  const openCreateSet = () => {
    setEditingSet({ name: "", description: "" });
    setEditorOpen(true);
  };
  const openEditSet = (s) => {
    setEditingSet({ ...s });
    setEditorOpen(true);
  };

  const handleSaveSet = (draft) => {
    const clean = {
      name: draft.name.trim() || "Untitled set",
      description: draft.description?.trim() || "",
    };
    if (draft.id) {
      const previous = sets.find((s) => s.id === draft.id);
      setSets((prev) => prev.map((s) => (s.id === draft.id ? { ...s, ...clean } : s)));
      toast.success("Eval set updated.");
      // updateEvalSet resolves to the row or null — there is no separate "false" failure case.
      updateEvalSet(draft.id, clean).then((saved) => {
        if (!saved) {
          if (previous) setSets((prev) => prev.map((s) => (s.id === draft.id ? previous : s)));
          toast.error("Couldn't save the eval set — reverted.");
        }
      });
    } else {
      const optimistic = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...clean };
      setSets((prev) => [optimistic, ...prev]);
      setCaseCounts((prev) => ({ ...prev, [optimistic.id]: 0 }));
      toast.success("Eval set created.");
      createEvalSet(projectId, clean).then((saved) => {
        if (!saved) {
          setSets((prev) => prev.filter((s) => s.id !== optimistic.id));
          setCaseCounts((prev) => {
            const next = { ...prev };
            delete next[optimistic.id];
            return next;
          });
          toast.error("Couldn't create the eval set — removed.");
          return;
        }
        setSets((prev) => prev.map((s) => (s.id === optimistic.id ? saved : s)));
        setCaseCounts((prev) => {
          const next = { ...prev };
          delete next[optimistic.id];
          next[saved.id] = 0;
          return next;
        });
      });
    }
    setEditorOpen(false);
    setEditingSet(null);
  };

  const handleDeleteSet = (s) => {
    const index = sets.findIndex((row) => row.id === s.id);
    setSets((prev) => prev.filter((row) => row.id !== s.id));
    toast.success("Eval set deleted.");
    deleteEvalSet(s.id).then((ok) => {
      if (!ok) {
        setSets((prev) => {
          const next = [...prev];
          next.splice(index, 0, s);
          return next;
        });
        toast.error("Couldn't delete on the server — restored.");
      }
    });
  };

  const handleCreateRun = ({ evalSetId, pipelineId }) => {
    const pipeline = pipelines.find((p) => p.id === pipelineId);
    const input = {
      evalSetId,
      pipelineId,
      pipelineVersion: pipeline?.currentVersion ?? 1,
      status: "queued",
    };
    const optimistic = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), metrics: null, ...input };
    setRuns((prev) => [optimistic, ...prev]);
    toast.success("Evaluation queued — it runs once the backend is connected.");
    // createEvalRun resolves to the row or null — there is no separate "false" failure case.
    createEvalRun(projectId, input).then((saved) => {
      if (!saved) {
        setRuns((prev) => prev.filter((r) => r.id !== optimistic.id));
        toast.error("Couldn't queue the run — removed.");
        return;
      }
      setRuns((prev) => prev.map((r) => (r.id === optimistic.id ? saved : r)));
    });
    setRunDialogOpen(false);
  };

  const openSet = useMemo(() => sets.find((s) => s.id === openSetId) || null, [openSetId, sets]);

  const setColumns = [
    {
      key: "name",
      header: "Name",
      render: (s) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{s.name}</p>
          {s.description ? (
            <p className="truncate text-xs text-text-secondary">{s.description}</p>
          ) : null}
        </div>
      ),
    },
    {
      key: "cases",
      header: "Cases",
      align: "right",
      className: "text-right",
      render: (s) => (
        <span className="tabular-nums text-sm text-foreground">{caseCounts[s.id] ?? 0}</span>
      ),
    },
    {
      key: "created",
      header: "Created",
      align: "right",
      className: "text-right text-text-tertiary",
      render: (s) => <span className="text-xs">{formatDate(s.createdAt)}</span>,
    },
    canManage && {
      key: "actions",
      header: "",
      align: "right",
      className: "text-right",
      render: (s) => (
        <ActionMenu
          label={`Actions for ${s.name}`}
          items={[
            { icon: Pencil, label: "Edit set", onSelect: () => openEditSet(s) },
            { separator: true },
            {
              icon: Trash2,
              label: "Delete",
              variant: "destructive",
              onSelect: () => setDeleteTarget(s),
            },
          ]}
        />
      ),
    },
  ].filter(Boolean);

  const runColumns = [
    { key: "set", header: "Set", render: (r) => <span className="text-sm text-foreground">{setName(r.evalSetId)}</span> },
    {
      key: "pipeline",
      header: "Pipeline",
      render: (r) => (
        <span className="text-sm text-text-secondary">
          {pipelineName(r.pipelineId)} · v{r.pipelineVersion}
        </span>
      ),
    },
    { key: "status", header: "Status", render: (r) => <StatusPill status={r.status} map={EVAL_RUN_STATUS_MAP} /> },
    { key: "faithfulness", header: "Faithfulness", align: "right", className: "text-right", render: (r) => <span className="text-xs tabular-nums">{formatMetric(r.metrics?.faithfulness)}</span> },
    { key: "relevance", header: "Relevance", align: "right", className: "text-right", render: (r) => <span className="text-xs tabular-nums">{formatMetric(r.metrics?.answerRelevance)}</span> },
    { key: "precision", header: "Precision", align: "right", className: "text-right", render: (r) => <span className="text-xs tabular-nums">{formatMetric(r.metrics?.contextPrecision)}</span> },
    { key: "recall", header: "Recall", align: "right", className: "text-right", render: (r) => <span className="text-xs tabular-nums">{formatMetric(r.metrics?.contextRecall)}</span> },
    {
      key: "created",
      header: "Created",
      align: "right",
      className: "text-right text-text-tertiary",
      render: (r) => <span className="text-xs">{formatDate(r.createdAt)}</span>,
    },
  ];

  return (
    <MainScreenWrapper>
      <ScreenHeader
        title="Evaluations"
        description="Score your pipelines against question-and-answer sets — faithfulness, answer relevance, and retrieval precision/recall."
        actions={
          canManage ? (
            tab === "sets" ? (
              <Button className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={openCreateSet}>
                <Plus className="h-4 w-4" /> New set
              </Button>
            ) : (
              <Button
                className="bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={() => setRunDialogOpen(true)}
                disabled={!sets.length || !pipelines.length}
              >
                <Play className="h-4 w-4" /> Run evaluation
              </Button>
            )
          ) : null
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SegmentedTabs tabs={EVAL_TABS} value={tab} onChange={setTab} />
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={tab === "sets" ? "Search sets…" : "Search set or pipeline…"}
        />
      </div>

      {tab === "runs" ? (
        <div className="flex items-start gap-2 rounded-xl border border-border bg-surface-subtle px-4 py-3 text-sm text-text-secondary">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-text-tertiary" />
          Runs execute when the backend is connected — new runs stay queued until then.
        </div>
      ) : null}

      {tab === "runs" ? (
        <Toolbar>
          <FilterDropdown value={statusFilter} onValueChange={setStatusFilter} options={EVAL_RUN_STATUS_FILTER_OPTIONS} />
        </Toolbar>
      ) : null}

      {loading ? (
        <LoadingArea label="Loading evaluations" />
      ) : tab === "sets" ? (
        <div className="space-y-5">
          <DataTable
            columns={setColumns}
            data={setsPager.pageItems}
            getRowKey={(s) => s.id}
            onRowClick={(s) => setOpenSetId(s.id)}
            empty={
              <EmptyState
                icon={FlaskConical}
                title={sets.length ? "No sets match your search" : "No eval sets yet"}
                description={
                  sets.length
                    ? "Try a different search."
                    : "Create a set of question-and-answer cases to score your pipelines against."
                }
                action={
                  !sets.length && canManage ? (
                    <Button className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={openCreateSet}>
                      <Plus className="h-4 w-4" /> New set
                    </Button>
                  ) : null
                }
              />
            }
          />
          <ListPagination {...setsPager} itemLabel="sets" />
        </div>
      ) : (
        <div className="space-y-5">
          <DataTable
            columns={runColumns}
            data={runsPager.pageItems}
            getRowKey={(r) => r.id}
            empty={
              <EmptyState
                icon={Play}
                title={runs.length ? "No runs match your filters" : "No runs yet"}
                description={
                  runs.length
                    ? "Try a different search or status."
                    : "Run an eval set against a pipeline to see scores here."
                }
              />
            }
          />
          <ListPagination {...runsPager} itemLabel="runs" />
        </div>
      )}

      <SetEditorDialog
        open={editorOpen}
        editing={editingSet}
        onOpenChange={(o) => {
          setEditorOpen(o);
          if (!o) setEditingSet(null);
        }}
        onSave={handleSaveSet}
      />

      <RunEvaluationDialog
        open={runDialogOpen}
        onOpenChange={setRunDialogOpen}
        sets={sets}
        pipelines={pipelines}
        onCreate={handleCreateRun}
      />

      <EvalSetSheet
        evalSet={openSet}
        open={!!openSet}
        onOpenChange={(o) => !o && setOpenSetId(null)}
        projectId={projectId}
        canManage={canManage}
      />

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete eval set</DialogTitle>
            <DialogDescription>
              Delete <span className="font-medium text-foreground">{deleteTarget?.name}</span> and its
              cases? This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                handleDeleteSet(deleteTarget);
                setDeleteTarget(null);
              }}
            >
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainScreenWrapper>
  );
}

function SetEditorDialog({ open, onOpenChange, editing, onSave }) {
  const [draft, setDraft] = useState(null);
  const [seed, setSeed] = useState(null);

  const editingKey = editing ? editing.id || "new" : null;
  if (open && editingKey !== seed) {
    setSeed(editingKey);
    setDraft(editing || { name: "", description: "" });
  }

  if (!draft) return null;

  const set = (key) => (value) => setDraft((d) => ({ ...d, [key]: value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-background">
        <DialogHeader>
          <DialogTitle>{draft.id ? "Edit eval set" : "New eval set"}</DialogTitle>
          <DialogDescription>A named group of question-and-answer cases.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Name" htmlFor="eval-set-name">
            <Input
              id="eval-set-name"
              value={draft.name}
              onChange={(e) => set("name")(e.target.value)}
              placeholder="e.g. Pricing FAQs"
            />
          </Field>
          <Field label="Description" hint="Optional">
            <Textarea
              rows={2}
              value={draft.description || ""}
              onChange={(e) => set("description")(e.target.value)}
              placeholder="What this set covers…"
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
            onClick={() => {
              if (!draft.name.trim()) {
                toast.error("Enter a name.");
                return;
              }
              onSave(draft);
            }}
          >
            {draft.id ? "Save set" : "Create set"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RunEvaluationDialog({ open, onOpenChange, sets, pipelines, onCreate }) {
  const [evalSetId, setEvalSetId] = useState("");
  const [pipelineId, setPipelineId] = useState("");
  const [seeded, setSeeded] = useState(false);

  // Render-time reset on open, mirroring CaseEditorDialog/SetEditorDialog's seed pattern —
  // resets the selects once per open, not synchronously inside an effect.
  if (open && !seeded) {
    setSeeded(true);
    setEvalSetId(sets[0]?.id || "");
    setPipelineId(pipelines[0]?.id || "");
  } else if (!open && seeded) {
    setSeeded(false);
  }

  const submit = () => {
    if (!evalSetId || !pipelineId) {
      toast.error("Choose an eval set and a pipeline.");
      return;
    }
    onCreate({ evalSetId, pipelineId });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-background">
        <DialogHeader>
          <DialogTitle>Run evaluation</DialogTitle>
          <DialogDescription>
            Queues a run against the pipeline&apos;s current published version. Runs execute when
            the backend is connected.
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
              </SelectContent>
            </Select>
          </Field>
          <Field label="Pipeline">
            <Select value={pipelineId} onValueChange={setPipelineId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a pipeline" />
              </SelectTrigger>
              <SelectContent>
                {pipelines.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} (v{p.currentVersion ?? 1})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
          <Button className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={submit}>
            <Play className="h-4 w-4" /> Queue run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default EvaluationsScreen;
