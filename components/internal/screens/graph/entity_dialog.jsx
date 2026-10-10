"use client";

// Create/edit dialog for a kg_entities row. Manual entities always get source_app "manual".
import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@geiger/ui";
import { Input } from "@geiger/ui/input";
import { Textarea } from "@geiger/ui/textarea";
import { Button } from "@geiger/ui/button";
import { Field } from "@/components/internal/shared/screen_kit";
import { TagInput } from "@/components/internal/shared/tag_input";
import { createEntity, updateEntity } from "@/lib/supabase/graph";

const EMPTY_DRAFT = { name: "", typeId: "", aliases: [], description: "" };

function buildDraft(entity, types) {
  return entity?.id
    ? {
        name: entity.name || "",
        typeId: entity.typeId || types[0]?.id || "",
        aliases: entity.aliases || [],
        description: entity.description || "",
      }
    : { ...EMPTY_DRAFT, typeId: types[0]?.id || "" };
}

export function EntityDialog({ open, onOpenChange, entity, types = [], projectId, onSaved }) {
  const seedKey = `${open}-${entity?.id || "new"}`;
  const [draft, setDraft] = useState(() => buildDraft(entity, types));
  const [saving, setSaving] = useState(false);
  const [seed, setSeed] = useState(seedKey);
  // Resetting state while a prop changes, during render — React's documented alternative to an
  // effect for "derive state from props" (avoids the extra render an effect would cost here).
  if (seed !== seedKey) {
    setSeed(seedKey);
    if (open) setDraft(buildDraft(entity, types));
  }

  const set = (key) => (value) => setDraft((d) => ({ ...d, [key]: value }));

  const save = async () => {
    const name = draft.name.trim();
    if (!name) {
      toast.error("Give the entity a name.");
      return;
    }
    if (!draft.typeId) {
      toast.error("Choose an entity type.");
      return;
    }
    const isEdit = Boolean(entity?.id);
    const payload = {
      name,
      typeId: draft.typeId,
      aliases: draft.aliases,
      description: draft.description.trim() || null,
    };
    setSaving(true);
    try {
      const saved = isEdit
        ? await updateEntity(entity.id, payload)
        : await createEntity(projectId, { ...payload, sourceApp: "manual", confidence: 1 });
      if (!saved) {
        toast.error(isEdit ? "Couldn't save the entity." : "Couldn't create the entity.");
        return;
      }
      toast.success(isEdit ? "Entity updated." : "Entity created.");
      onOpenChange(false);
      onSaved?.(saved);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{entity?.id ? "Edit entity" : "Add entity"}</DialogTitle>
          <DialogDescription>
            Entities are the nodes of the knowledge graph — people, organizations, products and
            anything else worth tracking across your sources.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <Field label="Name">
            <Input
              value={draft.name}
              onChange={(e) => set("name")(e.target.value)}
              placeholder="e.g. Acme Corp"
              autoFocus
            />
          </Field>

          <Field label="Type">
            <Select value={draft.typeId} onValueChange={set("typeId")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a type" />
              </SelectTrigger>
              <SelectContent>
                {types.map((type) => (
                  <SelectItem key={type.id} value={type.id}>
                    {type.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Aliases" hint="Other names this entity is known by. Press Enter to add.">
            <TagInput value={draft.aliases} onChange={set("aliases")} placeholder="Add an alias…" />
          </Field>

          <Field label="Description">
            <Textarea
              value={draft.description}
              onChange={(e) => set("description")(e.target.value)}
              placeholder="Optional notes about this entity…"
              rows={3}
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={saving}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={save}
          >
            {entity?.id ? "Save changes" : "Create entity"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default EntityDialog;
