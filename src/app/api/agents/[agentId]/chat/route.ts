import 'server-only';

import { handleChatStream } from '@mastra/ai-sdk';
import { RequestContext } from '@mastra/core/request-context';
import type { UIMessage } from 'ai';
import { createUIMessageStreamResponse } from 'ai';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { withAuthenticatedRoute } from '@/app/api/_lib';
import { mastra } from '@/mastra';
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
 * Body shape (matches AI SDK `useChat` posting):
 *
 *     { messages: UIMessage[], threadId?: string }
 *
 * The Zod schema validates the structural minimum (id + role + parts
 * array per message). The full `UIMessage` shape is enforced by the
 * client library (`assistant-ui` + AI SDK v6) on the producing side;
 * we just defend against obviously-bad payloads. The cast to
 * `UIMessage[]` at the handoff to `handleChatStream` goes through
 * `unknown` so the type lie is visible.
 */
const uiMessageShape = z.object({
  id: z.string(),
  role: z.enum(['system', 'user', 'assistant']),
  parts: z.array(z.unknown()),
});

const chatBodySchema = z.object({
  messages: z.array(uiMessageShape).min(1),
  threadId: z.string().optional(),
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

    const stream = await handleChatStream({
      mastra,
      agentId: params.agentId,
      version: 'v6',
      params: {
        messages: body.messages as unknown as UIMessage[],
        requestContext,
        memory: { resource: resourceId, thread: threadId },
      },
    });

    return createUIMessageStreamResponse({ stream });
  },
});
