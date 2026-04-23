'use client';

import type { EmptyMessagePartComponent } from '@assistant-ui/react';
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
} from '@assistant-ui/react';
import { useChatRuntime } from '@assistant-ui/react-ai-sdk';
import type { UIMessage } from 'ai';
import { ArrowUpIcon, Loader2Icon, SquareIcon } from 'lucide-react';
import { useMemo } from 'react';

import { MarkdownText } from '@/components/assistant-ui/markdown-text';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import {
  AgentChatContextProvider,
  ToolCallApprovalDataPart,
  ToolCallSuspendedDataPart,
  ToolFallback,
  createMastraChatTransport,
} from './tool-call';

/**
 * Per-agent chat surface built on Assistant UI primitives.
 *
 * The runtime is wired directly to `/api/agents/[agentId]/chat`, which
 * uses `handleChatStream` from `@mastra/ai-sdk` on the server side.
 * The server is responsible for resolving the user, applying
 * user-context via `applyUserContext()`, and enforcing per-user
 * resource isolation via `MASTRA_RESOURCE_ID_KEY` — none of that is
 * the client's responsibility.
 *
 * **Why `useChatRuntime` + a custom transport.** `useChatRuntime`
 * bundles `useChat` + `useAISDKRuntime` *inside*
 * `useRemoteThreadListRuntime`, which is what makes
 * `<AssistantRuntimeProvider>` mount as a top-level runtime. An
 * earlier version of this file inlined `useChat` + `useAISDKRuntime`
 * directly so we could grab `chat.regenerate({ body })` for the
 * approval flow — that broke message rendering because the
 * thread-list wrapper was missing. Instead we keep `useChatRuntime`
 * and use a `MastraChatTransport` that exposes a `setPendingResume`
 * setter; the approval buttons stash a payload there and trigger a
 * regenerate via the runtime API. The transport rewrites the next
 * outgoing request body to a Mastra resume call.
 *
 * **Resume flow at a glance:**
 * 1. Mastra emits `data-tool-call-approval` (and/or
 *    `data-tool-call-suspended`) parts on the assistant message when
 *    a tool requires approval.
 * 2. `MessagePrimitive.Parts components.data.by_name` routes those
 *    parts to `ToolCallApprovalDataPart` /
 *    `ToolCallSuspendedDataPart`. `ToolFallback` deduplicates so
 *    the standard tool-call card doesn't show alongside the
 *    dedicated approval card.
 * 3. On click, `ToolApprovalButtons` calls
 *    `transport.setPendingResume({ resumeData, runId, toolCallId })`
 *    and then `aui.thread().startRun({ parentId })` (parentId is
 *    the user message that triggered the suspended turn).
 * 4. `startRun` routes through `useExternalStoreRuntime` →
 *    `chatHelpers.regenerate(...)`. The transport's
 *    `prepareSendMessagesRequest` consumes the pending resume and
 *    rewrites the request body to `{ messages: [], threadId,
 *    resumeData, runId, toolCallId }`.
 * 5. The chat route detects `resumeData` and forwards it to
 *    `handleChatStream`, which calls `agent.resumeStream(...)`.
 * 6. The resumed continuation streams back into the same `Chat`
 *    instance and is appended in place — the suspended assistant
 *    message is replaced by the resumed continuation, the rest of
 *    the thread stays mounted, and there is no page reload.
 *
 * **Stable thread id.** When the URL has no `?thread=` (a fresh
 * conversation), `agent-tabs.tsx` generates a stable client-side
 * id and passes it down here. We pin it into the transport's
 * static body so every request — both the initial messages and
 * the resume rewrite — targets the same Mastra thread. Without
 * this, the chat route generates a fresh thread id per request and
 * the resume targets an empty workflow.
 */
export type AgentChatProps = {
  agentId: string;
  /** Stable thread id used for the entire chat session. */
  threadId: string;
  /**
   * Server-loaded prior messages for the selected thread. Empty when
   * starting a new conversation. Passed straight to `useChatRuntime`
   * via `ChatInit.messages` so the user sees their history without
   * a client round-trip.
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
      createMastraChatTransport({
        api: `/api/agents/${encodeURIComponent(agentId)}/chat`,
        body: { threadId },
      }),
    [agentId, threadId],
  );

  // `useChatRuntime` extends AI SDK v6's `ChatInit`, so passing
  // `messages` + `id` seeds the chat with prior history. The `id`
  // matters: the underlying `Chat` is keyed by id, so changing it
  // (we do via the parent's `key` prop) creates a fresh runtime
  // with the new initial state.
  const runtime = useChatRuntime({
    id: threadId,
    messages: initialMessages,
    transport,
  });

  const chatContextValue = useMemo(
    () => ({ agentId, threadId, transport }),
    [agentId, threadId, transport],
  );

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AgentChatContextProvider value={chatContextValue}>
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
      </AgentChatContextProvider>
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
    <MessagePrimitive.Root className="flex w-full flex-col items-start gap-2">
      {/*
       * Components form of `MessagePrimitive.Parts` (vs. the previous
       * render-prop form) so we can render every part type the agent
       * emits — not just text. The render-prop form silently dropped
       * tool-call and empty parts, which is why workspace tool calls
       * and "thinking" state used to be invisible to the user.
       *
       * - `Text`           streams Markdown via `MarkdownText`
       *                    (`@assistant-ui/react-streamdown` backend)
       * - `tools.Fallback` shows every tool call with status, args,
       *                    and result in a collapsible card. Auto-
       *                    hides when there is a matching
       *                    `data-tool-call-approval` data part to
       *                    avoid double rendering — see
       *                    `tool-fallback.tsx`.
       * - `data.by_name`   routes Mastra's `data-tool-call-approval`
       *                    and `data-tool-call-suspended` parts to
       *                    dedicated approval renderers. The
       *                    Approve / Decline buttons live inside
       *                    those renderers and trigger an in-place
       *                    resume via the custom chat transport —
       *                    see `tool-approval-buttons.tsx`.
       * - `Empty`          rendered when the assistant message has
       *                    no parts yet OR the last part is non-text
       *                    (default `unstable_showEmptyOnNonTextEnd`).
       *                    This is the natural slot for the
       *                    "Working…" indicator.
       */}
      <MessagePrimitive.Parts
        components={{
          Text: AssistantTextBubble,
          Empty: AssistantEmptyIndicator,
          tools: { Fallback: ToolFallback },
          data: {
            by_name: {
              'tool-call-approval': ToolCallApprovalDataPart,
              'tool-call-suspended': ToolCallSuspendedDataPart,
            },
          },
        }}
      />
    </MessagePrimitive.Root>
  );
}

function AssistantTextBubble() {
  return (
    <div className="bg-muted max-w-[80%] rounded-2xl px-4 py-2 text-sm">
      <MarkdownText />
    </div>
  );
}

const AssistantEmptyIndicator: EmptyMessagePartComponent = ({ status }) => {
  // `running` is the loading state — the agent has been invoked but
  // hasn't streamed any text yet (or just finished a tool call and is
  // about to stream the next chunk). Anything else is a terminal
  // state we don't want to flash a spinner over, so we render
  // nothing.
  if (status.type !== 'running') return null;
  return (
    <div className="text-muted-foreground bg-muted/60 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs">
      <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
      <span>Working…</span>
    </div>
  );
};

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
