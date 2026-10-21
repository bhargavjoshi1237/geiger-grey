import {
  LayoutDashboard,
  Library,
  Database,
  FileStack,
  ListChecks,
  SlidersHorizontal,
  Network,
  Waypoints,
  Shapes,
  Tags,
  MessagesSquare,
  MessageCircle,
  History,
  ScanSearch,
  Workflow,
  GitBranch,
  Cpu,
  Send,
  KeyRound,
  Plug,
  PanelBottom,
  ShieldCheck,
  FlaskConical,
  ThumbsUp,
  Gauge,
  CircleDollarSign,
  ScrollText,
  Settings,
  Settings2,
  Users,
  ShieldUser,
  PanelLeft,
  Download,
} from "lucide-react";

import { NAV_TREE } from "@/lib/workspace/nav_tree";

// Maps the icon *names* in nav_tree.js to the lucide-react components. Keep
// this list in sync with nav_tree.js whenever a section or sub-item changes.
const ICONS = {
  LayoutDashboard,
  Library,
  Database,
  FileStack,
  ListChecks,
  SlidersHorizontal,
  Network,
  Waypoints,
  Shapes,
  Tags,
  MessagesSquare,
  MessageCircle,
  History,
  ScanSearch,
  Workflow,
  GitBranch,
  Cpu,
  Send,
  KeyRound,
  Plug,
  PanelBottom,
  ShieldCheck,
  FlaskConical,
  ThumbsUp,
  Gauge,
  CircleDollarSign,
  ScrollText,
  Settings,
  Settings2,
  Users,
  ShieldUser,
  PanelLeft,
  Download,
};

function withIcons(item) {
  return {
    ...item,
    icon: ICONS[item.icon],
    ...(item.subItems ? { subItems: item.subItems.map(withIcons) } : null),
  };
}

// Sidebar navigation for Geiger Grey — mirrors the nav tree in
// docs/superpowers/specs/2026-10-10-grey-frontend-design.md §1.
export const workspaceNav = NAV_TREE.map(withIcons);
