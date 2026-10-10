"use client";

import React, { useState } from "react";
import { Loader2, Server } from "lucide-react";
import { toast } from "sonner";

import { Field, SettingRow, SettingsList } from "@/components/internal/shared/screen_kit";
import { Button } from "@geiger/ui/button";
import { Input } from "@geiger/ui/input";
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

import { MultiSelectList } from "./multi_select_list";
import { DEFAULT_MCP_TOOLS, MCP_TOOL_DEFS, computeApiKeyStatus } from "./constants";

const emptyDraft = () => ({
  name: "",
  kbIds: [],
  pipelineId: "",
  apiKeyId: "",
  tools: { ...DEFAULT_MCP_TOOLS },
});

// Create/edit dialog for an MCP server: which knowledge bases and pipeline it
// serves, which key authenticates it, and which tools it exposes.
export function McpServerDialog({
  open,
  onOpenChange,
  knowledgeBases,
  pipelines,
  apiKeys,
  initial,
  onSave,
}) {
  const [draft, setDraft] = useState(emptyDraft());
  const [saving, setSaving] = useState(false);
  const isEdit = !!initial;

  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setDraft(
        initial
          ? {
              name: initial.name || "",
              kbIds: initial.kbIds || [],
              pipelineId: initial.pipelineId || "",
              apiKeyId: initial.apiKeyId || "",
              tools: { ...DEFAULT_MCP_TOOLS, ...(initial.tools || {}) },
            }
          : emptyDraft(),
      );
    }
  }

  const set = (key) => (value) => setDraft((d) => ({ ...d, [key]: value }));
  const toggleTool = (key, on) =>
    setDraft((d) => ({ ...d, tools: { ...d.tools, [key]: on } }));

  const submit = async () => {
    if (!draft.name.trim()) {
      toast.error("Give the server a name.");
      return;
    }
    if (!draft.pipelineId) {
      toast.error("Pick a pipeline for this server to query.");
      return;
    }
    setSaving(true);
    const ok = await onSave({
      name: draft.name.trim(),
      kbIds: draft.kbIds,
      pipelineId: draft.pipelineId,
      apiKeyId: draft.apiKeyId || null,
      tools: draft.tools,
    });
    setSaving(false);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto bg-background">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit MCP Server" : "New MCP Server"}</DialogTitle>
          <DialogDescription>
            An MCP server exposes a pipeline and its knowledge bases to MCP
            clients like Claude Desktop or Cursor.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="Name" htmlFor="mcp-name">
            <Input
              id="mcp-name"
              value={draft.name}
              onChange={(e) => set("name")(e.target.value)}
              placeholder="e.g. Support knowledge"
              autoFocus
            />
          </Field>

          <Field label="Knowledge bases" hint="Which knowledge bases the server can search.">
            <MultiSelectList
              items={knowledgeBases}
              value={draft.kbIds}
              onChange={set("kbIds")}
              emptyTitle="No knowledge bases yet"
              summaryLabel="knowledge base"
            />
          </Field>

          <Field label="Pipeline" htmlFor="mcp-pipeline">
            <Select value={draft.pipelineId} onValueChange={set("pipelineId")}>
              <SelectTrigger id="mcp-pipeline">
                <SelectValue placeholder="Select a pipeline" />
              </SelectTrigger>
              <SelectContent>
                {(pipelines || []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="API key" hint="Authenticates clients that connect to this server.">
            <Select value={draft.apiKeyId} onValueChange={set("apiKeyId")}>
              <SelectTrigger>
                <SelectValue placeholder="Select an API key" />
              </SelectTrigger>
              <SelectContent>
                {(apiKeys || [])
                  .filter((k) => computeApiKeyStatus(k) === "active")
                  .map((k) => (
                    <SelectItem key={k.id} value={k.id}>
                      {k.name} ({k.prefix}…)
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Tools">
            <SettingsList className="rounded-lg border border-border bg-surface-card px-3">
              {MCP_TOOL_DEFS.map((tool) => (
                <SettingRow
                  key={tool.key}
                  title={tool.label}
                  description={tool.description}
                  checked={!!draft.tools[tool.key]}
                  onCheckedChange={(v) => toggleTool(tool.key, v)}
                />
              ))}
            </SettingsList>
          </Field>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Server className="h-4 w-4" />}
            {isEdit ? "Save" : "Create Server"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default McpServerDialog;
