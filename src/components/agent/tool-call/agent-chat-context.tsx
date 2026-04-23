'use client';

import { createContext, useContext } from 'react';

import type { MastraChatTransport } from './mastra-chat-transport';

/**
 * Per-chat context exposed to every tool-call renderer below the
 * `AgentChat` provider.
 *
 * Tool-call renderers (specifically the approval buttons in
 * `tool-approval-buttons.tsx`) need three things:
 *
 *   1. **`agentId`** — for diagnostics and any future per-agent
 *      logic. Not strictly required by the resume flow because the
 *      transport already has the chat endpoint baked in.
 *   2. **`threadId`** — informational; the transport's static body
 *      already pins the thread for every outgoing request, so the
 *      approval button doesn't have to send it again.
 *   3. **`transport`** — the `MastraChatTransport` instance the
 *      runtime is using. The approval button calls
 *      `transport.setPendingResume(...)` to stash a resume payload,
 *      then triggers a regenerate via the assistant-ui runtime API
 *      (`aui.thread().startRun({ parentId })`). The transport
 *      intercepts the next outgoing request and rewrites its body
 *      to a Mastra resume call. The chat updates in place — no
 *      remount, no router refresh.
 *
 * **Why no `chat` instance**: an earlier version of this context
 * tried to expose the underlying AI SDK `Chat` so the buttons could
 * call `chat.regenerate({ body })` directly. That required inlining
 * `useChat` + `useAISDKRuntime` instead of using `useChatRuntime`,
 * which silently broke message rendering — `useChatRuntime`'s
 * wrapping with `useRemoteThreadListRuntime` is what makes the
 * AssistantRuntime mount correctly. The transport-with-pending-slot
 * pattern lets us keep `useChatRuntime` AND get in-place updates.
 *
 * **Why no `onResumed` callback**: the previous attempt used a
 * side-channel `fetch()` + `router.refresh()` + remount-key bump
 * after every approval. That worked but reloaded the chat surface,
 * which is jarring for a chat UI and pointless once the transport
 * route updates the chat in place.
 */
export type AgentChatContextValue = {
  agentId: string;
  threadId: string;
  transport: MastraChatTransport;
};

const AgentChatContext = createContext<AgentChatContextValue | null>(null);

export const AgentChatContextProvider = AgentChatContext.Provider;

export function useAgentChat(): AgentChatContextValue {
  const ctx = useContext(AgentChatContext);
  if (!ctx) {
    throw new Error(
      'useAgentChat must be used inside <AgentChat> — a tool renderer ' +
        'or composer extension is being mounted outside the chat tree.',
    );
  }
  return ctx;
}
