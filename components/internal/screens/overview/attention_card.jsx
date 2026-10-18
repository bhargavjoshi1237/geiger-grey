"use client";

import { ChevronRight } from "lucide-react";
import { useWorkspaceUrl } from "@/lib/hooks/use-workspace-url";
import { URGENCY_LABELS, URGENCY_ORDER } from "./constants";
import { WidgetHeader, WidgetShell } from "./widget_kit";

// `items`: [{ key, label, hint, value, icon, urgency, tab }] — each row opens its tab.
export function AttentionCard({ items }) {
  const { setTab } = useWorkspaceUrl();
  const sorted = [...items].sort(
    (a, b) => URGENCY_ORDER.indexOf(a.urgency) - URGENCY_ORDER.indexOf(b.urgency),
  );

  return (
    <WidgetShell contentClassName="flex flex-col">
      <WidgetHeader
        title="Overall Stats"
        subtitle="A quick snapshot of what needs attention in this project."
        action={
          <span className="shrink-0 rounded-md border border-border bg-surface-card px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {items.length} Legends
          </span>
        }
      />

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.tab)}
              className="group flex cursor-pointer items-center gap-3.5 rounded-xl p-3.5 text-left transition-colors hover:bg-surface-card"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-card text-muted-foreground">
                <Icon className="h-[18px] w-[18px]" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold text-foreground">{item.label}</span>
                  <span className="shrink-0 rounded-md border border-border bg-surface-card px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">
                    {URGENCY_LABELS[item.urgency]}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-text-secondary">{item.hint}</p>
              </div>
              <span className="shrink-0 text-xl font-bold tabular-nums text-foreground dark:text-white">
                {item.value}
              </span>
              <span className="shrink-0 inline-flex items-center gap-0.5 text-xs font-medium text-text-secondary transition-colors group-hover:text-foreground">
                <ChevronRight className="h-3 w-3" />
              </span>
            </button>
          );
        })}
      </div>
    </WidgetShell>
  );
}
