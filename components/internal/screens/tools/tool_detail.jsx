"use client";

import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Bot,
  FlaskConical,
  History,
  KeyRound,
  Link2,
  Loader2,
  Megaphone,
  Play,
  Plug,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
} from "lucide-react";

import { LoadingArea } from "@geiger/ui";
import { Badge } from "@geiger/ui/badge";
import { Button } from "@geiger/ui/button";
import { Textarea } from "@geiger/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@geiger/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@geiger/ui/dialog";
import { EditorShell } from "@/components/internal/shared/editor_shell";
import { Field, SectionCard, SegmentedTabs, StatusPill } from "@/components/internal/shared/screen_kit";
import { CopyBlock } from "@/components/internal/shared/copy_block";
import { MCP_STATUS_MAP } from "@/components/internal/screens/delivery/constants";
import { useCan } from "@/context/rbac-context";
import { useWorkspaceUrl } from "@/lib/hooks/use-workspace-url";
import { BASE_PATH } from "@/lib/base_path";
import { formatRelative } from "@/lib/grey/format";
import { normalizeToolSpec, summarizeToolSpec, toolInputJsonSchema, validateToolSpec } from "@/lib/grey/tool_spec";
import { listMcpServers } from "@/lib/supabase/mcp_servers";
import { listToolVersions, publishToolRequest, updateTool } from "@/lib/supabase/tools";
import { TOOL_STATUS_MAP, describeTestReport, templateLabel } from "./constants";
import { ToolBuilderPanel } from "./tool_builder";
import { ToolConfigForm } from "./tool_config_form";
import { Notice } from "./tool_result";
import { ToolRunner } from "./tool_runner";
import { ToolTests } from "./tool_tests";

const TABS = [
  {
    key: "build",
    label: "Build",
    icon: Bot,
    desc: "Tell the builder what the tool should do. It shapes the draft, and you can try it as you go.",
  },
  { key: "try", label: "Try it", icon: Play, desc: "Run the tool on an image or text and see exactly what it returns." },
  { key: "configure", label: "Configure", icon: SlidersHorizontal, desc: "Every setting of the draft, as a form." },
  { key: "tests", label: "Tests", icon: FlaskConical, desc: "Measure the tool on the items you've labelled in Sources." },
  {
    key: "versions",
    label: "Versions",
    icon: History,
    desc: "Published snapshots. API keys and MCP servers run the latest one.",
  },
  {
    key: "endpoints",
    label: "Endpoints",
    icon: Link2,
    desc: "Call the published tool from your own app, or expose it to an MCP client.",
  },
  { key: "danger", label: "Danger zone", icon: TriangleAlert, desc: "Irreversible actions.", ownHeader: true },
];

// The member-editable part of a tool, for dirty checks.
const editableKey = (tool) => JSON.stringify([tool?.name ?? "", tool?.description ?? "", tool?.spec ?? null]);

const activeKbIds = (knowledgeBases) => knowledgeBases.filter((kb) => kb.status !== "archived").map((kb) => kb.id);

function BuildSection({ form, projectId, canManage, dirty, onBuilderChange }) {
  return (
    <div className="space-y-4">
      {dirty ? (
        <Notice>
          You have unsaved changes from Configure. Save them first — the builder edits the saved draft, and its next
          change replaces them.
        </Notice>
      ) : null}
      <ToolBuilderPanel tool={form} projectId={projectId} canManage={canManage} onToolChange={onBuilderChange} />
    </div>
  );
}

function TrySection({ saved, projectId }) {
  const [target, setTarget] = useState("draft");
  const [latest, setLatest] = useState(null);

  useEffect(() => {
    if (!saved.currentVersion) return undefined;
    let alive = true;
    listToolVersions(projectId, saved.id).then((rows) => {
      if (alive) setLatest(rows[0] || null);
    });
    return () => {
      alive = false;
    };
  }, [projectId, saved.id, saved.currentVersion]);

  const published = target === "published" && latest ? latest : null;

  return (
    <div className="space-y-5">
      {saved.currentVersion ? (
        <SegmentedTabs
          tabs={[
            { value: "draft", label: "Draft" },
            { value: "published", label: `Published · v${saved.currentVersion}` },
          ]}
          value={target}
          onChange={setTarget}
        />
      ) : null}
      <ToolRunner
        tool={published ? { ...saved, spec: published.spec } : saved}
        projectId={projectId}
        version={published ? published.version : 0}
      />
    </div>
  );
}

