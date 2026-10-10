"use client";

import React from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@geiger/ui/sidebar";
import { PanelLeft } from "lucide-react";
import { SidebarOption } from "./sidebar_option";
import { MobileSidebarHeader } from "./mobile_sidebar_header";
import { Button } from "@geiger/ui/button";
import { Skeleton } from "@geiger/ui/skeleton";
import { cn } from "@/lib/utils";
import { useNavLoading, useVisibleNav } from "@/lib/hooks/use-visible-nav";
import { useIdleRecenter } from "@/lib/hooks/use-idle-recenter";

const SIDEBAR_SCROLL_ID = "workspace-sidebar-scroll";
let savedSidebarScroll = 0;

const SKELETON_WIDTHS = [
  "w-24", "w-16", "w-28", "w-20", "w-32", "w-16",
  "w-24", "w-20", "w-28", "w-16", "w-24", "w-20",
];

function SidebarNavSkeleton() {
  return SKELETON_WIDTHS.map((width, i) => (
    <SidebarMenuItem
      key={i}
      aria-hidden="true"
      className="flex h-9 items-center gap-3 rounded-md px-2 group-data-[collapsible=icon]:justify-center"
    >
      <Skeleton className="h-4 w-4 shrink-0 rounded bg-sidebar-foreground/10" />
      <Skeleton
        className={cn(
          "h-2.5 rounded bg-sidebar-foreground/10 group-data-[collapsible=icon]:hidden",
          width,
        )}
      />
    </SidebarMenuItem>
  ));
}

export function AppSidebar({ activeTab = "Overview", onTabChange = () => {} }) {
  const { toggleSidebar, state } = useSidebar();
  const [expandedItems, setExpandedItems] = React.useState({});
  const { ref: navRef } = useIdleRecenter(activeTab);

  React.useLayoutEffect(() => {
    const el = document.getElementById(SIDEBAR_SCROLL_ID);
    if (el) el.scrollTop = savedSidebarScroll;
  }, []);
  const handleSidebarScroll = (e) => {
    savedSidebarScroll = e.currentTarget.scrollTop;
  };

  const visibleNav = useVisibleNav();
  const navLoading = useNavLoading();

  const toggleExpand = (title) => {
    setExpandedItems((prev) => ({
      ...prev,
      [title]: !prev[title],
    }));
  };

  return (
    <Sidebar
      collapsible="icon"
      className="bg-sidebar border-r border-sidebar-border text-sidebar-foreground"
    >
      <MobileSidebarHeader />
      <SidebarContent
        ref={navRef}
        id={SIDEBAR_SCROLL_ID}
        onScroll={handleSidebarScroll}
        className="py-1 space-y-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navLoading && <SidebarNavSkeleton />}
              {!navLoading && visibleNav.map((item) => (
                <SidebarOption
                  key={item.title}
                  title={item.title}
                  icon={item.icon}
                  isActive={activeTab === item.title}
                  badge={item.badge}
                  subItems={item.subItems || null}
                  isExpanded={
                    expandedItems[item.title] !== undefined
                      ? expandedItems[item.title]
                      : !!item.subItems?.some((sub) => sub.title === activeTab)
                  }
                  onToggle={() => toggleExpand(item.title)}
                  activeSubTab={activeTab}
                  onClick={(subTitle) =>
                    onTabChange(
                      typeof subTitle === "string" ? subTitle : item.title,
                    )
                  }
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-2 border-t border-sidebar-border mt-auto">
        <Button
          type="button"
          variant="ghost"
          aria-label={state === "collapsed" ? "Expand sidebar" : "Collapse sidebar"}
          onClick={toggleSidebar}
          className="flex items-center gap-3 p-2 w-full rounded-lg hover:bg-sidebar-accent transition-all text-sidebar-foreground hover:text-foreground group-data-[collapsible=icon]:justify-center"
        >
          <PanelLeft className="w-5 h-5 shrink-0" />
        </Button>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
