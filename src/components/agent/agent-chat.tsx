'use client';

import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
} from '@assistant-ui/react';
import {
  AssistantChatTransport,
  useChatRuntime,
} from '@assistant-ui/react-ai-sdk';
import type { UIMessage } from 'ai';
import { ArrowUpIcon, SquareIcon } from 'lucide-react';
import { useMemo } from 'react';

import { MarkdownText } from '@/components/assistant-ui/markdown-text';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Per-agent chat surface built on Assistant UI primitives.
 *
 * The runtime is wired straight to `/api/agents/[agentId]/chat`, which
 * uses `handleChatStream` from `@mastra/ai-sdk` on the server side. The
 * server is responsible for resolving the user, applying user-context
 * via `applyUserContext()`, and enforcing per-user resource isolation
 * via `MASTRA_RESOURCE_ID_KEY` — none of that is the client's
 * responsibility.
 *
 * Future thread persistence (selecting an existing thread from the
 * Conversations tab and loading it here) will pass `threadId` into the
 * transport body via the `body` option on `AssistantChatTransport`.
 */
export type AgentChatProps = {
  agentId: string;
  /** Pre-selected thread id to attach the runtime to. */
  threadId?: string;
  /**
   * Server-loaded prior messages for the selected thread. Empty when
   * starting a new conversation. Passed straight to `useChatRuntime`
   * via `ChatInit.messages` so the user sees their history without
   * a client round-trip.
   *
   * Typed as the AI SDK v6 `UIMessage` from `ai` — that's exactly what
   * `useChatRuntime` consumes via `ChatInit.messages`, so no parallel
   * type and no `as never` assertion is needed.
   */
  initialMessages?: UIMessage[];
};

export function AgentChat({
  agentId,
  threadId,
  initialMessages,
}: AgentChatProps) {
  const transport = useMemo(
    () =>
      new AssistantChatTransport({
        api: `/api/agents/${encodeURIComponent(agentId)}/chat`,
        body: threadId ? { threadId } : undefined,
      }),
    [agentId, threadId],
  );

  // `useChatRuntime` extends AI SDK v6's `ChatInit`, so passing
  // `messages` + `id` seeds the chat with prior history. The `id` is
  // important: AI SDK keys its internal Chat instance by id, so
  // changing `id` (we do it via the parent's `key` prop) creates a
  // fresh runtime with the new initial state.
  const runtime = useChatRuntime({
    id: threadId,
    messages: initialMessages,
    transport,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="flex h-full flex-col">
        <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8">
            <ThreadPrimitive.Empty>
              <EmptyState />
            </ThreadPrimitive.Empty>

            <ThreadPrimitive.Messages
              components={{
                UserMessage,
                AssistantMessage,
              }}
            />
          </div>
        </ThreadPrimitive.Viewport>

        <Composer />
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 py-16 text-center">
      <p className="text-base font-medium">Start a conversation</p>
      <p className="text-sm">Send a message to begin chatting with this agent.</p>
    </div>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-end">
      <div className="bg-primary text-primary-foreground max-w-[80%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap">
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-start">
      <div className="bg-muted max-w-[80%] rounded-2xl px-4 py-2 text-sm">
        {/*
         * Render-prop form documented at
         * https://www.assistant-ui.com/docs/ui/streamdown — text parts
         * go through `MarkdownText` at
         * `src/components/assistant-ui/markdown-text.tsx`, which is
         * backed by `@assistant-ui/react-streamdown` (Shiki code
         * highlighting + Mermaid diagrams) and tolerates partial
         * markdown mid-stream.
         */}
        <MessagePrimitive.Parts>
          {({ part }) =>
            part.type === 'text' ? <MarkdownText /> : null
          }
        </MessagePrimitive.Parts>
      </div>
    </MessagePrimitive.Root>
  );
}

function Composer() {
  return (
    <div className="border-t bg-background px-6 py-4">
      <ComposerPrimitive.Root className="bg-muted/40 focus-within:ring-ring mx-auto flex w-full max-w-3xl items-end gap-2 rounded-2xl border p-2 focus-within:ring-2">
        <ComposerPrimitive.Input
          rows={1}
          autoFocus
          placeholder="Message your agent…"
          className={cn(
            'flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none',
            'placeholder:text-muted-foreground',
          )}
        />
        <ThreadPrimitive.If running={false}>
          <ComposerPrimitive.Send asChild>
            <Button size="icon" className="size-9 rounded-full" type="submit">
              <ArrowUpIcon className="size-4" />
              <span className="sr-only">Send</span>
            </Button>
          </ComposerPrimitive.Send>
        </ThreadPrimitive.If>
        <ThreadPrimitive.If running>
          <ComposerPrimitive.Cancel asChild>
            <Button size="icon" variant="secondary" className="size-9 rounded-full">
              <SquareIcon className="size-4" />
              <span className="sr-only">Stop</span>
            </Button>
          </ComposerPrimitive.Cancel>
        </ThreadPrimitive.If>
      </ComposerPrimitive.Root>
    </div>
  );
}
