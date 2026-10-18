"use client";

import { ChevronDown } from "lucide-react";
import { Button } from "@geiger/ui/button";
import { Card, CardContent } from "@geiger/ui/card";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@geiger/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { CHART_THEME_VARS } from "./constants";

export function WidgetShell({ children, className, contentClassName }) {
  return (
    <Card
      className={cn(
        "bg-surface-subtle border-border text-foreground rounded-xl py-0 gap-0 overflow-hidden h-full",
        CHART_THEME_VARS,
        className,
      )}
    >
      <CardContent className={cn("p-4 h-full", contentClassName)}>{children}</CardContent>
    </Card>
  );
}

export function WidgetHeader({ title, subtitle, action }) {
  return (
    <div className="flex w-full items-start justify-between gap-3">
      <div className="flex min-w-0 flex-1 flex-col">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

// Multi-select scope filter (pipelines, knowledge bases…); an empty selection means "all".
export function ScopeSelect({ items, selected, onChange, icon: Icon, allLabel, noun }) {
  const all = selected.length === 0;
  const clip = (s) => (s.length > 5 ? `${s.slice(0, 5)}…` : s);
  const label = all
    ? "All"
    : selected.length === 1
      ? clip(items.find((item) => item.id === selected[0])?.name || `1 ${noun}`)
      : `${selected.length} ${noun}s`;

  const toggle = (id) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="h-9 gap-2 border-border bg-surface-card text-foreground hover:bg-surface-active"
          disabled={!items.length}
        >
          <Icon className="h-4 w-4 text-muted-foreground" />
          <span className="max-w-[160px] truncate">{label}</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-72 w-56 overflow-y-auto border-border bg-surface-subtle"
      >
        <DropdownMenuCheckboxItem
          checked={all}
          onCheckedChange={() => onChange([])}
          onSelect={(e) => e.preventDefault()}
        >
          {allLabel}
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator className="bg-border" />
        {items.map((item) => (
          <DropdownMenuCheckboxItem
            key={item.id}
            checked={selected.includes(item.id)}
            onCheckedChange={() => toggle(item.id)}
            onSelect={(e) => e.preventDefault()}
          >
            <span className="truncate">{item.name || `Untitled ${noun}`}</span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
