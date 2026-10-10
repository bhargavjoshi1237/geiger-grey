"use client";

import { useEffect, useMemo, useState } from "react";

import { MainScreenWrapper } from "@/components/internal/shared/screen_wrappers";
import { ScreenHeader, StatsBar } from "@/components/internal/shared/screen_kit";
import { useProject } from "@/context/project-context";
import { listSources } from "@/lib/supabase/sources";

import { SourcesTable } from "./sources_table";
import { freshnessOf } from "./constants";

// Cross-KB Sources screen: header + stats wrap the self-contained
// SourcesTable (toolbar, table, upload dialog and detail Sheet all live
// there so it can also be embedded in a Knowledge Base's detail page).
export function SourcesScreen() {
  const { projectId } = useProject();
  const [sources, setSources] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    listSources(projectId).then((rows) => {
      if (!alive) return;
      setSources(rows ?? []);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [projectId]);

  const stats = useMemo(() => {
    const ready = sources.filter((s) => s.status === "ready").length;
    const inProgress = sources.filter(
      (s) => s.status === "queued" || s.status === "processing",
    ).length;
    const needsReview = sources.filter((s) => {
      const key = freshnessOf(s);
      return key === "stale" || key === "review_due";
    }).length;
    return [
      { label: "Sources", value: loaded ? String(sources.length) : "" },
      { label: "Ready", value: loaded ? String(ready) : "" },
      { label: "In progress", value: loaded ? String(inProgress) : "" },
      { label: "Needs review", value: loaded ? String(needsReview) : "" },
    ];
  }, [sources, loaded]);

  return (
    <MainScreenWrapper>
      <ScreenHeader
        title="Sources"
        description="Every file, page, and media source across your knowledge bases — upload, import, and manage ingestion from one place."
      />
      <StatsBar stats={stats} />
      <SourcesTable projectId={projectId} />
    </MainScreenWrapper>
  );
}

export default SourcesScreen;
