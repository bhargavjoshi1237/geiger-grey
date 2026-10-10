"use client";

import React from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@geiger/ui/tooltip";

// Wraps a permission-disabled action so it explains why. A disabled <button>
// has pointer-events: none, so Radix's tooltip never sees the hover — the
// trigger has to be a plain, always-interactive span around it instead.
// Enabled actions pass straight through with no wrapper.
export function PermissionTooltip({ disabled, reason, children }) {
  if (!disabled) return children;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="inline-flex">
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent>{reason}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default PermissionTooltip;
