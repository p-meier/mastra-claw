'use client';

import {
  ChevronRightIcon,
  FileIcon,
  FilePlusIcon,
  FolderIcon,
  HomeIcon,
  Loader2Icon,
  RefreshCwIcon,
  TrashIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';

/**
 * Workspace browser — minimal file explorer for the per-(user, agent)
 * S3 workspace. Two-pane layout:
 *
 *  - Left: directory listing of the current path with breadcrumbs.
 *  - Right: text content of the selected file (read-only in Phase 1).
 *
 * Backed by `/api/agents/[id]/workspace` (list) and
 * `/api/agents/[id]/workspace/file` (read/write/delete). Server-side
 * path-traversal guards live in `workspace-service.ts`.
 */
type WorkspaceEntry = {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number | null;
};

type ListResponse = {
  path: string;
  entries: WorkspaceEntry[];
};

type FileResponse = {
  path: string;
  content: string;
  size: number;
};

export type WorkspaceBrowserProps = {
  agentId: string;
};

export function WorkspaceBrowser({ agentId }: WorkspaceBrowserProps) {
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileResponse | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const baseUrl = useMemo(
    () => `/api/agents/${encodeURIComponent(agentId)}/workspace`,
    [agentId],
  );

  const refresh = useCallback(
    async (next?: string) => {
      const target = next ?? currentPath;
      setLoadingList(true);
      setError(null);
      try {
        const res = await fetch(
          `${baseUrl}?path=${encodeURIComponent(target)}`,
        );
        if (!res.ok) {
          const { error: msg } = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(msg ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as ListResponse;
        setEntries(data.entries);
        setCurrentPath(target);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load');
        setEntries([]);
      } finally {
        setLoadingList(false);
      }
    },
    [baseUrl, currentPath],
  );

  useEffect(() => {
    void refresh('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  const openFile = useCallback(
    async (relativePath: string) => {
      setLoadingFile(true);
      setError(null);
      try {
        const res = await fetch(
          `${baseUrl}/file?path=${encodeURIComponent(relativePath)}`,
        );
        if (!res.ok) {
          const { error: msg } = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(msg ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as FileResponse;
        setSelectedFile(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to read file');
      } finally {
        setLoadingFile(false);
      }
    },
    [baseUrl],
  );

  const handleEntryClick = (entry: WorkspaceEntry) => {
    if (entry.type === 'directory') {
      void refresh(entry.path);
    } else {
      void openFile(entry.path);
    }
  };

  const handleNewFile = useCallback(async () => {
    if (mutating) return;
    const name = window.prompt('New file name (relative to current path):');
    if (!name) return;
    const target = currentPath ? `${currentPath}/${name}` : name;
    setError(null);
    setMutating(true);
    try {
      const res = await fetch(
        `${baseUrl}/file?path=${encodeURIComponent(target)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'text/plain' },
          body: '',
        },
      );
      if (!res.ok) {
        const { error: msg } = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(msg ?? `HTTP ${res.status}`);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create');
    } finally {
      setMutating(false);
    }
  }, [baseUrl, currentPath, mutating, refresh]);

  const handleDelete = useCallback(
    async (relativePath: string) => {
      if (mutating) return;
      if (!window.confirm(`Delete ${relativePath}?`)) return;
      setError(null);
      setMutating(true);
      try {
        const res = await fetch(
          `${baseUrl}/file?path=${encodeURIComponent(relativePath)}`,
          { method: 'DELETE' },
        );
        if (!res.ok) {
          const { error: msg } = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(msg ?? `HTTP ${res.status}`);
        }
        if (selectedFile?.path === relativePath) setSelectedFile(null);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete');
      } finally {
        setMutating(false);
      }
    },
    [baseUrl, mutating, refresh, selectedFile?.path],
  );

  const breadcrumbs = useMemo(() => {
    if (!currentPath) return [];
    const parts = currentPath.split('/').filter(Boolean);
    return parts.map((part, idx) => ({
      name: part,
      path: parts.slice(0, idx + 1).join('/'),
    }));
  }, [currentPath]);

  return (
    <div className="grid h-full grid-cols-1 md:grid-cols-[320px_1fr]">
      {/* Left: file tree */}
      <aside className="flex min-h-0 flex-col border-r">
        <div className="flex items-center gap-1 border-b px-3 py-2">
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            onClick={() => void refresh('')}
            aria-label="Workspace root"
          >
            <HomeIcon className="size-4" />
          </Button>
          <div className="text-muted-foreground flex min-w-0 flex-1 items-center gap-1 truncate text-xs">
            {breadcrumbs.length === 0 ? (
              <span>workspace root</span>
            ) : (
              breadcrumbs.map((crumb, i) => (
                <span key={crumb.path} className="flex items-center gap-1">
                  <ChevronRightIcon className="size-3" />
                  <button
                    type="button"
                    className="hover:text-foreground truncate"
                    onClick={() => void refresh(crumb.path)}
                  >
                    {crumb.name}
                  </button>
                  {i === breadcrumbs.length - 1 ? null : null}
                </span>
              ))
            )}
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            onClick={() => void refresh()}
            aria-label="Refresh"
          >
            <RefreshCwIcon className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            onClick={handleNewFile}
            disabled={mutating}
            aria-label="New file"
          >
            <FilePlusIcon className="size-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {loadingList ? (
            <div className="text-muted-foreground flex items-center gap-2 px-3 py-4 text-xs">
              <Loader2Icon className="size-3 animate-spin" />
              Loading…
            </div>
          ) : entries.length === 0 ? (
            <p className="text-muted-foreground px-3 py-4 text-xs">
              Empty directory.
            </p>
          ) : (
            <ul className="flex flex-col">
              {entries.map((entry) => (
                <li key={entry.path} className="group flex items-center">
                  <button
                    type="button"
                    onClick={() => handleEntryClick(entry)}
                    className="hover:bg-muted flex flex-1 items-center gap-2 px-3 py-1.5 text-left text-sm"
                  >
                    {entry.type === 'directory' ? (
                      <FolderIcon className="text-muted-foreground size-4 shrink-0" />
                    ) : (
                      <FileIcon className="text-muted-foreground size-4 shrink-0" />
                    )}
                    <span className="truncate">{entry.name}</span>
                  </button>
                  {entry.type === 'file' ? (
                    <button
                      type="button"
                      onClick={() => void handleDelete(entry.path)}
                      className="text-muted-foreground hover:text-destructive mr-2 hidden size-7 items-center justify-center group-hover:flex"
                      aria-label={`Delete ${entry.name}`}
                    >
                      <TrashIcon className="size-3.5" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* Right: file viewer */}
      <section className="flex min-h-0 flex-col">
        {error ? (
          <div className="bg-destructive/10 text-destructive border-b px-4 py-2 text-xs">
            {error}
          </div>
        ) : null}

        {loadingFile ? (
          <div className="text-muted-foreground flex flex-1 items-center justify-center gap-2 text-sm">
            <Loader2Icon className="size-4 animate-spin" />
            Loading file…
          </div>
        ) : selectedFile ? (
          <>
            <div className="flex items-center justify-between border-b px-4 py-2">
              <p className="truncate text-sm font-medium">{selectedFile.path}</p>
              <p className="text-muted-foreground text-xs">
                {selectedFile.size} bytes
              </p>
            </div>
            <pre className="min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-xs whitespace-pre-wrap">
              {selectedFile.content}
            </pre>
          </>
        ) : (
          <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
            Select a file to view its contents.
          </div>
        )}
      </section>
    </div>
  );
}
