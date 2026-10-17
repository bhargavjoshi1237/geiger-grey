"use client";

import React, { useMemo, useState } from "react";
import { Loader2, MessageCircle, Send } from "lucide-react";
import { toast } from "sonner";

import {
  EditorSectionHeader,
  Field,
  SegmentedTabs,
  SettingRow,
} from "@/components/internal/shared/screen_kit";
import { CopyBlock } from "@/components/internal/shared/copy_block";
import { TagInput } from "@/components/internal/shared/tag_input";
import { Button } from "@geiger/ui/button";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@geiger/ui/sheet";
import { BASE_PATH } from "@/lib/base_path";
import { cn } from "@/lib/utils";

import {
  DEFAULT_WIDGET_THEME,
  WIDGET_POSITION_TABS,
  computeApiKeyStatus,
  isValidHostname,
} from "./constants";

const emptyDraft = () => ({
  name: "",
  pipelineId: "",
  apiKeyId: "",
  allowedDomains: [],
  whiteLabel: false,
  theme: { ...DEFAULT_WIDGET_THEME },
});

// Widget preview: the floating bubble plus the open chat panel, rendered with
// the draft's own theme so the shape of the real embed is obvious before saving.
function WidgetPreview({ theme, whiteLabel }) {
  const onLeft = theme.position === "left";
  return (
    <div className="relative h-72 overflow-hidden rounded-xl border border-border bg-surface-subtle">
      <div
        className={cn(
          "absolute bottom-16 w-64 overflow-hidden rounded-xl border border-border bg-surface-card shadow-lg",
          onLeft ? "left-4" : "right-4",
        )}
      >
        <div className="flex items-center gap-2 border-b border-border bg-primary px-3 py-2.5 text-primary-foreground">
          <MessageCircle className="h-4 w-4" />
          <span className="truncate text-sm font-semibold">{theme.title || "Chat with us"}</span>
        </div>
        <div className="space-y-2 px-3 py-3">
          <p className="rounded-lg bg-surface-hover px-2.5 py-2 text-xs text-foreground">
            {theme.greeting || "Hi! Ask me anything."}
          </p>
        </div>
        <div className="flex items-center gap-2 border-t border-border px-3 py-2">
          <span className="flex-1 truncate text-xs text-text-tertiary">
            {theme.placeholder || "Type your question…"}
          </span>
          <Send className="h-3.5 w-3.5 text-text-tertiary" />
        </div>
        {!whiteLabel ? (
          <div className="border-t border-border px-3 py-1.5 text-center text-[10px] text-text-tertiary">
            Powered by Grey
          </div>
        ) : null}
      </div>

      <div className={cn("absolute bottom-4 flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg", onLeft ? "left-4" : "right-4")}>
        <MessageCircle className="h-5 w-5" />
      </div>
    </div>
  );
}

