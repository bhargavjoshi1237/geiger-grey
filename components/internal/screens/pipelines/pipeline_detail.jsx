"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Cpu,
  Database,
  FileText,
  History,
  Link2,
  Loader2,
  Megaphone,
  Trash2,
  TriangleAlert,
} from "lucide-react";

import { LoadingArea } from "@geiger/ui";
import { EditorShell } from "@/components/internal/shared/editor_shell";
import { SectionCard, SegmentedTabs, SettingRow, Field } from "@/components/internal/shared/screen_kit";
import { CopyBlock } from "@/components/internal/shared/copy_block";
import { Button } from "@geiger/ui/button";
import { Input } from "@geiger/ui/input";
import { Textarea } from "@geiger/ui/textarea";
import { Checkbox } from "@geiger/ui/checkbox";
import { Slider } from "@geiger/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@geiger/ui/tabs";
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
import { useCan } from "@/context/rbac-context";
import { useWorkspaceUrl } from "@/lib/hooks/use-workspace-url";
import { formatRelative } from "@/lib/grey/format";
import { BASE_PATH } from "@/lib/base_path";
import { GREY_HOSTED_PROVIDER } from "@/lib/supabase/model_providers";
import { listPipelineVersions, publishPipeline, updatePipeline } from "@/lib/supabase/pipelines";
import { GRAPH_MODE_TABS, PIPELINE_STATUS_MAP } from "./constants";

const TABS = [
  { key: "model", label: "Model", icon: Cpu, desc: "Choose the provider and model this pipeline calls." },
  {
    key: "retrieval",
    label: "Retrieval",
    icon: Database,
    desc: "Knowledge bases and how chunks are retrieved for each query.",
  },
  { key: "prompt", label: "Prompt", icon: FileText, desc: "The system prompt every response is grounded with." },
  { key: "versions", label: "Versions", icon: History, desc: "Published snapshots of this pipeline's configuration." },
  {
    key: "endpoints",
    label: "Endpoints",
    icon: Link2,
    desc: "Call this pipeline from your own app, or wire it into an MCP client.",
  },
  { key: "danger", label: "Danger zone", icon: TriangleAlert, desc: "Irreversible actions.", ownHeader: true },
];