function PublishDialog({ open, onOpenChange, tool, knowledgeBases, dirty, publishing, serverErrors, onPublish }) {
  const [note, setNote] = useState("");
  const [seededFor, setSeededFor] = useState(false);
  if (open !== seededFor) {
    setSeededFor(open);
    if (open) setNote("");
  }

  const spec = useMemo(() => normalizeToolSpec(tool.spec), [tool.spec]);
  const summary = useMemo(() => summarizeToolSpec(spec, { kbNames: knowledgeBases }), [spec, knowledgeBases]);
  const validation = useMemo(() => validateToolSpec(spec, { kbIds: activeKbIds(knowledgeBases) }), [spec, knowledgeBases]);
  const errors = serverErrors?.length ? serverErrors : validation.errors;
  const testLine = describeTestReport(tool.testReport);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto bg-background sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Publish tool</DialogTitle>
          <DialogDescription>
            Snapshots the saved draft as version {(tool.currentVersion || 0) + 1}. API keys and MCP servers switch to it
            right away.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {dirty ? <Notice>Unsaved changes aren&apos;t included — save them first to publish them.</Notice> : null}

          <div className="space-y-1.5">
            <p className="text-[11px] font-medium uppercase tracking-wider text-text-secondary">What gets published</p>
            <p className="whitespace-pre-line rounded-lg border border-border bg-surface-subtle px-3 py-2.5 text-xs leading-5 text-text-secondary">
              {summary}
            </p>
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] font-medium uppercase tracking-wider text-text-secondary">Last test</p>
            <p className="text-sm text-foreground">
              {testLine ? (
                <>
                  {testLine}
                  {tool.testReport?.ranAt ? (
                    <span className="text-text-tertiary"> · {formatRelative(tool.testReport.ranAt)}</span>
                  ) : null}
                </>
              ) : (
                <span className="text-text-secondary">Not tested yet. Run tests to see how it does on your labelled items.</span>
              )}
            </p>
          </div>

          {errors.length ? (
            <Notice tone="danger">
              <p className="font-medium">Fix these in Configure or Build first:</p>
              <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
                {errors.map((e) => (
                  <li key={`${e.path}-${e.message}`}>{e.message}</li>
                ))}
              </ul>
            </Notice>
          ) : null}

          <Field label="Release note (optional)" htmlFor="tool-publish-note">
            <Textarea
              id="tool-publish-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What changed in this version…"
              rows={3}
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={() => onPublish(note.trim())}
            disabled={publishing || !validation.ok}
          >
            {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}
            Publish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VersionsSection({ saved, projectId, knowledgeBases, canPublish, dirty, onPublished }) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [serverErrors, setServerErrors] = useState([]);
  const [loadedFor, setLoadedFor] = useState(null);

  const loadKey = `${saved.id}:${saved.currentVersion || 0}`;
  if (loadKey !== loadedFor) {
    setLoadedFor(loadKey);
    setLoading(true);
  }

  useEffect(() => {
    let alive = true;
    listToolVersions(projectId, saved.id).then((rows) => {
      if (!alive) return;
      setVersions(rows || []);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [projectId, saved.id, saved.currentVersion]);

  const openPublish = () => {
    setServerErrors([]);
    setPublishOpen(true);
  };

  const handlePublish = async (note) => {
    setPublishing(true);
    setServerErrors([]);
    const res = await publishToolRequest({ projectId, toolId: saved.id, note: note || undefined });
    setPublishing(false);
    if (res.error || !res.data?.tool) {
      if (res.errors?.length) setServerErrors(res.errors);
      else toast.error(res.message || "Couldn't publish this tool.");
      return;
    }
    setPublishOpen(false);
    onPublished(res.data.tool);
    toast.success(`Published as v${res.data.tool.currentVersion ?? res.data.version?.version ?? ""}.`);
  };

  return (
    <SectionCard
      title="Versions"
      description="Every snapshot taken when this tool was published."
      action={
        canPublish ? (
          <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={openPublish}>
            <Megaphone className="h-4 w-4" /> Publish
          </Button>
        ) : null
      }
    >
      {loading ? (
        <LoadingArea label="Loading versions" />
      ) : versions.length ? (
        <div className="divide-y divide-border">
          {versions.map((v) => {
            const testLine = describeTestReport(v.testReport);
            return (
              <div key={v.id} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-foreground">Version {v.version}</p>
                    {v.version === saved.currentVersion ? <StatusPill status="live" map={TOOL_STATUS_MAP} /> : null}
                  </div>
                  {v.note ? <p className="text-xs text-text-secondary">{v.note}</p> : null}
                  {testLine ? <p className="text-xs text-text-tertiary">Tested: {testLine}</p> : null}
                </div>
                <span className="shrink-0 text-xs text-text-tertiary">{v.createdAt ? formatRelative(v.createdAt) : ""}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-text-tertiary">
          No versions published yet. Publishing makes the tool available to API keys and MCP servers.
        </p>
      )}

      <PublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        tool={saved}
        knowledgeBases={knowledgeBases}
        dirty={dirty}
        publishing={publishing}
        serverErrors={serverErrors}
        onPublish={handlePublish}
      />
    </SectionCard>
  );
}

// The request body for this tool's inputs, as a JSON literal and as JS.
function exampleBodies(spec) {
  const textValue = `<${(spec.input.textLabel || "text").toLowerCase()}>`;
  const json = {};
  const js = [];
  if (spec.input.image !== "off") {
    json.image = { data: "<base64>", mimeType: "image/jpeg" };
    js.push(`image: { data: base64Image, mimeType: "image/jpeg" },`);
  }
  if (spec.input.text !== "off") {
    json.text = textValue;
    js.push(`text: ${JSON.stringify(textValue)},`);
  }
  return { json: JSON.stringify(json), js };
}

// Only ever rendered after the client has taken over (a tool needs loaded data), so reading
// window here never risks a hydration mismatch.
function EndpointsSection({ saved, projectId }) {
  const { setTab } = useWorkspaceUrl();
  const [mcpServers, setMcpServers] = useState(null);
  const spec = useMemo(() => normalizeToolSpec(saved.spec), [saved.spec]);

  useEffect(() => {
    let alive = true;
    listMcpServers(projectId).then((rows) => {
      if (alive) setMcpServers((rows ?? []).filter((s) => s.tools?.[`tool:${saved.id}`] === true));
    });
    return () => {
      alive = false;
    };
  }, [projectId, saved.id]);

  const base = typeof window !== "undefined" ? `${window.location.origin}${BASE_PATH}` : "";
  const runUrl = base ? `${base}/api/v1/tools/${saved.id}/run` : "";
  const bodies = exampleBodies(spec);
  const curlSnippet = `curl -X POST "${runUrl}" \\\n  -H "Authorization: Bearer <api-key>" \\\n  -H "Content-Type: application/json" \\\n  -d '${bodies.json}'`;
  const jsSnippet = `const res = await fetch("${runUrl}", {\n  method: "POST",\n  headers: {\n    Authorization: \`Bearer \${apiKey}\`,\n    "Content-Type": "application/json",\n  },\n  body: JSON.stringify({\n${bodies.js.map((line) => `    ${line}`).join("\n")}\n  }),\n});\nconst { result } = await res.json();`;
  const schema = JSON.stringify(toolInputJsonSchema(spec), null, 2);

  return (
    <div className="space-y-5">
      <SectionCard
        title="REST endpoint"
        description={
          saved.status === "live"
            ? "Runs the latest published version and returns the same result you see in Try it."
            : "Publish this tool to start serving it."
        }
      >
        <div className="grid gap-4">
          <Field label="Run" hint={`Add "version": N to the body to run a specific published version.`}>
            <CopyBlock value={runUrl} />
          </Field>
          <Notice
            tone="neutral"
            action={
              <Button size="sm" variant="outline" onClick={() => setTab("API Keys")}>
                <KeyRound className="h-4 w-4" /> API Keys
              </Button>
            }
          >
            API keys need the <span className="font-medium text-foreground">Tools</span> scope with this tool selected.
            Responses are <code className="font-mono">{`{ object: "tool_run", toolId, version, result }`}</code>, with
            thumbnail links that expire after 10 minutes.
          </Notice>
        </div>
      </SectionCard>

      <SectionCard
        title="MCP servers"
        description="MCP servers that offer this tool to their clients."
        action={
          <Button size="sm" variant="outline" onClick={() => setTab("MCP Servers")}>
            <Plug className="h-4 w-4" /> MCP Servers
          </Button>
        }
      >
        {mcpServers === null ? (
          <LoadingArea label="Loading MCP servers" />
        ) : mcpServers.length ? (
          <div className="divide-y divide-border">
            {mcpServers.map((server) => (
              <div key={server.id} className="grid gap-2 py-3 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-sm font-medium text-foreground">{server.name || "Untitled"}</p>
                  <StatusPill status={server.status} map={MCP_STATUS_MAP} />
                </div>
                <CopyBlock value={base ? `${base}/api/mcp/${server.id}` : ""} />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-text-tertiary">
            No MCP servers offer this tool yet. Once it&apos;s published, turn it on in a server under Delivery → MCP
            Servers.
          </p>
        )}
      </SectionCard>

      <SectionCard title="Code snippets" description="Call this tool from your own app.">
        <Tabs defaultValue="curl">
          <TabsList>
            <TabsTrigger value="curl">curl</TabsTrigger>
            <TabsTrigger value="js">JavaScript</TabsTrigger>
            <TabsTrigger value="schema">Input schema</TabsTrigger>
          </TabsList>
          <TabsContent value="curl">
            <CopyBlock value={curlSnippet} multiline />
          </TabsContent>
          <TabsContent value="js">
            <CopyBlock value={jsSnippet} multiline />
          </TabsContent>
          <TabsContent value="schema">
            <CopyBlock value={schema} multiline />
          </TabsContent>
        </Tabs>
      </SectionCard>
    </div>
  );
}

function DangerSection({ saved, canManage, onDelete }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <SectionCard title="Danger zone" description="Irreversible actions.">
      <div className="flex flex-col gap-4 rounded-xl border border-red-500/20 bg-red-500/5 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">Delete this tool</p>
          <p className="mt-0.5 text-xs text-text-secondary">API keys and MCP servers that use it will stop working.</p>
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
            <DialogTitle>Delete tool</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <span className="font-medium text-foreground">{saved.name}</span>? This
              can&apos;t be undone.
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
                onDelete(saved);
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

export function ToolDetailScreen({ tool, projectId, knowledgeBases = [], providers = [], onBack, onUpdate, onDelete }) {
  const canManage = useCan("grey.tool.manage");
  const canPublish = useCan("grey.tool.publish");
  const { section: active, setSection: setActive } = useWorkspaceUrl();
  // `saved` is the row as the server has it; `form` carries unsaved Configure edits on top.
  const [saved, setSaved] = useState(tool);
  const [form, setForm] = useState(tool);
  const [seedId, setSeedId] = useState(tool?.id);
  const [saving, setSaving] = useState(false);

  if (tool && tool.id !== seedId) {
    setSeedId(tool.id);
    setSaved(tool);
    setForm(tool);
  }

  const spec = useMemo(() => normalizeToolSpec(form?.spec), [form?.spec]);

  if (!tool || !saved || !form) return null;

  const dirty = editableKey(form) !== editableKey(saved);

  // A newer server row: from a save, a builder edit, a test run or a publish. `keepEdits` keeps
  // unsaved Configure edits on top of it.
  const adopt = (next, { keepEdits = false } = {}) => {
    setSaved(next);
    setForm((f) => (keepEdits ? { ...next, name: f.name, description: f.description, spec: f.spec } : next));
    onUpdate?.(next);
  };

  const save = async () => {
    const name = (form.name || "").trim();
    if (!name) {
      toast.error("Give the tool a name first.");
      return;
    }
    setSaving(true);
    const updated = await updateTool(form.id, { name, description: (form.description || "").trim(), spec: form.spec });
    setSaving(false);
    if (!updated) {
      toast.error("Couldn't save your changes.");
      return;
    }
    adopt(updated);
    toast.success("Changes saved.");
  };

  const meta = `${templateLabel(spec.template)} · ${saved.currentVersion ? `Version ${saved.currentVersion}` : "Not published yet"}`;

  return (
    <EditorShell
      back={{ label: "Tools", onClick: onBack }}
      title={form.name || "Untitled tool"}
      status={saved.status}
      statusMap={TOOL_STATUS_MAP}
      badges={dirty ? <Badge variant="warning">Unsaved changes</Badge> : null}
      meta={meta}
      actions={
        canManage && dirty ? (
          <>
            <Button variant="ghost" onClick={() => setForm(saved)} disabled={saving}>
              Discard
            </Button>
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save changes
            </Button>
          </>
        ) : null
      }
      nav={TABS}
      defaultSection="build"
      active={active}
      onActiveChange={setActive}
    >
      {({ active: activeKey }) => {
        if (activeKey === "build") {
          return (
            <BuildSection
              form={form}
              projectId={projectId}
              canManage={canManage}
              dirty={dirty}
              onBuilderChange={(next) => next && adopt({ ...saved, ...next })}
            />
          );
        }
        if (activeKey === "try") return <TrySection saved={saved} projectId={projectId} />;
        if (activeKey === "configure") {
          return (
            <ToolConfigForm
              form={form}
              onFormChange={setForm}
              knowledgeBases={knowledgeBases}
              providers={providers}
              canManage={canManage}
            />
          );
        }
        if (activeKey === "tests") {
          return (
            <ToolTests
              tool={saved}
              projectId={projectId}
              canManage={canManage}
              dirty={dirty}
              onReport={(report) => adopt({ ...saved, testReport: report }, { keepEdits: true })}
            />
          );
        }
        if (activeKey === "versions") {
          return (
            <VersionsSection
              saved={saved}
              projectId={projectId}
              knowledgeBases={knowledgeBases}
              canPublish={canPublish}
              dirty={dirty}
              onPublished={(next) => adopt({ ...saved, ...next }, { keepEdits: true })}
            />
          );
        }
        if (activeKey === "endpoints") return <EndpointsSection saved={saved} projectId={projectId} />;
        if (activeKey === "danger") return <DangerSection saved={saved} canManage={canManage} onDelete={onDelete} />;
        return null;
      }}
    </EditorShell>
  );
}

export default ToolDetailScreen;
