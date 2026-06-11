"use client";

import React from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  className
}) {
  return (
    <div className={cn(
      "flex flex-col items-center justify-center p-12 text-center rounded-2xl border border-dashed border-border bg-background/50",
      className
    )}>
      {icon && (
        <div className="mb-6">
          {icon}
        </div>
      )}
      
      <h3 className="text-xl font-semibold text-foreground mb-2">
        {title}
      </h3>
      
      <p className="text-muted-foreground text-base mb-8 max-w-sm">
        {description}
      </p>

      {actionLabel && (
        <Button 
          onClick={onAction}
          className="bg-primary hover:bg-primary/90 text-primary-foreground px-3 py-3 rounded-xl text-md font-medium flex items-center gap-2 transition-colors"
        >
          <Plus className="w-5 h-5 text-primary-foreground font-bold stroke-[3]" />
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
