"use client";

import { Plus, Users } from "lucide-react";

import { EmptyState, SectionCard } from "@/components/internal/shared/screen_kit";
import { Button } from "@geiger/ui/button";

export default function GroupsTab({ groups, counts, onCreate }) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={onCreate}>
          <Plus className="h-4 w-4" /> New Group
        </Button>
      </div>
      {groups.length === 0 ? (
        <SectionCard>
          <EmptyState
            icon={Users}
            title="No groups yet"
            description="Group members into sub-teams like Ingestion reviewers or Pipeline admins."
            action={
              <Button onClick={onCreate} className="bg-primary text-primary-foreground">
                <Plus className="h-4 w-4" /> New Group
              </Button>
            }
          />
        </SectionCard>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => (
            <SectionCard key={g.id}>
              <p className="truncate text-sm font-semibold text-foreground">{g.name}</p>
              {g.description ? (
                <p className="mt-0.5 text-xs text-text-secondary">{g.description}</p>
              ) : null}
              <p className="mt-2 text-xs text-text-tertiary">
                {counts[g.id] || 0} member{(counts[g.id] || 0) === 1 ? "" : "s"}
              </p>
            </SectionCard>
          ))}
        </div>
      )}
    </div>
  );
}