// Create/edit Sheet for a widget: delivery config (pipeline, key, allowed
// domains), appearance theme with a live preview, and — once saved — the
// embed snippet to drop onto a page.
export function WidgetSheet({ open, onOpenChange, pipelines, apiKeys, initial, onSave }) {
  const [draft, setDraft] = useState(emptyDraft());
  const [saving, setSaving] = useState(false);
  const isEdit = !!initial;
  // Revoked or expired keys can't authenticate a widget, so they aren't offered.
  const activeKeys = useMemo(
    () => (apiKeys || []).filter((k) => computeApiKeyStatus(k) === "active"),
    [apiKeys],
  );

  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setDraft(
        initial
          ? {
              name: initial.name || "",
              pipelineId: initial.pipelineId || "",
              apiKeyId: initial.apiKeyId || "",
              allowedDomains: initial.allowedDomains || [],
              whiteLabel: !!initial.whiteLabel,
              theme: { ...DEFAULT_WIDGET_THEME, ...(initial.theme || {}) },
            }
          : emptyDraft(),
      );
    }
  }

  const set = (key) => (value) => setDraft((d) => ({ ...d, [key]: value }));
  const setTheme = (key) => (value) =>
    setDraft((d) => ({ ...d, theme: { ...d.theme, [key]: value } }));

  const embedSnippet = useMemo(() => {
    if (!initial?.id) return "";
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `<script src="${origin}${BASE_PATH}/widget.js" data-widget="${initial.id}" async></script>`;
  }, [initial]);

  const submit = async () => {
    if (!draft.name.trim()) {
      toast.error("Give the widget a name.");
      return;
    }
    if (!draft.pipelineId) {
      toast.error("Pick a pipeline for this widget to query.");
      return;
    }
    setSaving(true);
    const ok = await onSave({
      name: draft.name.trim(),
      pipelineId: draft.pipelineId,
      apiKeyId: draft.apiKeyId || null,
      allowedDomains: draft.allowedDomains,
      whiteLabel: draft.whiteLabel,
      theme: draft.theme,
    });
    setSaving(false);
    // Editing closes as usual; creating stays open so the parent can swap
    // `initial` to the new record and the embed snippet (which needs its id)
    // appears right away instead of requiring a reopen.
    if (ok && isEdit) onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{isEdit ? "Edit Widget" : "New Widget"}</SheetTitle>
          <SheetDescription>
            Embed a chat bubble on your own site, scoped to a pipeline and the
            domains you allow.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 px-4 pb-6">
          <div className="space-y-4">
            <EditorSectionHeader title="Delivery" />
            <Field label="Name" htmlFor="widget-name">
              <Input
                id="widget-name"
                value={draft.name}
                onChange={(e) => set("name")(e.target.value)}
                placeholder="e.g. Docs site widget"
                autoFocus
              />
            </Field>
            <Field label="Pipeline" htmlFor="widget-pipeline">
              <Select value={draft.pipelineId} onValueChange={set("pipelineId")}>
                <SelectTrigger id="widget-pipeline">
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
            <Field label="API key">
              <Select value={draft.apiKeyId} onValueChange={set("apiKeyId")}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an API key" />
                </SelectTrigger>
                <SelectContent>
                  {activeKeys.map((k) => (
                    <SelectItem key={k.id} value={k.id}>
                      {k.name} ({k.prefix}…)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field
              label="Allowed domains"
              hint="Pages embedding this widget must load from one of these hostnames."
            >
              <TagInput
                value={draft.allowedDomains}
                onChange={set("allowedDomains")}
                placeholder="example.com"
                validate={isValidHostname}
              />
            </Field>
          </div>

          <div className="space-y-4">
            <EditorSectionHeader title="Appearance" />
            <Field label="Title" htmlFor="widget-title">
              <Input
                id="widget-title"
                value={draft.theme.title}
                onChange={(e) => setTheme("title")(e.target.value)}
              />
            </Field>
            <Field label="Greeting" htmlFor="widget-greeting">
              <Textarea
                id="widget-greeting"
                value={draft.theme.greeting}
                onChange={(e) => setTheme("greeting")(e.target.value)}
                rows={2}
              />
            </Field>
            <Field label="Placeholder" htmlFor="widget-placeholder">
              <Input
                id="widget-placeholder"
                value={draft.theme.placeholder}
                onChange={(e) => setTheme("placeholder")(e.target.value)}
              />
            </Field>
            <Field label="Position">
              <SegmentedTabs
                tabs={WIDGET_POSITION_TABS}
                value={draft.theme.position}
                onChange={setTheme("position")}
              />
            </Field>
            <SettingRow
              title="White-label"
              description="Hide the “Powered by Grey” footer."
              checked={draft.whiteLabel}
              onCheckedChange={set("whiteLabel")}
            />
          </div>

          <div className="space-y-2">
            <EditorSectionHeader title="Preview" />
            <WidgetPreview theme={draft.theme} whiteLabel={draft.whiteLabel} />
          </div>

          <div className="space-y-2">
            <EditorSectionHeader title="Embed snippet" />
            {embedSnippet ? (
              <>
                <CopyBlock value={embedSnippet} label="Paste before </body>" multiline />
                <p className="text-xs text-text-tertiary">
                  Add each site that embeds the widget to Allowed domains — other origins are refused.
                </p>
              </>
            ) : (
              <p className="text-sm text-text-secondary">
                Save the widget to generate its embed snippet.
              </p>
            )}
          </div>
        </div>

        <SheetFooter className="flex-row justify-end gap-2 border-t border-border">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isEdit ? "Save" : "Create Widget"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export default WidgetSheet;
