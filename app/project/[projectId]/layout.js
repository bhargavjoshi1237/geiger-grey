// Server segment-config shell: the chrome is a client component (can't export
// `dynamic` itself), so this just force-statics it — nothing here reads the
// request, and project/session/screen data all resolve client-side.
import ProjectWorkspaceLayout from "./workspace_layout";

export const dynamic = "force-static";

export default function ProjectLayout({ children }) {
  return <ProjectWorkspaceLayout>{children}</ProjectWorkspaceLayout>;
}
