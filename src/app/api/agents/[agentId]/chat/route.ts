import 'server-only';

import { handleChatStream } from '@mastra/ai-sdk';
import { RequestContext } from '@mastra/core/request-context';
import { createUIMessageStreamResponse } from 'ai';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { withAuthenticatedRoute } from '@/app/api/_lib';
import { getMastra } from '@/mastra';
import { applyUserContext } from '@/mastra/lib/user-context';

/**
 * POST /api/agents/[agentId]/chat
 *
 * The canonical chat endpoint for every Mastra agent in MastraClaw.
 *
 * Per-user isolation lives entirely in `applyUserContext()` (the single
 * chokepoint that sets `MASTRA_RESOURCE_ID_KEY = user_<userId>`). The
 * agent is resolved through the user-scoped factory so that future
 * stored-agent ownership filtering happens automatically.
 *
 * The body has two shapes — both consumed by the same Assistant UI
 * transport — discriminated by the presence of `resumeData`:
 *
 *   1. Normal chat turn (matches AI SDK `useChat`):
 *      `{ messages: UIMessage[], threadId?: string }`
 *
 *   2. Tool-approval resume (sent by `chat.regenerate({ body: ... })`
 *      from the approval-button context):
 *      `{ resumeData: { approved: boolean }, runId, toolCallId,
 *        threadId, messages?: UIMessage[] }`
 *
 *      `handleChatStream` from `@mastra/ai-sdk` looks at `resumeData`
 *      and routes to `agent.resumeStream(resumeData, options)` instead
 *      of `agent.stream(messages, options)`. The Mastra agent picks
 *      its workflow snapshot back up, the suspended tool call is
 *      approved or declined, and the continuation streams back to the
 *      same `Chat` instance, naturally replacing the suspended
 *      assistant message. No second route, no manual stream merging.
 *
 * The Zod schema validates the structural minimum. The full
 * `UIMessage` shape is enforced by the client library (`assistant-ui`
 * + AI SDK v6) on the producing side; we just defend against
 * obviously-bad payloads. The cast to `UIMessage[]` at the handoff to
 * `handleChatStream` goes through `unknown` so the type lie is visible.
 */
const uiMessageShape = z.object({
  id: z.string(),
  role: z.enum(['system', 'user', 'assistant']),
  parts: z.array(z.unknown()),
});

const chatBodySchema = z.object({
  // `messages` is structurally optional in our schema so the resume
  // branch can post a body without it. The handler normalizes to
  // `body.messages ?? []` before handing off to `handleChatStream`,
  // which itself ignores `messages` when `resumeData` is set. We
  // intentionally do NOT use `.default([])` here: that would make the
  // input type optional and the output type required, which doesn't
  // satisfy `withAuthenticatedRoute`'s `ZodSchema<TBody>` constraint
  // (input and output must match).
  messages: z.array(uiMessageShape).optional(),
  threadId: z.string().optional(),
  // Resume fields. When `resumeData` is present, `runId` is required
  // by `handleChatStream` itself (`runId is required when resumeData
  // is provided`), so we enforce it here too.
  resumeData: z.record(z.string(), z.unknown()).optional(),
  runId: z.string().optional(),
  toolCallId: z.string().optional(),
}).superRefine((body, ctx) => {
  if (body.resumeData && !body.runId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: '`runId` is required when `resumeData` is provided',
      path: ['runId'],
    });
  }
  if (!body.resumeData && (!body.messages || body.messages.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'either `messages` or `resumeData` must be provided',
      path: ['messages'],
    });
  }
});

export const POST = withAuthenticatedRoute<
  { agentId: string },
  z.infer<typeof chatBodySchema>
>({
  requireProfile: true,
  bodySchema: chatBodySchema,
  handler: async ({ user, facade, params, body }) => {
    const agentDetail = await facade.agents.get(params.agentId);
    if (!agentDetail) {
      return NextResponse.json(
        { error: `Agent not found: ${params.agentId}` },
        { status: 404 },
      );
    }

    // requireProfile guarantees this is non-null.
    const profile = (await facade.profile())!;
    const credentials = await facade.getLlmCredentials();

    const threadId =
      body.threadId && body.threadId.length > 0
        ? body.threadId
        : `chat_${user.userId}_${Date.now()}`;

    const requestContext = new RequestContext();
    const { resourceId } = applyUserContext(requestContext, {
      user,
      profile,
      llm: {
        provider: credentials.provider,
        apiKey: credentials.apiKey,
        modelId: credentials.defaultModel,
        baseUrl: credentials.baseUrl,
      },
      threadId,
    });

    // Cast goes through `unknown`: `@mastra/ai-sdk` and `ai` ship
    // overlapping but not type-identical `UIMessage` declarations
    // (v5 vs. v6 internal types). Both shapes are runtime-compatible
    // because the chat route is end-to-end v6, but TypeScript can't
    // see that. We also widen the params type for `toolCallId`,
    // which is a real `agent.resumeStream` option but not on the
    // public `AgentExecutionOptions` that `ChatStreamHandlerParams`
    // extends. The cast surface is intentionally small.
    type ChatParams = NonNullable<
      Parameters<typeof handleChatStream>[0]['params']
    > & { toolCallId?: string };
    const handleParams: ChatParams = {
      messages: (body.messages ?? []) as unknown as ChatParams['messages'],
      requestContext,
      memory: { resource: resourceId, thread: threadId },
      // Resume branch: when the client sends `resumeData` (after the
      // user clicks Approve / Decline on a suspended tool call),
      // `handleChatStream` ignores `messages` and calls
      // `agent.resumeStream(resumeData, { runId, toolCallId, ... })`
      // under the hood. The continuation streams back through the
      // same UI message stream and the AI SDK `Chat` instance merges
      // it into the existing assistant message.
      ...(body.resumeData ? { resumeData: body.resumeData } : {}),
      ...(body.runId ? { runId: body.runId } : {}),
      ...(body.toolCallId ? { toolCallId: body.toolCallId } : {}),
    };

    const stream = await handleChatStream({
      mastra: await getMastra(),
      agentId: params.agentId,
      version: 'v6',
      params: handleParams,
    });

    return createUIMessageStreamResponse({ stream });
  },
});
