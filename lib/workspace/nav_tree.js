// Pure nav data (titles + lucide icon *names* as strings) — no JSX, so Node's
// test runner can import it directly. sidebar_nav.jsx builds the real
// `workspaceNav` (icon components) from this list.
export const NAV_TREE = [
  { title: "Overview", icon: "LayoutDashboard" },
  {
    title: "Knowledge Bases",
    icon: "Library",
    subItems: [
      { title: "All Knowledge Bases", icon: "Database" },
      { title: "Sources", icon: "FileStack" },
      { title: "Ingestion Jobs", icon: "ListChecks" },
      { title: "Ingestion Presets", icon: "SlidersHorizontal" },
    ],
  },
  {
    title: "Knowledge Graph",
    icon: "Network",
    subItems: [
      { title: "Graph Explorer", icon: "Waypoints" },
      { title: "Entities", icon: "Shapes" },
      { title: "Ontology", icon: "Tags" },
    ],
  },
  {
    title: "Playground",
    icon: "MessagesSquare",
    subItems: [
      { title: "Chat", icon: "MessageCircle" },
      { title: "Conversations", icon: "History" },
    ],
  },
  { title: "Tools", icon: "ScanSearch" },
  {
    title: "Pipelines",
    icon: "Workflow",
    subItems: [
      { title: "All Pipelines", icon: "GitBranch" },
      { title: "Model Providers", icon: "Cpu" },
    ],
  },
  {
    title: "Delivery",
    icon: "Send",
    subItems: [
      { title: "API Keys", icon: "KeyRound" },
      { title: "MCP Servers", icon: "Plug" },
      { title: "Widgets", icon: "PanelBottom" },
    ],
  },
  {
    title: "Quality",
    icon: "ShieldCheck",
    subItems: [
      { title: "Evaluations", icon: "FlaskConical" },
      { title: "Feedback", icon: "ThumbsUp" },
    ],
  },
  {
    title: "Usage",
    icon: "Gauge",
    subItems: [
      { title: "Usage & Costs", icon: "CircleDollarSign" },
      { title: "Request Logs", icon: "ScrollText" },
    ],
  },
  {
    title: "Settings",
    icon: "Settings",
    subItems: [
      { title: "General", icon: "Settings2" },
      { title: "Team & Members", icon: "Users" },
      { title: "Roles & Permissions", icon: "ShieldUser" },
      { title: "Navigation", icon: "PanelLeft" },
      { title: "Data Export", icon: "Download" },
    ],
  },
];
