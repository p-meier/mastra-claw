import { ArrowLeftIcon } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AgentTabs } from '@/components/agent/agent-tabs';
import { requireAdmin } from '@/lib/auth';
import { mastraFor } from '@/mastra/lib/mastra-for';

/**
 * Agent detail — chat surface, workspace browser, and prior
 * conversations for one agent. The 3-tab layout mirrors Mastra Studio's
 * agent playground.
 */
export default async function AgentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ agentId: string }>;
  searchParams: Promise<{ thread?: string; tab?: string }>;
}) {
  const { agentId } = await params;
  const { thread: requestedThreadId } = await searchParams;
  const user = await requireAdmin();

  const facade = mastraFor(user);
  const agent = await facade.agents.get(agentId);
  if (!agent) notFound();

  const threads = await facade.agents.listThreads(agentId);
  const description = agent.getDescription();

  // If the URL points at an existing thread, server-load its messages
  // so the chat client can seed `useChatRuntime({ messages, id })` and
  // the user sees the prior conversation immediately on navigation.
  // `loadThreadMessages` returns null for forged ids (resource
  // mismatch) — we treat that as "no history" rather than 404 so the
  // chat tab still renders and lets the user start fresh.
  const initialMessages = requestedThreadId
    ? ((await facade.agents.loadThreadMessages(agentId, requestedThreadId)) ??
      [])
    : [];

  return (
    <main className="flex h-svh flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b px-6 py-4">
        <Link
          href="/agents"
          className="text-muted-foreground hover:text-foreground inline-flex size-8 items-center justify-center rounded-md transition"
          aria-label="Back to agents"
        >
          <ArrowLeftIcon className="size-4" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="truncate text-lg font-semibold">{agent.name}</h1>
          {description ? (
            <p className="text-muted-foreground truncate text-sm">
              {description}
            </p>
          ) : null}
        </div>
      </header>

      <AgentTabs
        agentId={agent.id}
        initialThreads={threads}
        initialMessages={initialMessages}
      />
    </main>
  );
}