function ModelSection({ form, patch, providers, canManage }) {
  const options = useMemo(() => [GREY_HOSTED_PROVIDER, ...providers], [providers]);
  const selected = options.find((p) => p.id === form.providerId) || null;

  return (
    <SectionCard title="Model" description="The provider and model that generates every answer.">
      <div className="grid gap-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Provider">
            <Select
              value={form.providerId || ""}
              onValueChange={(value) => {
                const next = options.find((p) => p.id === value);
                patch({ providerId: value, model: next?.models?.[0] || "" });
              }}
              disabled={!canManage}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent>
                {options.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Model">
            <Select value={form.model || ""} onValueChange={(v) => patch({ model: v })} disabled={!canManage}>
              <SelectTrigger>
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent>
                {(selected?.models || []).map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <Field label={`Temperature — ${Number(form.temperature ?? 0.3).toFixed(1)}`}>
          <Slider
            value={[Number(form.temperature ?? 0.3)]}
            min={0}
            max={2}
            step={0.1}
            disabled={!canManage}
            onValueChange={([v]) => patch({ temperature: v })}
          />
        </Field>

        <Field label="Max tokens" htmlFor="pipeline-max-tokens">
          <Input
            id="pipeline-max-tokens"
            type="number"
            min={1}
            value={form.maxTokens ?? 1024}
            disabled={!canManage}
            onChange={(e) => patch({ maxTokens: Number(e.target.value) || 0 })}
          />
        </Field>
      </div>
    </SectionCard>
  );
}

function RetrievalSection({ form, patch, knowledgeBases, canManage }) {
  const retrieval = form.retrieval || {};
  const patchRetrieval = (partial) => patch({ retrieval: { ...retrieval, ...partial } });
  const kbIds = form.kbIds || [];

  const toggleKb = (id, checked) => {
    patch({ kbIds: checked ? [...kbIds, id] : kbIds.filter((x) => x !== id) });
  };

  return (
    <div className="space-y-5">
      <SectionCard title="Knowledge bases" description="Sources this pipeline retrieves chunks from.">
        <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
          {knowledgeBases.length ? (
            knowledgeBases.map((kb) => (
              <label
                key={kb.id}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-subtle"
              >
                <Checkbox
                  checked={kbIds.includes(kb.id)}
                  disabled={!canManage}
                  onCheckedChange={(checked) => toggleKb(kb.id, Boolean(checked))}
                />
                <span className="text-sm text-foreground">{kb.name}</span>
              </label>
            ))
          ) : (
            <p className="px-2 py-1.5 text-sm text-text-tertiary">No knowledge bases yet.</p>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Retrieval" description="How chunks are found and ranked for each query.">
        <div className="grid gap-1">
          <Field label="Top K" stepper value={retrieval.topK ?? 6} min={1} max={50} onValueChange={(v) => patchRetrieval({ topK: Number(v) || 1 })}>
            <Input
              type="number"
              value={retrieval.topK ?? 6}
              disabled={!canManage}
              onChange={(e) => patchRetrieval({ topK: Number(e.target.value) || 1 })}
            />
          </Field>

          <SettingRow
            title="Rerank"
            description="Re-score retrieved chunks before they reach the prompt."
            checked={!!retrieval.rerank}
            onCheckedChange={(v) => patchRetrieval({ rerank: v })}
            control={canManage ? undefined : <span className="text-xs text-text-tertiary">{retrieval.rerank ? "On" : "Off"}</span>}
          />
          <SettingRow
            title="Hybrid search"
            description="Combine vector similarity with keyword matching."
            checked={!!retrieval.hybrid}
            onCheckedChange={(v) => patchRetrieval({ hybrid: v })}
            control={canManage ? undefined : <span className="text-xs text-text-tertiary">{retrieval.hybrid ? "On" : "Off"}</span>}
          />
          <SettingRow
            title="Citations"
            description="Attach source citations to every answer."
            checked={!!retrieval.citations}
            onCheckedChange={(v) => patchRetrieval({ citations: v })}
            control={canManage ? undefined : <span className="text-xs text-text-tertiary">{retrieval.citations ? "On" : "Off"}</span>}
          />
        </div>

        <div className="mt-5 grid gap-5">
          <Field label={`Similarity threshold — ${Number(retrieval.threshold ?? 0.2).toFixed(2)}`}>
            <Slider
              value={[Number(retrieval.threshold ?? 0.2)]}
              min={0}
              max={1}
              step={0.05}
              disabled={!canManage}
              onValueChange={([v]) => patchRetrieval({ threshold: v })}
            />
          </Field>

          <Field label="Graph mode" hint="When the knowledge graph is consulted alongside chunk retrieval.">
            <SegmentedTabs
              tabs={GRAPH_MODE_TABS}
              value={retrieval.graphMode || "auto"}
              onChange={(v) => canManage && patchRetrieval({ graphMode: v })}
            />
          </Field>
        </div>
      </SectionCard>
    </div>
  );
}

function PromptSection({ form, patch, canManage }) {
  return (
    <SectionCard title="System prompt" description="Every response is grounded with this instruction.">
      <Textarea
        value={form.systemPrompt || ""}
        disabled={!canManage}
        onChange={(e) => patch({ systemPrompt: e.target.value })}
        placeholder="You are a helpful assistant answering from the project's knowledge bases…"
        rows={12}
        className="font-mono text-sm"
      />
      <p className="mt-2 text-xs text-text-tertiary">
        Use <code className="rounded bg-surface-card px-1 py-0.5">{"{{context}}"}</code> and{" "}
        <code className="rounded bg-surface-card px-1 py-0.5">{"{{question}}"}</code> to place retrieved
        context and the user&apos;s question.
      </p>
    </SectionCard>
  );
}

function PublishDialog({ open, onOpenChange, onPublish, publishing }) {
  const [note, setNote] = useState("");
  const [seededFor, setSeededFor] = useState(false);

  if (open !== seededFor) {
    setSeededFor(open);
    if (open) setNote("");
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-background">
        <DialogHeader>
          <DialogTitle>Publish pipeline</DialogTitle>
          <DialogDescription>
            This snapshots the current configuration as a new version and makes it live.
          </DialogDescription>
        </DialogHeader>
        <Field label="Release note (optional)" htmlFor="publish-note">
          <Textarea
            id="publish-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What changed in this version…"
            rows={3}
          />
        </Field>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={() => onPublish(note.trim())}
            disabled={publishing}
          >
            {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}
            Publish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VersionsSection({ pipeline, projectId, canPublish, onPublished }) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [loadedFor, setLoadedFor] = useState(null);

  if (pipeline.id !== loadedFor) {
    setLoadedFor(pipeline.id);
    setLoading(true);
  }

  useEffect(() => {
    let alive = true;
    listPipelineVersions(projectId, pipeline.id).then((rows) => {
      if (alive) {
        setVersions(rows || []);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, [projectId, pipeline.id]);

  const handlePublish = async (note) => {
    setPublishing(true);
    const updated = await publishPipeline(pipeline, note);
    setPublishing(false);
    if (!updated) {
      toast.error("Couldn't publish this pipeline.");
      return;
    }
    setPublishOpen(false);
    onPublished(updated);
    toast.success(`Published as v${updated.currentVersion}.`);
    listPipelineVersions(projectId, pipeline.id).then((rows) => setVersions(rows || []));
  };

  return (
    <SectionCard
      title="Versions"
      description="Every snapshot taken when this pipeline was published."
      action={
        canPublish ? (
          <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => setPublishOpen(true)}>
            <Megaphone className="h-4 w-4" /> Publish
          </Button>
        ) : null
      }
    >
      {loading ? (
        <LoadingArea label="Loading versions" />
      ) : versions.length ? (
        <div className="divide-y divide-border">
          {versions.map((v) => (
            <div key={v.id} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Version {v.version}</p>
                {v.note ? <p className="text-xs text-text-secondary">{v.note}</p> : null}
              </div>
              <span className="shrink-0 text-xs text-text-tertiary">
                {v.createdAt ? formatRelative(v.createdAt) : ""}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-text-tertiary">No versions published yet.</p>
      )}

      <PublishDialog open={publishOpen} onOpenChange={setPublishOpen} onPublish={handlePublish} publishing={publishing} />
    </SectionCard>
  );
}

// This section only ever renders after the client has taken over (selecting a
// pipeline requires data that doesn't exist in the static shell), so reading
// window directly here never risks a hydration mismatch.
function EndpointsSection({ pipeline }) {
  const base = typeof window !== "undefined" ? `${window.location.origin}${BASE_PATH}` : "";
  const chatCompletions = base ? `${base}/api/v1/pipelines/${pipeline.id}/chat/completions` : "";
  const retrieve = base ? `${base}/api/v1/pipelines/${pipeline.id}/retrieve` : "";
  const mcp = base ? `${base}/api/mcp/${pipeline.id}` : "";

  const curlSnippet = `curl -X POST "${chatCompletions}" \\\n  -H "Authorization: Bearer <api-key>" \\\n  -H "Content-Type: application/json" \\\n  -d '{"messages":[{"role":"user","content":"Hello"}]}'`;
  const jsSnippet = `const res = await fetch("${chatCompletions}", {\n  method: "POST",\n  headers: {\n    Authorization: \`Bearer \${apiKey}\`,\n    "Content-Type": "application/json",\n  },\n  body: JSON.stringify({ messages: [{ role: "user", content: "Hello" }] }),\n});`;

  return (
    <div className="space-y-5">
      <SectionCard title="Serving endpoints" description="OpenAI-compatible chat and a raw retrieve endpoint.">
        <div className="grid gap-4">
          <Field label="Chat completions">
            <CopyBlock value={chatCompletions} />
          </Field>
          <Field label="Retrieve">
            <CopyBlock value={retrieve} />
          </Field>
          <Field label="MCP">
            <CopyBlock value={mcp} />
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="Code snippets" description="Call this pipeline from your own app.">
        <Tabs defaultValue="curl">
          <TabsList>
            <TabsTrigger value="curl">curl</TabsTrigger>
            <TabsTrigger value="js">JavaScript</TabsTrigger>
          </TabsList>
          <TabsContent value="curl">
            <CopyBlock value={curlSnippet} multiline />
          </TabsContent>
          <TabsContent value="js">
            <CopyBlock value={jsSnippet} multiline />
          </TabsContent>
        </Tabs>
      </SectionCard>
    </div>
  );
}

function DangerSection({ pipeline, canManage, onDelete }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <SectionCard title="Danger zone" description="Irreversible actions.">
      <div className="flex items-center justify-between gap-4 rounded-xl border border-red-500/20 bg-red-500/5 p-5">
        <div>
          <p className="text-sm font-medium text-foreground">Delete this pipeline</p>
          <p className="mt-0.5 text-xs text-text-secondary">
            API keys, MCP servers, and widgets that use it will stop working.
          </p>
        </div>
        <Button
          variant="outline"
          className="shrink-0 border-destructive/30 text-destructive-text hover:bg-destructive/10"
          disabled={!canManage}
          onClick={() => setConfirmOpen(true)}
        >
          <Trash2 className="h-4 w-4" /> Delete
        </Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete pipeline</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{" "}
              <span className="font-medium text-foreground">{pipeline.name}</span>? This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmOpen(false);
                onDelete(pipeline);
              }}
            >
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}

export function PipelineDetailScreen({ pipeline, providers, knowledgeBases, projectId, onBack, onUpdate, onDelete }) {
  const canManage = useCan("grey.pipeline.manage");
  const canPublish = useCan("grey.pipeline.publish");
  const { section: active, setSection: setActive } = useWorkspaceUrl();
  const [form, setForm] = useState(pipeline);
  const [seedId, setSeedId] = useState(pipeline?.id);
  const [saving, setSaving] = useState(false);

  if (pipeline && pipeline.id !== seedId) {
    setSeedId(pipeline.id);
    setForm(pipeline);
  }

  if (!pipeline) return null;

  const patch = (partial) => setForm((f) => ({ ...f, ...partial }));

  const save = async () => {
    setSaving(true);
    const saved = await updatePipeline(form.id, form);
    setSaving(false);
    if (!saved) {
      toast.error("Couldn't save your changes.");
      return;
    }
    setForm(saved);
    onUpdate?.(saved);
    toast.success("Changes saved.");
  };

  const sectionProps = {
    form,
    patch,
    providers,
    knowledgeBases,
    canManage,
    canPublish,
    pipeline: form,
    projectId,
    onPublished: (updated) => {
      setForm(updated);
      onUpdate?.(updated);
    },
    onDelete,
  };

  return (
    <EditorShell
      back={{ label: "All Pipelines", onClick: onBack }}
      title={form.name}
      status={form.status}
      statusMap={PIPELINE_STATUS_MAP}
      meta={form.description || "No description yet"}
      actions={
        canManage ? (
          <Button className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save changes
          </Button>
        ) : null
      }
      nav={TABS}
      defaultSection="model"
      active={active}
      onActiveChange={setActive}
    >
      {({ active: activeKey }) => {
        if (activeKey === "model") return <ModelSection {...sectionProps} />;
        if (activeKey === "retrieval") return <RetrievalSection {...sectionProps} />;
        if (activeKey === "prompt") return <PromptSection {...sectionProps} />;
        if (activeKey === "versions") return <VersionsSection {...sectionProps} />;
        if (activeKey === "endpoints") return <EndpointsSection {...sectionProps} />;
        if (activeKey === "danger") return <DangerSection {...sectionProps} />;
        return null;
      }}
    </EditorShell>
  );
}

export default PipelineDetailScreen;
