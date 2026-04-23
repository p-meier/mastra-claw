'use client';

import { useAui, useAuiState } from '@assistant-ui/react';
import { CheckIcon, Loader2Icon, XIcon } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { useAgentChat } from './agent-chat-context';

/**
 * Approve / Decline buttons for a single suspended Mastra tool call.
 *
 * Mastra emits the suspension as an AI SDK v6 *data part*
 * (`data-tool-call-approval` / `data-tool-call-suspended`). The
 * dispatcher in `tool-approval-data-part.tsx` decodes the part, picks
 * up the `runId` + `toolCallId`, and renders this component.
 *
 * **In-place resume mechanics.** No page reload, no remount. We:
 *
 *   1. Stash a resume payload on the chat transport via
 *      `transport.setPendingResume({ resumeData, runId, toolCallId })`.
 *      The transport is created in `agent-chat.tsx` via
 *      `createMastraChatTransport(...)` and exposed through the
 *      `AgentChatContext`.
 *   2. Trigger a regenerate of the suspended assistant message via
 *      `aui.thread().startRun({ parentId: <user message id> })`.
 *      `startRun` routes through `useExternalStoreRuntime` →
 *      `chatHelpers.regenerate(...)`, which slices messages back to
 *      the parent (the user message) and re-runs from there.
 *   3. The transport's `prepareSendMessagesRequest` runs first,
 *      notices the pending resume, and rewrites the request body
 *      to `{ messages: [], threadId, resumeData, runId, toolCallId }`.
 *   4. The chat route's union schema dispatches to the resume
 *      branch, `handleChatStream` calls `agent.resumeStream(...)`,
 *      and the resumed continuation streams back into the same
 *      `Chat` instance. AI SDK appends the new assistant message
 *      in place — the suspended one is replaced by the resumed
 *      continuation, and the rest of the chat stays mounted and
 *      visible.
 *
 * **Where the parent id comes from.** This component is rendered
 * inside the assistant message that contains the suspended tool
 * call. `useAuiState((s) => s.message.parentId)` reads that
 * message's parentId, which is the user message that triggered the
 * suspended turn. We pass *that* id as `parentId` to `startRun` so
 * the regenerate slices everything from the user message forward.
 *
 * Local `pending` state is just a per-button submission lock so the
 * user can't double-fire while the regenerate is mid-flight. Once
 * the regenerate finishes, AI SDK rebuilds this message tree from
 * scratch and the buttons disappear naturally.
 */
export type ToolApprovalButtonsProps = {
  runId: string;
  toolCallId: string;
};

type Pending = 'approve' | 'decline' | null;

export function ToolApprovalButtons({
  runId,
  toolCallId,
}: ToolApprovalButtonsProps) {
  const { transport } = useAgentChat();
  const aui = useAui();
  // The id of the user message that this suspended assistant
  // message is replying to. `startRun` uses it to slice the
  // message list back to the user before regenerating.
  const parentId = useAuiState((s) => s.message?.parentId ?? null);
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (decision: 'approve' | 'decline') => {
    if (!parentId) {
      setError('Cannot resume — no parent user message found.');
      return;
    }
    setPending(decision);
    setError(null);
    try {
      transport.setPendingResume({
        resumeData: { approved: decision === 'approve' },
        runId,
        toolCallId,
      });
      // Triggers `chatHelpers.regenerate(...)` under the hood. The
      // transport's `prepareSendMessagesRequest` consumes the
      // pending resume and rewrites the request body to a Mastra
      // resume call. The resumed continuation streams back and AI
      // SDK appends it in place — this component is replaced as
      // part of that update, so we don't need to clear `pending`
      // here.
      aui.thread().startRun({ parentId });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Resume failed';
      setError(message);
      setPending(null);
    }
  };

  const disabled = pending !== null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="default"
          disabled={disabled}
          onClick={() => submit('approve')}
          className="h-7 gap-1.5 px-2.5 text-xs"
        >
          {pending === 'approve' ? (
            <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <CheckIcon className="size-3.5" aria-hidden />
          )}
          Approve
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => submit('decline')}
          className="h-7 gap-1.5 px-2.5 text-xs"
        >
          {pending === 'decline' ? (
            <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <XIcon className="size-3.5" aria-hidden />
          )}
          Decline
        </Button>
      </div>
      {error && (
        <p
          className={cn(
            'text-destructive text-[11px]',
            'rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1',
          )}
        >
          {error}
        </p>
      )}
    </div>
  );
}
