"use client";

import React, { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  ProjectProvider,
  useProject,
  pickDefaultProjectId,
} from "@/context/project-context";
import { LoadingArea, NoProjectsState } from "@/components/internal/workspace/workspace_states";

function ProjectResolver() {
  const router = useRouter();
  const { projects, loading } = useProject();

  useEffect(() => {
    if (loading) return;
    const id = pickDefaultProjectId(projects);
    if (id) router.replace(`/project/${id}`);
  }, [loading, projects, router]);

  if (!loading && projects.length === 0) return <NoProjectsState />;
  return <LoadingArea />;
}

export default function ProjectIndexPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-[100dvh] w-full items-center justify-center bg-background" />
      }
    >
      <ProjectProvider>
        <div className="h-[100dvh] w-full bg-background text-foreground">
          <ProjectResolver />
        </div>
      </ProjectProvider>
    </Suspense>
  );
}
