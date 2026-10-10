"use client";

import React, { useMemo, useState } from "react";
import { toast } from "sonner";
import { Info } from "lucide-react";
import { NavVisibilitySettings, navVisibilityModel, LoadingArea } from "@geiger/ui";

import { MainScreenWrapper } from "@/components/internal/shared/screen_wrappers";
import { ScreenHeader, StatsBar } from "@/components/internal/shared/screen_kit";
import { useCuratableNav } from "@/lib/hooks/use-visible-nav";
import { useNavVisibility } from "@/context/nav-visibility-context";
import navConfig from "@/geiger-ui.config";

// Settings → Navigation. Lets this user hide the parts of the sidebar they
// don't use, for this project only — it's a personal preference, stored per
// (project, user) in the suite-shared public.user_nav_prefs table, so
// teammates keep their own sidebar and every Geiger product reads the same row.
//
// The rules are declared in geiger-ui.config.js and enforced by @geiger/ui's
// <NavVisibilitySettings>: a switch that would leave a visible screen without
// something it needs is disabled and explains why. This screen owns the
// frame, the KPI row and the toasts; the two-pane curation surface is the
// library's.

export function NavigationSettingsScreen() {
  const nav = useCuratableNav();
  const { hidden, loading, setHidden, reset } = useNavVisibility();
  const [busy, setBusy] = useState(false);

  const stats = useMemo(() => {
    const { sections } = navVisibilityModel({ nav, hidden, config: navConfig });
    const shownSections = sections.filter((s) => !s.hidden).length;
    const screens = sections.flatMap((s) => s.subItems);
    const shownScreens = screens.filter((s) => !s.hidden).length;
    const entries = [...sections, ...screens];
    const locked = entries.filter((e) => e.locked).length;
    const hiddenCount = entries.filter((e) => e.hidden).length;

    return [
      {
        label: "Sections",
        value: String(shownSections),
        footer: `of ${sections.length} in your sidebar`,
      },
      {
        label: "Screens",
        value: String(shownScreens),
        footer: `of ${screens.length} across every section`,
      },
      {
        label: "Hidden",
        value: String(hiddenCount),
        footer: hiddenCount ? "Tucked away by you" : "You're seeing everything",
      },
      {
        label: "Always on",
        value: String(locked),
        footer: "The spine of the workspace",
      },
    ];
  }, [nav, hidden]);

  const handleToggle = async (title, nextHidden) => {
    setBusy(true);
    const result = await setHidden(title, nextHidden);
    setBusy(false);
    const ok = result === true || result?.ok;
    if (ok) toast.success(`${title} ${nextHidden ? "hidden" : "shown"}`);
    else toast.error(result?.reason || `Couldn't ${nextHidden ? "hide" : "show"} ${title}.`);
  };

  const handleReset = async () => {
    setBusy(true);
    const ok = await reset();
    setBusy(false);
    if (ok) toast.success("Every section is back in the sidebar");
    else toast.error("Couldn't reset your navigation settings.");
  };

  const header = (
    <ScreenHeader
      title="Navigation"
      description="Choose which sections appear in your sidebar."
    />
  );

  if (loading) {
    return (
      <MainScreenWrapper>
        {header}
        <LoadingArea label="Loading your navigation" />
      </MainScreenWrapper>
    );
  }

  return (
    <MainScreenWrapper>
      {header}

      <StatsBar stats={stats} />

      <div className="flex items-start gap-2.5 rounded-lg border border-border bg-surface-card px-3.5 py-2.5 text-xs leading-relaxed text-text-secondary">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-tertiary" />
        <p>
          This is personal to you — teammates on this project keep their own
          sidebar. A section another visible screen depends on can&apos;t be
          hidden; its switch explains why.
        </p>
      </div>

      <NavVisibilitySettings
        nav={nav}
        config={navConfig}
        hidden={hidden}
        busy={busy}
        onToggle={handleToggle}
        onReset={handleReset}
      />
    </MainScreenWrapper>
  );
}

export default NavigationSettingsScreen;
