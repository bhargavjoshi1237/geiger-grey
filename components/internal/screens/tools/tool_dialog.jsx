"use client";

import React, { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@geiger/ui/button";
import { Checkbox } from "@geiger/ui/checkbox";
import { Input } from "@geiger/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@geiger/ui/dialog";
import { Field } from "@/components/internal/shared/screen_kit";
import { cn } from "@/lib/utils";
import { TEMPLATE_INFO, TOOL_LIMITS, TOOL_TEMPLATES, defaultToolSpec } from "@/lib/grey/tool_spec";
import { templateIcon } from "./constants";

// Template cards, like the ingestion preset picker.
function TemplatePicker({ value, onChange }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3" role="group" aria-label="Template">
      {TOOL_TEMPLATES.map((template) => {
        const info = TEMPLATE_INFO[template];
        const Icon = templateIcon(template);
        const active = value === template;
        return (
          <button
            key={template}
            type="button"
            onClick={() => onChange(template)}
            aria-pressed={active}
            className={cn(
              "flex flex-col gap-2 rounded-xl border bg-surface-subtle p-4 text-left transition-colors",
              active ? "border-primary ring-1 ring-primary" : "border-border hover:bg-surface-active",
            )}
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-card text-muted-foreground">
              <Icon className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold text-foreground">{info.label}</span>
            <p className="text-xs leading-5 text-text-secondary">{info.description}</p>
          </button>
        );
      })}
    </div>
  );
}

// New tool: a template, a name and the knowledge bases to search. Everything else is shaped in
// the tool's own editor (the builder chat or Configure).
export function ToolDialog({ open, onOpenChange, knowledgeBases = [], onCreate }) {
  const activeKbs = knowledgeBases.filter((kb) => kb.status !== "archived");
  const [template, setTemplate] = useState("find_similar");
  const [name, setName] = useState("");
  const [kbIds, setKbIds] = useState([]);
  const [creating, setCreating] = useState(false);
  const [seeded, setSeeded] = useState(false);

  // Seed once per open: every active knowledge base starts selected.
  if (open && !seeded) {
    setSeeded(true);
    setTemplate("find_similar");
    setName("");
    setKbIds(activeKbs.map((kb) => kb.id));
  } else if (!open && seeded) {
    setSeeded(false);
  }

  const toggleKb = (id, checked) => setKbIds((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)));

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Give your tool a name first.");
      return;
    }
    if (!kbIds.length) {
      toast.error("Choose at least one knowledge base to search.");
      return;
    }
    setCreating(true);
    const ok = await onCreate({ name: trimmed, description: "", spec: defaultToolSpec(template, { kbIds }) });
    setCreating(false);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto bg-background sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create tool</DialogTitle>
          <DialogDescription>
            Pick what the tool does and where it looks. You&apos;ll shape the rest in the builder chat.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5">
          <TemplatePicker value={template} onChange={setTemplate} />

          <Field label="Tool name" htmlFor="tool-create-name">
            <Input
              id="tool-create-name"
              value={name}
              maxLength={TOOL_LIMITS.nameChars}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder="e.g. Defect type classifier"
              autoFocus
            />
          </Field>

          <Field label="Knowledge bases" hint="The stored items this tool compares against. You can change this later.">
            <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
              {activeKbs.length ? (
                activeKbs.map((kb) => (
                  <label key={kb.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-subtle">
                    <Checkbox
                      checked={kbIds.includes(kb.id)}
                      onCheckedChange={(checked) => toggleKb(kb.id, Boolean(checked))}
                    />
                    <span className="text-sm text-foreground">{kb.name}</span>
                  </label>
                ))
              ) : (
                <p className="px-2 py-1.5 text-sm text-text-tertiary">No knowledge bases yet — create one first.</p>
              )}
            </div>
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
            disabled={creating || !activeKbs.length}
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Create tool
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ToolDialog;
