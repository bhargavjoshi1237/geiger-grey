"use client";

import React from "react";
import { applyNavVisibility } from "@geiger/ui";

import { workspaceNav } from "@/components/internal/sidebar/sidebar_nav";
import { useNavVisibility } from "@/context/nav-visibility-context";
import { useRbac } from "@/context/rbac-context";
import { tabPermissionKey } from "@/lib/rbac";

// Grey has no addons: the curatable set is just the static workspace nav,
// filtered down to what this user's roles permit.
export function useCuratableNav() {
  const { can } = useRbac();

  return React.useMemo(
    () => workspaceNav.filter((item) => can(tabPermissionKey(item.title))),
    [can],
  );
}

export function useVisibleNav() {
  const curatable = useCuratableNav();
  const { hidden, config } = useNavVisibility();

  return React.useMemo(
    () => applyNavVisibility(curatable, hidden, config),
    [curatable, hidden, config],
  );
}

export function useNavLoading() {
  const { loading: rbacLoading } = useRbac();
  const { loading: visibilityLoading } = useNavVisibility();

  return rbacLoading || visibilityLoading;
}

export default useVisibleNav;
