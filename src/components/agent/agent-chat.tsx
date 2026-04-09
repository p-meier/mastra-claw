'use client';

import type {
  ToolCallMessagePartComponent,
  EmptyMessagePartComponent,
} from '@assistant-ui/react';
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
import {
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  Loader2Icon,
  SquareIcon,
  TriangleAlertIcon,
  WrenchIcon,
} from 'lucide-react';
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
    <MessagePrimitive.Root className="flex w-full flex-col items-start gap-2">
      {/*
       * Components form of `MessagePrimitive.Parts` (vs. the previous
       * render-prop form) so we can render every part type the agent
       * emits — not just text. The render-prop form silently dropped
       * tool-call and empty parts, which is why workspace tool calls
       * and "thinking" state were invisible to the user.
       *
       * - `Text`           streams Markdown via `MarkdownText`
       *                    (`@assistant-ui/react-streamdown` backend)
       * - `tools.Fallback` shows every tool call (workspace file ops,
       *                    future MCP tools, …) with status, args, and
       *                    result in a collapsible card.
       * - `Empty`          rendered when the assistant message has no
       *                    parts yet OR the last part is non-text
       *                    (default `unstable_showEmptyOnNonTextEnd`).
       *                    This is the natural slot for the "Working…"
       *                    indicator: it appears the moment the user
       *                    sends a message and stays visible while a
       *                    tool call is running, then disappears as
       *                    soon as text starts streaming.
       */}
      <MessagePrimitive.Parts
        components={{
          Text: AssistantTextBubble,
          Empty: AssistantEmptyIndicator,
          tools: { Fallback: ToolFallback },
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
  // about to stream the next chunk). Anything else is a terminal state
  // we don't want to flash a spinner over, so we render nothing.
  if (status.type !== 'running') return null;
  return (
    <div className="text-muted-foreground bg-muted/60 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs">
      <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
      <span>Working…</span>
    </div>
  );
};

/**
 * Generic tool-call card. Renders for every tool the agent invokes
 * unless a more specific `tools.by_name` entry takes over.
 *
 * Surfaces:
 * - Humanized tool name (strip the `mastra_workspace_` prefix so
 *   `mastra_workspace_write_file` becomes `Workspace · write file`).
 * - Live status (running spinner / success check / error triangle /
 *   "needs approval" pill when Mastra suspends the call).
 * - Collapsible args (raw JSON, monospaced).
 * - Collapsible result, if present.
 *
 * Implemented with `<details>`/`<summary>` so we don't pull in another
 * disclosure dependency or wrestle with controlled state.
 */
const ToolFallback: ToolCallMessagePartComponent = ({
  toolName,
  args,
  result,
  isError,
  status,
}) => {
  const label = humanizeToolName(toolName);

  let StatusIcon = Loader2Icon;
  let statusClass = 'animate-spin text-muted-foreground';
  let statusText = 'Running';
  if (status.type === 'requires-action') {
    StatusIcon = WrenchIcon;
    statusClass = 'text-amber-600';
    statusText = 'Needs approval';
  } else if (status.type === 'incomplete' || isError) {
    StatusIcon = TriangleAlertIcon;
    statusClass = 'text-destructive';
    statusText = 'Failed';
  } else if (status.type === 'complete') {
    StatusIcon = CheckIcon;
    statusClass = 'text-emerald-600';
    statusText = 'Done';
  }

  return (
    <details className="bg-muted/40 group max-w-[80%] rounded-xl border text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2">
        <StatusIcon className={cn('size-3.5 shrink-0', statusClass)} aria-hidden />
        <span className="text-foreground font-medium">{label}</span>
        <span className="text-muted-foreground ml-auto inline-flex items-center gap-1">
          {statusText}
          <ChevronDownIcon
            className="size-3.5 transition-transform group-open:rotate-180"
            aria-hidden
          />
        </span>
      </summary>
      <div className="space-y-2 border-t px-3 py-2">
        {args !== undefined && (
          <ToolJsonBlock label="Arguments" value={args} />
        )}
        {result !== undefined && (
          <ToolJsonBlock label="Result" value={result} />
        )}
      </div>
    </details>
  );
};

function ToolJsonBlock({ label, value }: { label: string; value: unknown }) {
  let body: string;
  try {
    body = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  } catch {
    body = String(value);
  }
  return (
    <div>
      <div className="text-muted-foreground mb-1 text-[10px] font-medium tracking-wide uppercase">
        {label}
      </div>
      <pre className="bg-background/60 max-h-64 overflow-auto rounded-md border p-2 text-[11px] whitespace-pre-wrap">
        {body}
      </pre>
    </div>
  );
}

function humanizeToolName(toolName: string): string {
  // Mastra's built-in workspace tools are namespaced as
  // `mastra_workspace_<verb>` (see `WORKSPACE_TOOLS` in
  // `@mastra/core/workspace`). Strip the prefix and present them as
  // "Workspace · <verb>". Other tools fall back to a slug-to-words
  // conversion.
  if (toolName.startsWith('mastra_workspace_')) {
    const verb = toolName.slice('mastra_workspace_'.length).replace(/_/g, ' ');
    return `Workspace · ${verb}`;
  }
  return toolName.replace(/[_-]+/g, ' ');
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
