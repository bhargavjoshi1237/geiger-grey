"use client";

import { Clock } from "lucide-react";

import { EmptyState, SectionCard } from "@/components/internal/shared/screen_kit";
import { cn } from "@/lib/utils";
import { ACTIVITY_ACTION_MAP, formatRelativeTime } from "../constants";

export default function ActivityTab({ activity }) {
  if (!activity.length) {
    return (
      <SectionCard>
        <EmptyState
          icon={Clock}
          title="No activity yet"
          description="Invites, role changes and removals will show up here."
        />
      </SectionCard>
    );
  }
  return (
    <SectionCard bodyPadding={false} contentClassName="p-4">
      <ol className="space-y-4">
        {activity.map((a) => {
          const meta = ACTIVITY_ACTION_MAP[a.action] || {
            label: a.action,
            icon: Clock,
            tone: "text-text-secondary",
          };
          const Icon = meta.icon;
          return (
            <li key={a.id} className="flex gap-3">
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-surface-card">
                <Icon className={cn("h-3.5 w-3.5", meta.tone)} />
              </div>
              <div className="min-w-0">
                <p className="text-sm text-foreground">
                  <span className="font-medium">{a.actorName || "Someone"}</span>{" "}
                  <span className="text-text-secondary">{meta.label}</span>{" "}
                  <span className="font-medium">
                    {a.targetName || a.detail?.role || a.detail?.email || ""}
                  </span>
                </p>
                <p className="text-xs text-text-tertiary">{formatRelativeTime(a.createdAt)}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </SectionCard>
  );
}
