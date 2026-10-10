"use client";

import React, { useMemo } from "react";

import { EditorSectionHeader } from "@/components/internal/shared/screen_kit";
import { CopyBlock } from "@/components/internal/shared/copy_block";
import { Badge } from "@geiger/ui/badge";
import { Switch } from "@geiger/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@geiger/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@geiger/ui/tabs";
import { BASE_PATH } from "@/lib/base_path";

import { MCP_TOOL_DEFS } from "./constants";

function serverConfigSnippet(serverUrl, name) {
  const slug = (name || "grey").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "grey";
  return JSON.stringify(
    {
      mcpServers: {
        [slug]: {
          url: serverUrl,
          headers: { Authorization: "Bearer <YOUR_API_KEY>" },
        },
      },
    },
    null,
    2,
  );
}

// Read-only detail sheet for one MCP server: the URL and client snippets
// people paste into Claude Desktop or Cursor to connect to it, plus the
// enable/disable switch for taking it offline without deleting it.
export function McpServerDetailSheet({
  server,
  pipelineName,
  kbNames,
  apiKeyLabel,
  canManage,
  onOpenChange,
  onToggleStatus,
}) {
  const serverUrl = useMemo(() => {
    if (!server) return "";
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}${BASE_PATH}/api/mcp/${server.id}`;
  }, [server]);

  const snippet = useMemo(
    () => (server ? serverConfigSnippet(serverUrl, server.name) : ""),
    [server, serverUrl],
  );

  return (
    <Sheet open={!!server} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {server ? (
          <>
            <SheetHeader>
              <SheetTitle>{server.name}</SheetTitle>
              <SheetDescription>
                Pipeline: {pipelineName || "—"} · Knowledge bases: {kbNames?.length ? kbNames.join(", ") : "None"}
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-6 px-4 pb-6">
              <EditorSectionHeader
                title="Status"
                description={server.status === "enabled" ? "Accepting MCP connections." : "Disabled — clients will be rejected."}
                action={
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={server.status === "enabled"}
                      disabled={!canManage}
                      onCheckedChange={() => onToggleStatus(server)}
                    />
                  </div>
                }
              />

              <div className="space-y-2">
                <EditorSectionHeader title="Server URL" />
                <CopyBlock value={serverUrl} label="MCP endpoint" />
              </div>

              <div className="space-y-2">
                <EditorSectionHeader
                  title="Tools"
                  description="Enabled on this server."
                />
                <div className="flex flex-wrap gap-1.5">
                  {MCP_TOOL_DEFS.filter((t) => server.tools?.[t.key]).map((t) => (
                    <Badge key={t.key} variant="outline">
                      {t.label}
                    </Badge>
                  ))}
                  {!MCP_TOOL_DEFS.some((t) => server.tools?.[t.key]) ? (
                    <span className="text-sm text-text-secondary">No tools enabled.</span>
                  ) : null}
                </div>
              </div>

              <div className="space-y-2">
                <EditorSectionHeader
                  title="Connect a client"
                  description={`Authenticated with ${apiKeyLabel || "no key selected"}.`}
                />
                <Tabs defaultValue="claude">
                  <TabsList>
                    <TabsTrigger value="claude">Claude Desktop</TabsTrigger>
                    <TabsTrigger value="cursor">Cursor</TabsTrigger>
                  </TabsList>
                  <TabsContent value="claude" className="space-y-2">
                    <p className="text-xs text-text-secondary">
                      Add this to <code className="font-mono">claude_desktop_config.json</code>.
                    </p>
                    <CopyBlock value={snippet} label="Claude Desktop config" multiline />
                  </TabsContent>
                  <TabsContent value="cursor" className="space-y-2">
                    <p className="text-xs text-text-secondary">
                      Add this to <code className="font-mono">.cursor/mcp.json</code>.
                    </p>
                    <CopyBlock value={snippet} label="Cursor config" multiline />
                  </TabsContent>
                </Tabs>
              </div>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

export default McpServerDetailSheet;
