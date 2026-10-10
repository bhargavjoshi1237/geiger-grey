"use client";

import { useState } from "react";
import { CalendarClock } from "lucide-react";

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
import { Field } from "@/components/internal/shared/screen_kit";

// toIsoOrNull: an empty date input becomes `null` (clears review_due_at)
// instead of an empty string, which the column would reject.
function toIsoOrNull(dateValue) {
  if (!dateValue) return null;
  const d = new Date(`${dateValue}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toDateInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

// Owner / review-date editor for a single source. "Mark verified" lives as a
// one-click row action; this dialog is for the pair of fields that need input.
export function FreshnessDialog({ open, onOpenChange, source, onSave }) {
  const [ownerId, setOwnerId] = useState("");
  const [reviewDueAt, setReviewDueAt] = useState("");
  const [seed, setSeed] = useState(null);

  if (source && source.id !== seed) {
    setSeed(source.id);
    setOwnerId(source.ownerId || "");
    setReviewDueAt(toDateInput(source.reviewDueAt));
  }

  const save = () => {
    onSave?.(source.id, {
      ownerId: ownerId.trim() || null,
      reviewDueAt: toIsoOrNull(reviewDueAt),
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Owner &amp; review date</DialogTitle>
          <DialogDescription>
            Set who owns {source?.name || "this source"} and when it should next
            be reviewed for freshness.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Owner (user ID)" hint="Optional — paste a team member's user ID.">
            <Input
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
              placeholder="Optional"
            />
          </Field>
          <Field label="Review due">
            <Input
              type="date"
              value={reviewDueAt}
              onChange={(e) => setReviewDueAt(e.target.value)}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={save}
          >
            <CalendarClock className="h-4 w-4" /> Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default FreshnessDialog;
