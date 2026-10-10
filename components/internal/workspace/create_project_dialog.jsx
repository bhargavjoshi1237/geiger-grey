"use client";

import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
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
import { useProject } from "@/context/project-context";

// Names and creates a project, then switches to it; shared by the no-projects
// state and (later) a project switcher.
export function CreateProjectDialog({ open, onOpenChange }) {
  const { createProject } = useProject();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) {
      toast.error("Give your project a name.");
      return;
    }
    setSaving(true);
    const created = await createProject(name);
    setSaving(false);
    if (created) {
      toast.success(`Switched to "${created.name}".`);
      setName("");
      onOpenChange(false);
    } else {
      toast.error("Couldn't create the project.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-background">
        <DialogHeader>
          <DialogTitle>Create project</DialogTitle>
          <DialogDescription>
            A project scopes its knowledge bases, pipelines, and conversations.
            You&apos;ll be switched to it once created.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Project name" htmlFor="project-name">
            <Input
              id="project-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Acme Knowledge Base"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !saving) submit();
              }}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            className="border-border bg-transparent text-muted-foreground hover:bg-surface-active hover:text-foreground"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            className="bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={submit}
            disabled={saving}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Create project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CreateProjectDialog;
