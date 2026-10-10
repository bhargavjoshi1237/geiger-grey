"use client";

import React from "react";
import { Topbar as SuiteTopbar } from "@geiger/ui";
import { SidebarTrigger } from "@geiger/ui/sidebar";
import { NotificationsBell } from "./notifications_bell";
import { ProfileDropdown } from "./profile_dropdown";
import { useWorkspaceUrl } from "@/lib/hooks/use-workspace-url";
import { useVisibleNav } from "@/lib/hooks/use-visible-nav";
import { BASE_PATH } from "@/lib/base_path";

export function Topbar() {
  const { setTab } = useWorkspaceUrl();
  const visibleNav = useVisibleNav();

  return (
    <SuiteTopbar
      label="Grey"
      logoSrc={`${BASE_PATH}/logo1.svg`}
      homeHref={BASE_PATH || "/"}
      helpHref="/docs"
      searchPlaceholder="Search Grey..."
      searchNav={visibleNav}
      searchRecentsKey="geiger:grey:search-recents"
      onSearchSelect={(item) => setTab(item.title)}
      sidebarTrigger={
        <SidebarTrigger className="md:hidden -ml-2 text-foreground" />
      }
      notifications={<NotificationsBell />}
      profile={<ProfileDropdown />}
    />
  );
}
