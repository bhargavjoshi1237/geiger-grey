"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ComingSoonScreen } from "@/components/internal/screens/coming_soon";
import { getScreen, firstSubItemOf } from "@/components/internal/screens/registry";
import { workspaceNav } from "@/components/internal/sidebar/sidebar_nav";
import { useWorkspaceUrl } from "@/lib/hooks/use-workspace-url";
import { useProject, pickDefaultProjectId } from "@/context/project-context";
import { LoadingArea, NoProjectsState } from "@/components/internal/workspace/workspace_states";

function ScreenArea({ activeItem, Screen }) {
  const router = useRouter();
  const { project, projects, loading } = useProject();

  useEffect(() => {
    if (loading || project) return;
    const fallback = pickDefaultProjectId(projects);
    if (fallback) router.replace(`/project/${fallback}`);
  }, [loading, project, projects, router]);

  if (loading) return <LoadingArea />;
  if (projects.length === 0) return <NoProjectsState />;
  if (!project) return <LoadingArea />;

  return (
    <div key={project.id} className="h-full">
      {Screen ? (
        <Screen />
      ) : (
        <ComingSoonScreen title={activeItem.title} icon={activeItem.icon} />
      )}
    </div>
  );
}

export default function ProjectWorkspacePage() {
  const { tab: currentTab } = useWorkspaceUrl();
  // A section-level tab (e.g. "Knowledge Bases") highlights/announces as its
  // first sub-item ("All Knowledge Bases"), same as the sidebar.
  const resolvedTab = firstSubItemOf(currentTab) ?? currentTab;

  const findActiveItem = () => {
    for (const item of workspaceNav) {
      if (item.title === resolvedTab) return item;
      const sub = item.subItems?.find((s) => s.title === resolvedTab);
      if (sub) return sub;
    }
    return workspaceNav[0] || { title: "Overview" };
  };

  return (
    <ScreenArea activeItem={findActiveItem()} Screen={getScreen(currentTab)} />
  );
}
