"use client";

import React, { useState } from "react";
import { FolderPlus, Plus } from "lucide-react";

import { Button } from "@geiger/ui/button";
import { EmptyState } from "@/components/internal/shared/screen_kit";
import { CreateProjectDialog } from "@/components/internal/workspace/create_project_dialog";

// Shared gate states for the project-scoped workspace. Used by the /project
// resolver and the /project/[projectId] shell.

// Re-exported from the suite kit so every product's workspace gate shows the
// same animated mark. Kept as a named re-export rather than switching call
// sites to import from @geiger/ui directly, since this is the documented path.
export { LoadingArea } from "@geiger/ui";

// Shown in place when the suite session has no projects; sign-in itself belongs to geiger-dash, never this app.
export function NoProjectsState() {
  const [createOpen, setCreateOpen] = useState(false);
  return (
    <div className="flex h-full min-h-[60dvh] w-full items-center justify-center p-6">
      <EmptyState
        icon={FolderPlus}
        title="No projects yet"
        description="A project holds your knowledge bases, pipelines and conversations. Create one to get started."
        action={
          <Button
            className="bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-4 w-4" /> Create project
          </Button>
        }
      />
      <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
