"use client";

import React from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@geiger/ui/tooltip";

// Wraps a primary action button and disables it (with a reason tooltip) when
// the viewer lacks the permission — rather than hiding it outright, so the
// gate itself is visible. The disabled button is wrapped in a focusable span
// because a disabled element never fires the hover/focus events Tooltip needs.
export function GatedAction({ allowed, reason, children }) {
  if (allowed) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex cursor-not-allowed">
          <span className="pointer-events-none opacity-50">{children}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

export default GatedAction;
