"use client";

import React, { Suspense } from "react";
import { AppSidebar } from "@/components/internal/sidebar/sidebar";
import { Topbar } from "@/components/internal/topbar/topbar";
import { SidebarProvider, SidebarInset } from "@geiger/ui/sidebar";
import { useWorkspaceUrl } from "@/lib/hooks/use-workspace-url";
import { ProjectProvider } from "@/context/project-context";
import { NavVisibilityProvider } from "@/context/nav-visibility-context";
import { RbacProvider } from "@/context/rbac-context";

function WorkspaceShell({ children }) {
  const { tab, setTab } = useWorkspaceUrl();

  return (
    <div className="flex-col h-[100dvh] w-full bg-background text-foreground font-sans overflow-hidden selection:bg-surface-strong flex">
      <SidebarProvider
        className="flex-col !flex h-full min-w-0"
        style={{ flexDirection: "column" }}
      >
        <Topbar />
        <div className="flex flex-1 overflow-hidden relative">
          <AppSidebar activeTab={tab} onTabChange={setTab} />
          <SidebarInset className="flex-1 flex flex-col h-full bg-transparent overflow-hidden relative border-none">
            <div className="absolute top-0 right-0 w-[500px] h-[300px] bg-white/[0.02] blur-[120px] pointer-events-none rounded-full"></div>
            <main className="flex-1 overflow-y-auto p-4 md:p-8 relative z-10 w-full min-w-0">
              {children}
            </main>
          </SidebarInset>
        </div>
      </SidebarProvider>
    </div>
  );
}

export default function ProjectWorkspaceLayout({ children }) {
  return (
    <Suspense
      fallback={
        <div className="flex h-[100dvh] w-full items-center justify-center bg-background" />
      }
    >
      <ProjectProvider>
        <RbacProvider>
          <NavVisibilityProvider>
            <WorkspaceShell>{children}</WorkspaceShell>
          </NavVisibilityProvider>
        </RbacProvider>
      </ProjectProvider>
    </Suspense>
  );
}
