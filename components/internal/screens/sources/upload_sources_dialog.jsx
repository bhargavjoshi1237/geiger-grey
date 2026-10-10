"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  FileStack,
  Globe,
  Loader2,
  Package,
  StickyNote,
  Upload,
  X,
} from "lucide-react";

import { Button } from "@geiger/ui/button";
import { Input } from "@geiger/ui/input";
import { Checkbox } from "@geiger/ui/checkbox";
import { Progress } from "@geiger/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@geiger/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@geiger/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@geiger/ui";
import { Field, EmptyState } from "@/components/internal/shared/screen_kit";
import { Dropzone } from "@/components/internal/shared/dropzone";
import { listKnowledgeBases } from "@/lib/supabase/knowledge_bases";
import { listPresets } from "@/lib/supabase/ingestion_presets";
import { createSource, updateSource, uploadSourceFile } from "@/lib/supabase/sources";
import { createJobs } from "@/lib/supabase/ingestion_jobs";
import { listImportableAssets, listImportableNotes } from "@/lib/supabase/suite_imports";
import { analyzeFile } from "@/lib/grey/file_analysis";
import { estimateFileCost, estimateTotal } from "@/lib/grey/cost";
import { formatBytes, formatCurrency, formatDuration } from "@/lib/grey/format";
import { SOURCE_KIND_ICONS, SOURCE_KIND_LABELS, buildQueuedJob } from "./constants";

function kindFromMime(mime) {
  if (!mime) return "document";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "document";
}

function estimateLabel(estimate, tier) {
  if (!estimate) return "—";
  if (tier === "auto" && estimate.low !== estimate.high) {
    return `${formatCurrency(estimate.low, { precise: true })} – ${formatCurrency(estimate.high, { precise: true })}`;
  }
  return formatCurrency(estimate.high, { precise: true });
}

function fileAnalysisShape(analysis) {
  return {
    kind: analysis.kind,
    pageCount: analysis.pageCount,
    durationMs: analysis.durationMs,
    tokenCount: analysis.tokenCount,
  };
}

