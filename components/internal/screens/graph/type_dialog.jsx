"use client";

// Create/edit dialog for a kg_types row (entity or relation kind, fixed by the caller).
import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@geiger/ui";
import { Input } from "@geiger/ui/input";
import { Textarea } from "@geiger/ui/textarea";
import { Button } from "@geiger/ui/button";
import { Field } from "@/components/internal/shared/screen_kit";
import { createType, updateType } from "@/lib/supabase/graph";
import { CHART_COLOR_OPTIONS } from "./constants";

const EMPTY_DRAFT = { name: "", color: CHART_COLOR_OPTIONS[0], description: "" };

function buildDraft(type) {
  return type?.id
    ? { name: type.name || "", color: type.color || CHART_COLOR_OPTIONS[0], description: type.description || "" }
    : EMPTY_DRAFT;
}

export function TypeDialog({ open, onOpenChange, kind, type, projectId, onSaved }) {
  const seedKey = `${open}-${type?.id || "new"}`;
  const [draft, setDraft] = useState(() => buildDraft(type));
  const [seed, setSeed] = useState(seedKey);
  if (seed !== seedKey) {
    setSeed(seedKey);
    if (open) setDraft(buildDraft(type));
  }

  const set = (key) => (value) => setDraft((d) => ({ ...d, [key]: value }));

  const save = async () => {
    const name = draft.name.trim();
    if (!name) {
      toast.error("Give the type a name.");
      return;
    }
    setSaving(true);
    const isEdit = Boolean(type?.id);
    const payload = { name, color: draft.color, description: draft.description.trim() || null };
    const saved = isEdit
      ? await updateType(type.id, payload)
      : await createType(projectId, { ...payload, kind });
    setSaving(false);
    if (!saved) {
      toast.error(isEdit ? "Couldn't save the type." : "Couldn't create the type.");
      return;
    }
    toast.success(isEdit ? "Type updated." : "Type created.");
    onOpenChange(false);
    onSaved?.(saved);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{type?.id ? "Edit type" : `Add ${kind} type`}</DialogTitle>
          <DialogDescription>
            {kind === "entity"
              ? "Entity types classify the nodes of the graph (people, organizations, products…)."
              : "Relation types classify the edges connecting entities (works_at, part_of…)."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <Field label="Name">
            <Input value={draft.name} onChange={(e) => set("name")(e.target.value)} placeholder="e.g. Organization" autoFocus />
          </Field>

          <Field label="Colour">
            <div className="flex gap-2">
              {CHART_COLOR_OPTIONS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => set("color")(color)}
                  aria-label={color}
                  className={`h-8 w-8 rounded-full border-2 transition-transform ${
                    draft.color === color ? "scale-110 border-foreground" : "border-transparent"
                  }`}
                  style={{ backgroundColor: `var(--${color})` }}
                />
              ))}
            </div>
          </Field>

          <Field label="Description">
            <Textarea
              value={draft.description}
              onChange={(e) => set("description")(e.target.value)}
              placeholder="Optional…"
              rows={2}
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={saving} className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={save}>
            {type?.id ? "Save changes" : "Create type"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default TypeDialog;
