"use client";

import React, { useEffect, useState } from "react";
import { Layers } from "lucide-react";

import { EmptyState, LoadingArea } from "@/components/internal/shared/screen_kit";
import { ListPagination } from "@/components/internal/shared/pagination";
import { listChunks } from "@/lib/supabase/chunks";
import { formatDuration } from "@/lib/grey/format";

const PAGE_SIZE = 25;

function chunkLocation(chunk) {
  const parts = [];
  if (chunk.page != null) parts.push(`Page ${chunk.page}`);
  if (chunk.startMs != null) {
    const range =
      chunk.endMs != null
        ? `${formatDuration(chunk.startMs)}–${formatDuration(chunk.endMs)}`
        : formatDuration(chunk.startMs);
    parts.push(range);
  }
  return parts.join(" · ");
}

// Paginated chunk browser for a knowledge base's "Chunks" section. Chunks are
// server-paginated (lib/supabase/chunks.js returns { rows, count }), so this
// owns its own page/pageSize state instead of usePagination's client-side slice.
export function ChunkBrowser({ projectId, kbId, sourceId }) {
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);

  // Reset to page 1 whenever the kb/source filter changes — adjusting state
  // during render (React's answer to "reset on prop change"), same trick
  // usePagination uses for resetKey.
  const filterKey = `${kbId}|${sourceId}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setPage(1);
  }

  // Derived instead of a synchronous setLoading(true) in the effect below —
  // "loading" is just "the page we last fetched isn't the page we want".
  const queryKey = `${filterKey}|${page}|${pageSize}`;
  const [loadedKey, setLoadedKey] = useState(null);
  const loading = loadedKey !== queryKey;

  useEffect(() => {
    if (!projectId || !kbId) return undefined;
    let alive = true;
    listChunks(projectId, { kbId, sourceId, page, pageSize }).then((result) => {
      if (!alive) return;
      setRows(result?.rows ?? []);
      setCount(result?.count ?? 0);
      setLoadedKey(queryKey);
    });
    return () => {
      alive = false;
    };
  }, [projectId, kbId, sourceId, page, pageSize, queryKey]);

  const onPageSizeChange = (size) => {
    setPageSize(size);
    setPage(1);
  };

  if (loading) return <LoadingArea label="Loading chunks" panel />;

  if (!rows.length) {
    return (
      <div className="rounded-xl border border-border bg-surface-subtle">
        <EmptyState
          icon={Layers}
          title="No chunks yet"
          description="Chunks appear here once this knowledge base's sources finish ingestion."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {rows.map((chunk) => (
          <div
            key={chunk.id}
            className="rounded-xl border border-border bg-surface-subtle p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-text-secondary">
                {chunkLocation(chunk) || `Chunk ${chunk.ordinal ?? ""}`}
              </span>
              {chunk.tokenCount != null ? (
                <span className="text-xs text-text-tertiary">{chunk.tokenCount} tokens</span>
              ) : null}
            </div>
            {chunk.headingPath?.length ? (
              <p className="mt-1 truncate text-xs text-text-tertiary">
                {chunk.headingPath.join(" › ")}
              </p>
            ) : null}
            <p className="mt-2 line-clamp-3 text-sm text-foreground">{chunk.content}</p>
          </div>
        ))}
      </div>
      <ListPagination
        page={page}
        pageSize={pageSize}
        total={count}
        totalPages={Math.max(1, Math.ceil(count / pageSize))}
        onPageChange={setPage}
        onPageSizeChange={onPageSizeChange}
        itemLabel="chunks"
      />
    </div>
  );
}

export default ChunkBrowser;
