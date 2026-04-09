'use client';

import type { StorageThreadType } from '@mastra/core/memory';
import type { UIMessage } from 'ai';
import { FolderIcon, MessageSquareIcon, MessagesSquareIcon } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

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
  const threadId = searchParams.get('thread') ?? undefined;

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
         * Re-mount the chat surface when the selected thread changes
         * so the runtime is rebuilt with the new id + initial
         * messages. The runtime is created once per `useChatRuntime`
         * call and Phase 1 doesn't need a swap-in-place model.
         */}
        <AgentChat
          key={threadId ?? '__new__'}
          agentId={agentId}
          threadId={threadId}
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
