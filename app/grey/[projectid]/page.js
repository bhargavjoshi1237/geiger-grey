import { AppSidebar } from "@/components/internal/sidebar/sidebar";
import { Topbar } from "@/components/internal/topbar/topbar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { KnowledgeGraph } from "@/components/grey/knowledge-graph";
import { createClient } from "@/utils/supabase/server";

export default async function GreyProjectPage({ params }) {
  const { projectid } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-[#161616] font-sans text-[#ededed] selection:bg-[#333333]">
      <SidebarProvider className="flex-col !flex h-full min-w-0" style={{ flexDirection: "column" }}>
        <Topbar />
        <div className="relative flex flex-1 overflow-hidden">
          <AppSidebar activeTab="Knowledge graph" />
          <SidebarInset className="relative flex h-full flex-1 flex-col overflow-hidden border-none bg-transparent">
            <KnowledgeGraph
              projectId={projectid}
              user={{
                id: user?.id || null,
                email: user?.email || null,
                name:
                  user?.user_metadata?.full_name ||
                  user?.user_metadata?.name ||
                  user?.email?.split("@")[0] ||
                  "Guest",
              }}
            />
          </SidebarInset>
        </div>
      </SidebarProvider>
    </div>
  );
}
