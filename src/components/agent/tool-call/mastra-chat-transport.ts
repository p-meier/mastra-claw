'use client';

import { AssistantChatTransport } from '@assistant-ui/react-ai-sdk';
import type { UIMessage } from 'ai';

/**
 * Payload the approval buttons stash on the transport before
 * triggering a regenerate. The next outgoing request rewrites its
 * body to a Mastra resume call instead of a normal user-message
 * stream.
 */
export type MastraResumePayload = {
  resumeData: Record<string, unknown>;
  runId: string;
  toolCallId: string;
};

/**
 * `AssistantChatTransport` extension that lets the approval flow
 * **rewrite the next outgoing request's body** so we can resume a
 * suspended Mastra workflow without page reloads or remounts.
 *
 * **The problem.** When Mastra suspends a tool call for human
 * approval, the chat needs a way to send `agent.resumeStream(...)`
 * later, with a `runId` + `toolCallId` the server already knows
 * about. AI SDK v6's `chat.regenerate({ body })` accepts a custom
 * body — but `useChatRuntime` doesn't expose the `Chat` instance
 * (the underlying `useChat` helpers are wrapped inside
 * `useRemoteThreadListRuntime`), and inlining `useChat` directly
 * breaks the message-rendering wiring (an earlier attempt confirmed
 * this).
 *
 * **The fix.** We subclass `AssistantChatTransport` via a factory +
 * closure ref. The closure holds a `pendingResume` slot. The
 * approval button writes to that slot via `setPendingResume()`, then
 * calls `aui.thread().startRun({ parentId })` (which routes through
 * `useExternalStoreRuntime` → `chatHelpers.regenerate(...)`). When
 * the regenerate fires, our `prepareSendMessagesRequest` runs first,
 * notices the pending resume, and rewrites the body to:
 *
 *     { ...staticBody, messages: [], resumeData, runId, toolCallId }
 *
 * The chat route's union schema dispatches to the resume branch,
 * `handleChatStream` calls `agent.resumeStream(...)`, and the
 * resumed continuation streams back into the same `Chat` instance.
 * AI SDK appends the new assistant message in place — no remount,
 * no router refresh, no URL gymnastics.
 *
 * **Why a factory and not a class.** `prepareSendMessagesRequest` is
 * passed to `super(...)` before `this` is initialised, so a
 * subclass field can't be referenced from inside the closure. The
 * factory captures a plain `state` object that both the closure
 * (for read+clear) and the returned setter (for writes) can hold.
 */
export type MastraChatTransport = AssistantChatTransport<UIMessage> & {
  /**
   * Stash a resume payload to be applied to the next outgoing
   * request. The payload is consumed (cleared) after one use, so
   * normal user messages sent later go through unchanged.
   */
  setPendingResume(payload: MastraResumePayload): void;
};

export type CreateMastraChatTransportOptions = {
  api: string;
  /**
   * Static body merged into every outgoing request. We use it to
   * pin the `threadId` for the entire chat session — both the
   * normal user-message path and the resume rewrite read this from
   * `options.body` so the same Mastra thread is targeted
   * throughout.
   */
  body?: Record<string, unknown>;
};

export function createMastraChatTransport(
  options: CreateMastraChatTransportOptions,
): MastraChatTransport {
  // Plain holder reachable from both the closure and the setter we
  // attach to the returned instance. Lives outside the class so we
  // can read+clear it from inside `prepareSendMessagesRequest`,
  // which runs *before* `this` is initialised.
  const state: { pendingResume: MastraResumePayload | null } = {
    pendingResume: null,
  };

  const transport = new AssistantChatTransport<UIMessage>({
    api: options.api,
    body: options.body,
    prepareSendMessagesRequest: async (opts) => {
      // We have to always return a full request body (the AI SDK
      // type signature does not allow `undefined`). Reconstruct
      // the default body the way the parent class would so a
      // normal turn still works:
      //
      //   - `opts.body` already contains the static body
      //     (`threadId` from above) and the model context
      //     fields the parent merged in (callSettings, system,
      //     config, tools).
      //   - We add `id`, `messages`, `trigger`, `messageId`,
      //     and `metadata` so the chat route receives a
      //     complete request.
      const baseBody = {
        ...(opts.body ?? {}),
        id: opts.id,
        messages: opts.messages,
        trigger: opts.trigger,
        messageId: opts.messageId,
        metadata: opts.requestMetadata,
      };

      // Normal path: nothing pending, send the default request.
      if (!state.pendingResume) {
        return { body: baseBody };
      }

      // Resume path: consume the pending resume so the *next*
      // request (which is the immediate one we're rewriting
      // here) carries it, and any later request goes through
      // unchanged.
      const resume = state.pendingResume;
      state.pendingResume = null;

      // Rewrite the body to the resume shape:
      //   - keep the static body and model context
      //   - clear `messages` because `handleChatStream` ignores
      //     `messages` whenever `resumeData` is set
      //   - inject the Mastra resume fields the chat route's
      //     union schema looks for
      return {
        body: {
          ...baseBody,
          messages: [],
          resumeData: resume.resumeData,
          runId: resume.runId,
          toolCallId: resume.toolCallId,
        },
      };
    },
  });

  // Attach the setter as a property on the constructed instance.
  // We cast through `MastraChatTransport` so callers see the typed
  // method without us having to re-implement the rest of
  // `AssistantChatTransport` ourselves.
  (transport as MastraChatTransport).setPendingResume = (
    payload: MastraResumePayload,
  ) => {
    state.pendingResume = payload;
  };

  return transport as MastraChatTransport;
}
