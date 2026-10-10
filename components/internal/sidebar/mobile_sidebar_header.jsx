"use client";

import React, { useState } from "react";
import { SidebarHeader, useSidebar } from "@geiger/ui/sidebar";
import { BASE_PATH } from "@/lib/base_path";

function LogoMark({ className }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <div className="w-2 h-2 bg-foreground rounded-full" />;
  }
  return (
    <img
      src={`${BASE_PATH}/logo1.svg`}
      alt=""
      className={className}
      onError={() => setFailed(true)}
    />
  );
}

export function MobileSidebarHeader() {
  const { isMobile } = useSidebar();

  if (!isMobile) {
    return null;
  }

  return (
    <SidebarHeader className="p-0 border-b border-sidebar-border">
      <div className="flex items-center justify-between px-4 h-14">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded flex items-center justify-center shrink-0">
            <LogoMark className="w-5 h-5" />
          </div>
          <span className="text-foreground font-semibold text-sm truncate max-w-full">
            Grey
          </span>
        </div>
      </div>
    </SidebarHeader>
  );
}

export default MobileSidebarHeader;
