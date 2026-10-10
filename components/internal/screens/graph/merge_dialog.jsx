"use client";

// Confirms merging a group of likely-duplicate entities into one canonical entity.
// mergeEntities() unions aliases, re-points relations/mentions, and soft-deletes the rest.
import { useState } from "react";
import { toast } from "sonner";
import { Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@geiger/ui";
import { Button } from "@geiger/ui/button";
import { Badge } from "@geiger/ui/badge";
import { mergeEntities } from "@/lib/supabase/graph";

export function MergeDialog({ open, onOpenChange, group = [], projectId, onMerged }) {
  const seedKey = `${open}-${group.map((e) => e.id).join(",")}`;
  const [canonicalId, setCanonicalId] = useState(() => group[0]?.id || null);
  const [seed, setSeed] = useState(seedKey);
  if (seed !== seedKey) {
    setSeed(seedKey);
    if (open) setCanonicalId(group[0]?.id || null);
  }

  const canonical = group.find((e) => e.id === canonicalId) || group[0];
  const others = group.filter((e) => e.id !== canonicalId);
  const unionAliases = [
    ...new Set([...(canonical?.aliases || []), ...others.flatMap((e) => [e.name, ...(e.aliases || [])])]),
  ];

  const confirm = async () => {
    if (!canonical || others.length === 0) return;
    setSaving(true);
    const ok = await mergeEntities(projectId, {
      canonicalId: canonical.id,
      duplicateIds: others.map((e) => e.id),
    });
    setSaving(false);
    if (!ok) {
      toast.error("Couldn't merge these entities.");
      return;
    }
    toast.success(`Merged into ${canonical.name}.`);
    onOpenChange(false);
    onMerged?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Merge duplicates</DialogTitle>
          <DialogDescription>
            Choose which entity stays. The others are merged into it: their names become aliases,
            their relations and mentions move over, and they&apos;re removed from the graph.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          {group.map((entity) => {
            const isCanonical = entity.id === canonicalId;
            return (
              <button
                key={entity.id}
                type="button"
                onClick={() => setCanonicalId(entity.id)}
                className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  isCanonical
                    ? "border-primary bg-surface-card"
                    : "border-border bg-surface-subtle hover:bg-surface-card"
                }`}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{entity.name}</p>
                  {entity.aliases?.length ? (
                    <p className="truncate text-xs text-text-secondary">
                      aka {entity.aliases.join(", ")}
                    </p>
                  ) : null}
                </div>
                {isCanonical ? (
                  <Badge variant="info" className="shrink-0 gap-1">
                    <Check className="h-3 w-3" /> Keep
                  </Badge>
                ) : null}
              </button>
            );
          })}
        </div>

        {unionAliases.length ? (
          <div className="rounded-lg border border-border bg-surface-card p-3">
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-text-secondary">
              Aliases after merge
            </p>
            <div className="flex flex-wrap gap-1.5">
              {unionAliases.map((alias) => (
                <Badge key={alias} variant="neutral">
                  {alias}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={saving || !canonical || others.length === 0}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={confirm}
          >
            Merge {others.length} into {canonical?.name || "…"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default MergeDialog;
