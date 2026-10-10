"use client";

import React from "react";
import { Hammer, Sparkles } from "lucide-react";

import { MainScreenWrapper } from "@/components/internal/shared/screen_wrappers";
import { ScreenHeader } from "@/components/internal/shared/screen_kit";

/**
 * Fallback screen for nav items that don't yet have a dedicated screen wired
 * into the registry. Intentionally designed (not blank) so the workspace looks
 * complete while screens are filled in area by area.
 */
export function ComingSoonScreen({ title = "Screen", description, icon }) {
  return (
    <MainScreenWrapper>
      <ScreenHeader
        title={title}
        description={
          description ||
          `The ${title} screen is part of the Geiger Grey roadmap and will be built out next.`
        }
      />

      <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-border bg-background px-6 py-20 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-surface-subtle text-muted-foreground">
          <Hammer className="h-6 w-6" />
        </div>
        <div className="space-y-1.5">
          <p className="text-base font-semibold text-foreground">
            {title} is on the way
          </p>
          <p className="mx-auto max-w-md text-sm text-text-secondary">
            This area is scaffolded into the navigation. Its dedicated tools,
            tables, and dialogs are being implemented one area at a time to keep
            the experience consistent across the suite.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-subtle px-3 py-1 text-xs font-medium text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" />
          Coming soon
        </span>
      </div>
    </MainScreenWrapper>
  );
}

export default ComingSoonScreen;
