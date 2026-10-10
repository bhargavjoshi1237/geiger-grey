"use client";

import React from "react";
import {
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuBadge,
  useSidebar,
} from "@geiger/ui/sidebar";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import { Button } from "@geiger/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@geiger/ui/tooltip";

export function SidebarOption({
  title,
  icon: Icon,
  isActive,
  onClick,
  badge,
  className,
  subItems,
  isExpanded,
  onToggle,
  activeSubTab,
  iconColor,
}) {
  const { state, isMobile } = useSidebar();
  const isCollapsed = state === "collapsed" && !isMobile;

  const activeIconColor = iconColor || "text-foreground";
  const inactiveIconColor = iconColor || "text-sidebar-foreground/70";

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        type="button"
        onClick={subItems ? onToggle : () => onClick?.()}
        isActive={isActive}
        tooltip={title}
        aria-expanded={subItems ? Boolean(isExpanded) : undefined}
        className={cn(
          "transition-all text-sm h-9 group-data-[collapsible=icon]:justify-center",
          isActive && !subItems
            ? "bg-sidebar-accent text-foreground"
            : isExpanded
              ? "bg-sidebar-accent/40 text-sidebar-foreground"
              : "text-sidebar-foreground",
          className,
        )}
      >
        {Icon && (
          <Icon
            className={cn(
              "w-4 h-4 shrink-0 transition-colors",
              isActive
                ? activeIconColor
                : inactiveIconColor,
            )}
          />
        )}
        {!isCollapsed && <span>{title}</span>}
        {subItems && !isCollapsed && (
          <ChevronDown
            className={cn(
              "ml-auto w-4 h-4 transition-transform duration-200",
              isExpanded && "rotate-180",
            )}
          />
        )}
        {badge && !subItems && !isCollapsed && (
          <SidebarMenuBadge className="mr-2 text-muted-foreground text-[10px] px-1.5 py-0.5 rounded border border-border ml-auto">
            {badge}
          </SidebarMenuBadge>
        )}
      </SidebarMenuButton>

      {subItems && isExpanded && !isCollapsed && (
        <ul className="ml-[1px] mt-1 mb-1 flex flex-col gap-0.5 pl-2">
          {subItems.map((sub) => (
            <li key={sub.title}>
              <Button
                type="button"
                variant="ghost"
                data-active={activeSubTab === sub.title ? "true" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  onClick(sub.title);
                }}
                className={cn(
                  "relative w-full flex items-center justify-start px-2 h-[35px] rounded-md text-sm leading-none transition-colors gap-2",
                  activeSubTab === sub.title
                    ? "bg-sidebar-accent text-foreground font-medium"
                    : "text-sidebar-foreground/70 hover:text-foreground hover:bg-sidebar-accent/50",
                )}
              >
                {sub.icon && (
                  <sub.icon
                    className={cn(
                      "w-4 h-4 shrink-0 transition-colors",
                      activeSubTab === sub.title
                        ? iconColor || "text-foreground"
                        : iconColor || "text-sidebar-foreground/70",
                    )}
                  />
                )}
                <p>{sub.title}</p>
              </Button>
            </li>
          ))}
        </ul>
      )}

      {subItems && isExpanded && isCollapsed && (
        <ul className="flex flex-col gap-0.5 pt-2">
          {subItems.map((sub) => (
            <li key={sub.title}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    data-active={activeSubTab === sub.title ? "true" : undefined}
                    onClick={(e) => {
                      e.preventDefault();
                      onClick(sub.title);
                    }}
                    className={cn(
                      "relative w-full flex items-center justify-center px-2 h-[35px] rounded-md text-sm leading-none transition-colors",
                      activeSubTab === sub.title
                        ? "bg-sidebar-accent text-foreground font-medium"
                        : "text-sidebar-foreground/70 hover:text-foreground hover:bg-sidebar-accent/50",
                    )}
                  >
                    {sub.icon && (
                      <sub.icon
                        className={cn(
                          "w-4 h-4 shrink-0 transition-colors",
                          activeSubTab === sub.title
                            ? iconColor || "text-foreground"
                            : iconColor || "text-sidebar-foreground/70",
                        )}
                      />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right" align="center">
                  {sub.title}
                </TooltipContent>
              </Tooltip>
            </li>
          ))}
        </ul>
      )}
    </SidebarMenuItem>
  );
}
