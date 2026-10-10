// Server entry for the project workspace. Holds nothing but the segment config:
// the chrome itself is a client component, and route segment config cannot be
// exported from one.
//
// force-static: nothing in this subtree reads the request, so Next prerenders
// the sidebar/topbar chrome and its loading area, and the CDN serves that shell
// on every project URL. The project, session and screen data all resolve
// client-side, after the shell has already painted.

import ProjectWorkspaceLayout from "./workspace_layout";

export const dynamic = "force-static";

export default function ProjectLayout({ children }) {
  return <ProjectWorkspaceLayout>{children}</ProjectWorkspaceLayout>;
}
