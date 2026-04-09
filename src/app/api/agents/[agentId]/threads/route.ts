import 'server-only';

import { NextResponse } from 'next/server';

import { withAuthenticatedRoute } from '@/app/api/_lib';

/**
 * GET /api/agents/[agentId]/threads
 *
 * Returns up to 50 most-recent conversation threads owned by the
 * current user (`resource_id = user_<userId>`) for the given agent.
 * 404s if the agent doesn't exist; returns `{ threads: [] }` if the
 * agent has no memory configured.
 */
export const GET = withAuthenticatedRoute<{ agentId: string }>({
  handler: async ({ facade, params }) => {
    const agent = await facade.agents.get(params.agentId);
    if (!agent) {
      return NextResponse.json(
        { error: `Agent not found: ${params.agentId}` },
        { status: 404 },
      );
    }

    const threads = await facade.agents.listThreads(params.agentId);
    return NextResponse.json({ threads });
  },
});

/**
 * POST /api/agents/[agentId]/threads
 *
 * Allocates a fresh thread id (no DB write — Mastra creates the row
 * lazily on first message). Returns the new id so the client can pass
 * it to the chat transport via the `body.threadId` extra.
 */
export const POST = withAuthenticatedRoute<{ agentId: string }>({
  handler: async ({ user, facade, params }) => {
    const agent = await facade.agents.get(params.agentId);
    if (!agent) {
      return NextResponse.json(
        { error: `Agent not found: ${params.agentId}` },
        { status: 404 },
      );
    }

    const threadId = `chat_${user.userId}_${Date.now()}`;
    return NextResponse.json({ threadId });
  },
});