// Upload / Import / Add URL — the one dialog that queues new sources for
// ingestion from every entry point (standalone Sources screen and the KB
// detail's embedded SourcesTable).
export function UploadSourcesDialog({ open, onOpenChange, projectId, defaultKbId, onUploaded }) {
  const [tab, setTab] = useState("upload");
  const [kbs, setKbs] = useState([]);
  const [presets, setPresets] = useState([]);
  const [kbId, setKbId] = useState(defaultKbId || "");
  const [presetId, setPresetId] = useState("");
  const [files, setFiles] = useState([]);
  // `null` means "not fetched yet for this open session" — used to drive the
  // import tab's loading state without a synchronous setState in an effect.
  const [importAssets, setImportAssets] = useState(null);
  const [importNotes, setImportNotes] = useState(null);
  const [selectedImport, setSelectedImport] = useState(() => new Set());
  const [urlValue, setUrlValue] = useState("");
  const [busy, setBusy] = useState(false);

  // Reset the dialog's local state the moment `open` flips — adjusting state
  // during render (React's documented way to reset on a prop change) instead
  // of a setState call inside an effect.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setTab("upload");
      setFiles([]);
      setUrlValue("");
      setSelectedImport(new Set());
      setKbId(defaultKbId || "");
      setImportAssets(null);
      setImportNotes(null);
    }
  }

  const importLoading = tab === "import" && (importAssets === null || importNotes === null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    Promise.all([listKnowledgeBases(projectId), listPresets(projectId)]).then(
      ([kbRows, presetRows]) => {
        if (!alive) return;
        setKbs(kbRows ?? []);
        setPresets(presetRows ?? []);
        setPresetId((prev) => {
          if (prev) return prev;
          const balanced = (presetRows ?? []).find((p) => p.tier === "balanced");
          return balanced?.id || presetRows?.[0]?.id || "";
        });
      },
    );
    return () => {
      alive = false;
    };
  }, [open, projectId]);

  useEffect(() => {
    if (!open || tab !== "import" || (importAssets !== null && importNotes !== null)) return;
    let alive = true;
    Promise.all([listImportableAssets(projectId), listImportableNotes(projectId)]).then(
      ([assets, notes]) => {
        if (!alive) return;
        setImportAssets(assets ?? []);
        setImportNotes(notes ?? []);
      },
    );
    return () => {
      alive = false;
    };
  }, [open, tab, projectId, importAssets, importNotes]);

  const preset = useMemo(() => presets.find((p) => p.id === presetId) || null, [presets, presetId]);

  const addFiles = (incoming) => {
    const list = Array.from(incoming || []);
    if (!list.length) return;
    const entries = list.map((file) => ({
      id: crypto.randomUUID(),
      file,
      analysis: null,
      analysisError: false,
      progress: 0,
    }));
    setFiles((prev) => [...prev, ...entries]);
    entries.forEach(async (entry) => {
      try {
        const analysis = await analyzeFile(entry.file);
        setFiles((prev) => prev.map((f) => (f.id === entry.id ? { ...f, analysis } : f)));
      } catch (error) {
        console.error("[upload_sources_dialog.addFiles]", error);
        setFiles((prev) => prev.map((f) => (f.id === entry.id ? { ...f, analysisError: true } : f)));
      }
    });
  };

  const removeFile = (id) => setFiles((prev) => prev.filter((f) => f.id !== id));

  const totalEstimate = useMemo(() => {
    const ready = files.filter((f) => f.analysis).map((f) => fileAnalysisShape(f.analysis));
    if (!ready.length || !preset) return null;
    return estimateTotal(ready, preset);
  }, [files, preset]);

  const startUpload = async () => {
    if (!kbId) {
      toast.error("Choose a knowledge base first.");
      return;
    }
    if (!preset) {
      toast.error("Choose an ingestion preset first.");
      return;
    }
    const ready = files.filter((f) => f.analysis);
    if (!ready.length) {
      toast.error("Add at least one file.");
      return;
    }
    setBusy(true);
    try {
      let queued = 0;
      let failed = 0;
      for (const entry of ready) {
        const id = crypto.randomUUID();
        const storagePath = await uploadSourceFile({
          projectId,
          kbId,
          sourceId: id,
          file: entry.file,
          onProgress: (pct) => setFiles((prev) => prev.map((f) => (f.id === entry.id ? { ...f, progress: pct } : f))),
        });
        if (!storagePath) {
          toast.error(`Couldn't upload ${entry.file.name}.`);
          failed += 1;
          continue;
        }
        const estimate = estimateFileCost(fileAnalysisShape(entry.analysis), preset);
        const estimatedCost = Number(((estimate.low + estimate.high) / 2).toFixed(6));
        const created = await createSource(projectId, {
          id,
          kbId,
          name: entry.file.name,
          kind: entry.analysis.kind,
          origin: "upload",
          mime: entry.analysis.mime,
          bytes: entry.analysis.bytes,
          pageCount: entry.analysis.pageCount,
          durationMs: entry.analysis.durationMs,
          tokenCount: entry.analysis.tokenCount,
          storagePath,
          status: "queued",
        });
        if (!created) {
          toast.error(`Couldn't save ${entry.file.name}.`);
          failed += 1;
          continue;
        }
        const jobs = await createJobs(projectId, [
          buildQueuedJob({ kbId, sourceId: id, preset, estimatedCost }),
        ]);
        if (!jobs?.length) {
          toast.error(`${entry.file.name} was saved but ingestion couldn't be queued.`);
          await updateSource(id, { status: "failed" });
          failed += 1;
          continue;
        }
        queued += 1;
      }
      if (queued) {
        toast.success(
          failed
            ? `${queued} source${queued === 1 ? "" : "s"} queued, ${failed} failed.`
            : `${queued} source${queued === 1 ? "" : "s"} queued for ingestion.`,
        );
        onUploaded?.();
      } else {
        toast.error("No sources were queued.");
      }
    } finally {
      setBusy(false);
    }
  };

  const toggleImportSelection = (key) => {
    setSelectedImport((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const startImport = async () => {
    if (!kbId) {
      toast.error("Choose a knowledge base first.");
      return;
    }
    const items = [
      ...(importAssets || [])
        .filter((a) => selectedImport.has(`asset:${a.id}`))
        .map((a) => ({ ...a, origin: "assets" })),
      ...(importNotes || [])
        .filter((n) => selectedImport.has(`note:${n.id}`))
        .map((n) => ({ ...n, origin: "notes" })),
    ];
    if (!items.length) {
      toast.error("Select at least one item to import.");
      return;
    }
    setBusy(true);
    try {
      let queued = 0;
      let failed = 0;
      for (const item of items) {
        const id = crypto.randomUUID();
        const created = await createSource(projectId, {
          id,
          kbId,
          name: item.name || item.title || "Untitled",
          kind: kindFromMime(item.mime),
          origin: item.origin,
          originRef: item.id,
          mime: item.mime || null,
          bytes: item.bytes || null,
          status: "queued",
        });
        if (!created) {
          failed += 1;
          continue;
        }
        const jobs = await createJobs(projectId, [
          buildQueuedJob({ kbId, sourceId: id, preset, estimatedCost: null }),
        ]);
        if (!jobs?.length) {
          await updateSource(id, { status: "failed" });
          failed += 1;
          continue;
        }
        queued += 1;
      }
      if (queued) {
        toast.success(
          failed
            ? `${queued} imported, ${failed} failed.`
            : `${queued} item${queued === 1 ? "" : "s"} imported.`,
        );
        setSelectedImport(new Set());
        onUploaded?.();
      } else {
        toast.error("Nothing was imported.");
      }
    } finally {
      setBusy(false);
    }
  };

  const startAddUrl = async () => {
    const value = urlValue.trim();
    if (!value) {
      toast.error("Enter a URL.");
      return;
    }
    if (!kbId) {
      toast.error("Choose a knowledge base first.");
      return;
    }
    let name = value;
    try {
      const parsed = new URL(value);
      name = `${parsed.hostname}${parsed.pathname}`.replace(/\/$/, "") || parsed.hostname;
    } catch {
      // Keep the raw string as the name when it isn't a parseable URL.
    }
    setBusy(true);
    try {
      const id = crypto.randomUUID();
      const created = await createSource(projectId, {
        id,
        kbId,
        name,
        kind: "web",
        origin: "url",
        originRef: value,
        status: "queued",
      });
      if (!created) {
        toast.error("Couldn't add the URL.");
        return;
      }
      const jobs = await createJobs(projectId, [
        buildQueuedJob({ kbId, sourceId: id, preset, estimatedCost: null }),
      ]);
      if (!jobs?.length) {
        toast.error("The URL was saved but ingestion couldn't be queued.");
        await updateSource(id, { status: "failed" });
        return;
      }
      toast.success("URL queued for ingestion.");
      setUrlValue("");
      onUploaded?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add sources</DialogTitle>
          <DialogDescription>
            Upload files, import from the suite, or add a URL — each queues ingestion once
            started.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Knowledge base">
            <Select value={kbId} onValueChange={setKbId} disabled={!!defaultKbId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a knowledge base" />
              </SelectTrigger>
              <SelectContent>
                {kbs.map((kb) => (
                  <SelectItem key={kb.id} value={kb.id}>
                    {kb.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Ingestion preset">
            <Select value={presetId} onValueChange={setPresetId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a preset" />
              </SelectTrigger>
              <SelectContent>
                {presets.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} {p.isSystem ? "" : "(custom)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1">
          <TabsList className="w-full">
            <TabsTrigger value="upload" className="flex-1">
              <Upload className="h-4 w-4" /> Upload
            </TabsTrigger>
            <TabsTrigger value="import" className="flex-1">
              <Package className="h-4 w-4" /> Import
            </TabsTrigger>
            <TabsTrigger value="url" className="flex-1">
              <Globe className="h-4 w-4" /> Add URL
            </TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="scrollbar-subtle mt-3 max-h-[46vh] space-y-3 overflow-y-auto">
            <Dropzone
              onFiles={addFiles}
              hint="PDF, images, audio, video, text, or office documents."
            />

            {files.length ? (
              <div className="space-y-2">
                {files.map((entry) => {
                  const Icon = entry.analysis
                    ? SOURCE_KIND_ICONS[entry.analysis.kind] || FileStack
                    : entry.analysisError
                      ? AlertTriangle
                      : Loader2;
                  const estimate = entry.analysis && preset ? estimateFileCost(fileAnalysisShape(entry.analysis), preset) : null;
                  return (
                    <div
                      key={entry.id}
                      className="flex items-center gap-3 rounded-lg border border-border bg-surface-card px-3 py-2"
                    >
                      <Icon
                        className={`h-4 w-4 shrink-0 ${entry.analysisError ? "text-destructive-text" : "text-text-secondary"} ${
                          !entry.analysis && !entry.analysisError ? "animate-spin" : ""
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{entry.file.name}</p>
                        <p className="text-xs text-text-tertiary">
                          {formatBytes(entry.file.size)}
                          {entry.analysis
                            ? ` · ${SOURCE_KIND_LABELS[entry.analysis.kind] || entry.analysis.kind}${
                                entry.analysis.pageCount
                                  ? ` · ${entry.analysis.pageCount} pages`
                                  : entry.analysis.durationMs
                                    ? ` · ${formatDuration(entry.analysis.durationMs)}`
                                    : ""
                              }`
                            : entry.analysisError
                              ? " · Couldn't analyze"
                              : " · Analyzing…"}
                        </p>
                        {entry.progress > 0 && entry.progress < 100 ? (
                          <Progress value={entry.progress} className="mt-1.5 h-1" />
                        ) : null}
                      </div>
                      <span className="shrink-0 text-xs font-medium text-foreground tabular-nums">
                        {estimate ? estimateLabel(estimate, preset?.tier) : "—"}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${entry.file.name}`}
                        onClick={() => removeFile(entry.id)}
                        className="text-text-secondary hover:bg-surface-active hover:text-foreground"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {totalEstimate ? (
              <div className="flex items-center justify-between rounded-lg border border-border bg-surface-card px-3 py-2.5 text-sm">
                <span className="text-text-secondary">Estimated ingestion cost</span>
                <span className="font-semibold text-foreground">
                  {estimateLabel(totalEstimate, preset?.tier)}
                </span>
              </div>
            ) : null}
          </TabsContent>

          <TabsContent value="import" className="scrollbar-subtle mt-3 max-h-[46vh] space-y-4 overflow-y-auto">
            {importLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-text-secondary">
                <Loader2 className="h-4 w-4 animate-spin" /> Looking for importable items…
              </div>
            ) : (
              <>
                <ImportSection
                  icon={Package}
                  title="Assets"
                  items={importAssets ?? []}
                  prefix="asset"
                  selected={selectedImport}
                  onToggle={toggleImportSelection}
                  emptyLabel="No importable assets found."
                />
                <ImportSection
                  icon={StickyNote}
                  title="Notes"
                  items={importNotes ?? []}
                  prefix="note"
                  selected={selectedImport}
                  onToggle={toggleImportSelection}
                  emptyLabel="No importable notes found."
                />
              </>
            )}
          </TabsContent>

          <TabsContent value="url" className="mt-3 space-y-3">
            <Field label="URL" hint="The page will be fetched and ingested once the backend is connected.">
              <Input
                value={urlValue}
                onChange={(e) => setUrlValue(e.target.value)}
                placeholder="https://example.com/article"
              />
            </Field>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {tab === "upload" ? (
            <Button
              disabled={busy || !files.some((f) => f.analysis)}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={startUpload}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Start ingestion
            </Button>
          ) : null}
          {tab === "import" ? (
            <Button
              disabled={busy || selectedImport.size === 0}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={startImport}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}
              Import selected
            </Button>
          ) : null}
          {tab === "url" ? (
            <Button
              disabled={busy || !urlValue.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={startAddUrl}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
              Add URL
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportSection({ icon: Icon, title, items, prefix, selected, onToggle, emptyLabel }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-text-secondary">
        {title}
      </p>
      {items.length ? (
        <div className="divide-y divide-border rounded-lg border border-border bg-surface-card">
          {items.map((item) => {
            const key = `${prefix}:${item.id}`;
            return (
              <label
                key={key}
                className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-surface-hover"
              >
                <Checkbox checked={selected.has(key)} onCheckedChange={() => onToggle(key)} />
                <Icon className="h-4 w-4 shrink-0 text-text-secondary" />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {item.name || item.title || "Untitled"}
                </span>
                {item.bytes ? (
                  <span className="shrink-0 text-xs text-text-tertiary">{formatBytes(item.bytes)}</span>
                ) : null}
              </label>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={Icon} title={emptyLabel} className="rounded-lg border border-border bg-surface-card py-8" />
      )}
    </div>
  );
}

export default UploadSourcesDialog;
