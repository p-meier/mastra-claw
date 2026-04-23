'use client';

import type { StorageThreadType } from '@mastra/core/memory';
import type { UIMessage } from 'ai';
import { FolderIcon, MessageSquareIcon, MessagesSquareIcon } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';

import { AgentChat } from '@/components/agent/agent-chat';
import { ThreadsList } from '@/components/agent/threads-list';
import { WorkspaceBrowser } from '@/components/agent/workspace-browser';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

/**
 * Tab shell for the agent detail page. Three tabs:
 *
 *  - Chat — the live conversation surface (Assistant UI runtime)
 *  - Workspace — S3-backed file browser (Phase 1: placeholder)
 *  - Conversations — prior threads list with "New conversation"
 *
 * The active tab and the selected thread are reflected in the URL
 * (`?tab=...&thread=...`) so deep links and back/forward navigation
 * work as expected.
 */
export type AgentTabsProps = {
  agentId: string;
  initialThreads: StorageThreadType[];
  initialMessages: UIMessage[];
};

export function AgentTabs({
  agentId,
  initialThreads,
  initialMessages,
}: AgentTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = searchParams.get('tab') ?? 'chat';
  const threadIdFromUrl = searchParams.get('thread') ?? undefined;

  // Stable client-generated thread id used when the URL has no
  // `?thread=` param (i.e. the user is starting a fresh conversation
  // from the agent landing).
  //
  // **Why we need this.** The chat route generates a fresh
  // `chat_<userId>_<Date.now()>` id whenever `body.threadId` is
  // missing. Without a stable id, every request — including the
  // tool-approval resume rewrite from `MastraChatTransport` — would
  // get a brand-new thread, so the resume would target an empty
  // workflow snapshot. By pinning the id here and threading it
  // through `<AgentChat>` into the transport's static body, every
  // outgoing request in the session targets the same Mastra thread.
  //
  // The id is initialised once per `AgentTabs` mount via the
  // `useState` lazy initialiser, so it survives re-renders. When
  // the URL already carries a `?thread=` (e.g. the user clicked
  // into an existing conversation), we ignore the generated id
  // entirely and use the URL value instead.
  const [generatedThreadId] = useState(() => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return `chat_${crypto.randomUUID()}`;
    }
    return `chat_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  });
  const effectiveThreadId = threadIdFromUrl ?? generatedThreadId;

  const handleTabChange = useCallback(
    (value: string) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set('tab', value);
      router.replace(
        `/agents/${encodeURIComponent(agentId)}?${next.toString()}`,
        { scroll: false },
      );
    },
    [agentId, router, searchParams],
  );

  return (
    <Tabs
      value={tab}
      onValueChange={handleTabChange}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="border-b px-6">
        <TabsList className="bg-transparent p-0">
          <TabsTrigger
            value="chat"
            className="data-[state=active]:border-primary rounded-none border-b-2 border-transparent px-4 py-3 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          >
            <MessageSquareIcon className="mr-2 size-4" />
            Chat
          </TabsTrigger>
          <TabsTrigger
            value="workspace"
            className="data-[state=active]:border-primary rounded-none border-b-2 border-transparent px-4 py-3 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          >
            <FolderIcon className="mr-2 size-4" />
            Workspace
          </TabsTrigger>
          <TabsTrigger
            value="conversations"
            className="data-[state=active]:border-primary rounded-none border-b-2 border-transparent px-4 py-3 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          >
            <MessagesSquareIcon className="mr-2 size-4" />
            Conversations
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent
        value="chat"
        className="min-h-0 flex-1 overflow-hidden"
        forceMount
        hidden={tab !== 'chat'}
      >
        {/*
         * Re-mount the chat surface when the selected thread
         * changes (the user clicked into a different conversation).
         * The runtime is created once per `useChatRuntime` call so
         * a key change rebuilds it from scratch with the new id +
         * initial messages. The tool-approval resume flow updates
         * the chat in place via the custom transport (see
         * `tool-approval-buttons.tsx`) so it does not need a
         * remount.
         */}
        <AgentChat
          key={effectiveThreadId}
          agentId={agentId}
          threadId={effectiveThreadId}
          initialMessages={initialMessages}
        />
      </TabsContent>

      <TabsContent
        value="workspace"
        className="min-h-0 flex-1 overflow-hidden"
        forceMount
        hidden={tab !== 'workspace'}
      >
        <WorkspaceBrowser agentId={agentId} />
      </TabsContent>

      <TabsContent
        value="conversations"
        className="min-h-0 flex-1 overflow-auto"
      >
        <ThreadsList agentId={agentId} initialThreads={initialThreads} />
      </TabsContent>
    </Tabs>
  );
}
