'use client';

import type { StorageThreadType } from '@mastra/core/memory';
import { MessageSquareIcon, PlusIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { Button } from '@/components/ui/button';

/**
 * Conversations panel — list of prior threads for one agent, scoped to
 * the current user. Clicking a thread navigates to
 * `/agents/{agentId}?thread={threadId}` which the Chat tab picks up to
 * resume that conversation.
 *
 * "New conversation" pings `POST /api/agents/[id]/threads` for a fresh
 * id and navigates with it. Mastra creates the storage row lazily on
 * the first message, so no DB write happens until the user sends
 * something.
 */
export type ThreadsListProps = {
  agentId: string;
  initialThreads: StorageThreadType[];
};

export function ThreadsList({ agentId, initialThreads }: ThreadsListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeThreadId = searchParams.get('thread');
  const [pending, startTransition] = useTransition();

  const handleNewConversation = () => {
    startTransition(async () => {
      const res = await fetch(
        `/api/agents/${encodeURIComponent(agentId)}/threads`,
        { method: 'POST' },
      );
      if (!res.ok) return;
      const { threadId } = (await res.json()) as { threadId: string };
      router.push(
        `/agents/${encodeURIComponent(agentId)}?thread=${encodeURIComponent(threadId)}&tab=chat`,
      );
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-8">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Conversations</h2>
        <Button
          size="sm"
          variant="outline"
          onClick={handleNewConversation}
          disabled={pending}
        >
          <PlusIcon className="mr-2 size-4" />
          New conversation
        </Button>
      </div>

      {initialThreads.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No conversations yet. Start chatting to see them here.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {initialThreads.map((thread) => {
            const isActive = thread.id === activeThreadId;
            return (
              <li key={thread.id}>
                <Link
                  href={`/agents/${encodeURIComponent(agentId)}?thread=${encodeURIComponent(thread.id)}&tab=chat`}
                  className={
                    'hover:bg-muted flex items-start gap-3 rounded-md px-3 py-2 transition ' +
                    (isActive ? 'bg-muted' : '')
                  }
                >
                  <MessageSquareIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {thread.title ?? 'Untitled conversation'}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {new Date(thread.updatedAt).toLocaleString()}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
